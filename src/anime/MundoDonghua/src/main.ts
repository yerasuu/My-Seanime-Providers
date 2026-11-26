/// <reference path="../../online-streaming-provider.d.ts" />
/// <reference path="store.ts" />
/// <reference path="http.ts" />
/// <reference path="packed.ts" />
/// <reference path="extractors/voe.ts" />
/// <reference path="extractors/byse.ts" />
/// <reference path="extractors/hg.ts" />

const SERVER_NAMES = ["VOE", "VidHide", "StreamWish", "Filemoon"];

/**
 * The site labels its tabs with abbreviations (Fm, Voe, Vh, Sw) and fills each
 * pane from a packed script, so a server is told apart by its embed's host.
 * Asura (mdplayer.xyz) is left out: its TLS handshake fails.
 */
function serverOf(embed: string): string | undefined {
    if (/voe\.sx/i.test(embed)) return "VOE";
    if (/filemoon|byse/i.test(embed)) return "Filemoon";
    if (/morencius|vidhide|vidhidepro/i.test(embed)) return "VidHide";
    if (/embedwish|streamwish|streamhg|hlswish/i.test(embed)) return "StreamWish";
    return undefined;
}

function extractorFor(server: string): (embed: string) => Promise<VideoSource[]> {
    if (server === "VOE") return extractVoe;
    if (server === "Filemoon") return extractByse;
    return extractHg;
}

async function embedsOf(pageUrl: string): Promise<{ [server: string]: string }> {
    const page = await get(pageUrl);
    if (!page.ok) throw new Error(`Episodio no disponible (${page.status})`);

    const found: { [server: string]: string } = {};

    for (const code of unpackAll(page.text())) {
        const frame = code.match(/<iframe src='(https?:\/\/[^']+)'/);
        const server = frame && serverOf(frame[1]);
        if (frame && server && !found[server]) found[server] = frame[1];
    }

    return found;
}

class Provider {
    getSettings(): Settings {
        return { episodeServers: SERVER_NAMES, supportsDub: false };
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const media = opts.media;
        const titles = [opts.query, media && media.romajiTitle, media && media.englishTitle].concat(
            media && media.synonyms || []
        );
        const queries = titles.filter(
            (title, i): title is string => !!title && title.trim() !== "" && titles.indexOf(title) === i
        );

        for (const query of queries.slice(0, 4)) {
            const res = await get(`${BASE_URL}/busquedas?donghua=${encodeURIComponent(query)}`);
            if (!res.ok) continue;

            const results: SearchResult[] = [];
            const cards = allMatches(/<a href="\/donghua\/([^"\/]+)">[\s\S]*?<h5 class="md-card-title">([^<]+)<\/h5>/, res.text());

            for (const [, slug, title] of cards) {
                results.push({ id: slug, title: decodeEntities(title.trim()), url: `${BASE_URL}/donghua/${slug}`, subOrDub: "sub" });
            }

            if (results.length > 0) return results;
        }

        return [];
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const res = await get(`${BASE_URL}/donghua/${id}`);
        if (!res.ok) return [];

        const episodes = new Map<number, EpisodeDetails>();

        for (const [, path, number] of allMatches(/<a href="(\/ver\/[^"\/]+\/(\d+))" class="md-ep-link"/, res.text())) {
            const n = parseInt(number, 10);
            if (episodes.has(n)) continue;

            episodes.set(n, { id: `${BASE_URL}${path}`, number: n, title: `Episodio ${n}`, url: `${BASE_URL}${path}` });
        }

        return Array.from(episodes.values()).sort((a, b) => a.number - b.number);
    }

    private async resolve(episode: EpisodeDetails, name: string): Promise<{ videoSources: VideoSource[]; headers: { [key: string]: string } }> {
        const key = `md1:${episode.url}:${name}`;

        const cached = remember<{ videoSources: VideoSource[]; headers: { [key: string]: string } }>(key, RESOLVED_MS);
        if (cached) return cached;

        const embed = (await embedsOf(episode.url))[name];
        if (!embed) throw new Error(`${name} no está disponible en este episodio`);

        const videoSources = await extractorFor(name)(embed);
        if (videoSources.length === 0) throw new Error(`${name} no devolvió fuentes`);

        const resolved = { videoSources, headers: { "User-Agent": BROWSER_UA } };
        keep(key, resolved);
        return resolved;
    }

    /** A server that fails (removed video, blocked CDN) falls back to the next one that resolves, answered under the asked name. */
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const wanted = SERVER_NAMES.find(known => known.toLowerCase() === server.toLowerCase());
        if (!wanted) throw new Error(`Servidor desconocido: ${server}`);

        let firstError: unknown;

        for (const name of [wanted, ...SERVER_NAMES.filter(known => known !== wanted)]) {
            try {
                const { videoSources, headers } = await this.resolve(episode, name);
                if (name !== wanted) console.error(`MundoDonghua: ${wanted} falló, se usa ${name}`);

                return { server: wanted, headers, videoSources };
            } catch (err) {
                firstError = firstError || err;
            }
        }

        throw firstError;
    }
}
