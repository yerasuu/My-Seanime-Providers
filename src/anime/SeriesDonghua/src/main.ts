/// <reference path="../../online-streaming-provider.d.ts" />
/// <reference path="store.ts" />
/// <reference path="http.ts" />
/// <reference path="embeds.ts" />
/// <reference path="extractors/dailymotion.ts" />
/// <reference path="extractors/voe.ts" />
/// <reference path="extractors/byse.ts" />
/// <reference path="extractors/okru.ts" />
/// <reference path="extractors/rumble.ts" />

/**
 * Dailymotion goes last: Seanime's proxy got something other than a playlist
 * from its CDN manifest ("#EXTM3U absent", November 2026), and a failed server
 * falls back to the next one in this order, so it must not be the first to catch one.
 */
const SERVER_NAMES = ["Filemoon", "Rumble", "VOE", "OK.ru", "Dailymotion"];

/**
 * The extractor follows the embed's host, not the tab it came from: the site
 * labels its tabs by position, and for episode 164 the "Filemoon" tab held a
 * voe.sx embed while "VOE" was missing.
 */
function extractorFor(embed: string): ((embed: string) => Promise<VideoSource[]>) | undefined {
    if (/dailymotion\.com/i.test(embed)) return extractDailymotion;
    if (/filemoon|byse/i.test(embed)) return extractByse;
    if (/voe\.sx/i.test(embed)) return extractVoe;
    if (/ok\.ru/i.test(embed)) return extractOkru;
    if (/rumble\.com/i.test(embed)) return extractRumble;
    return undefined;
}

/**
 * What each host's own embedded player sends with its playlist and segment
 * requests: the embed's origin as Referer and Origin. Dailymotion's CDN
 * answered Seanime's proxy with something that was not a playlist while only a
 * User-Agent went along, and Seanime replays these on every segment.
 */
function playbackHeaders(embed: string): { [key: string]: string } {
    const headers: { [key: string]: string } = { "User-Agent": BROWSER_UA };
    const origin = embed.match(/^https?:\/\/[^/]+/);

    if (origin && /dailymotion\.com|rumble\.com|ok\.ru/i.test(embed)) {
        headers["Referer"] = origin[0] + "/";
        headers["Origin"] = origin[0];
    }

    return headers;
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
            const res = await get(`${BASE_URL}/buscar.php?s=${encodeURIComponent(query)}`);
            if (!res.ok) continue;

            const results: SearchResult[] = [];
            const cards = allMatches(/<article class="donghua-card">\s*<a href="\/([^"\/]+)\/"[\s\S]*?<h3 class="card-title">([^<]+)<\/h3>/, res.text());

            for (const [, slug, title] of cards) {
                results.push({ id: slug, title: decodeEntities(title.trim()), url: `${BASE_URL}/${slug}/`, subOrDub: "sub" });
            }

            if (results.length > 0) return results;
        }

        return [];
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const res = await get(`${BASE_URL}/${id}/`);
        if (!res.ok) return [];

        const episodes = new Map<number, EpisodeDetails>();

        for (const [, path, number] of allMatches(/<a href="(\/[^"]+-episodio-(\d+)\/)"/, res.text())) {
            const n = parseInt(number, 10);
            if (episodes.has(n)) continue;

            episodes.set(n, { id: `${BASE_URL}${path}`, number: n, title: `Episodio ${n}`, url: `${BASE_URL}${path}` });
        }

        return Array.from(episodes.values()).sort((a, b) => a.number - b.number);
    }

    private async resolve(episode: EpisodeDetails, name: string): Promise<{ videoSources: VideoSource[]; headers: { [key: string]: string } }> {
        const key = `sd2:${episode.url}:${name}`;

        const cached = remember<{ videoSources: VideoSource[]; headers: { [key: string]: string } }>(key, RESOLVED_MS);
        if (cached) return cached;

        const embed = await embedUrl(episode.url, name);
        const extract = extractorFor(embed);
        if (!extract) throw new Error(`${name} usa un reproductor sin soporte: ${embed}`);

        const videoSources = await extract(embed);
        if (videoSources.length === 0) throw new Error(`${name} no devolvió fuentes`);

        const resolved = { videoSources, headers: playbackHeaders(embed) };
        keep(key, resolved);
        return resolved;
    }

    /**
     * Seanime keeps the server the viewer picked by name, so when it fails
     * (a removed video, a blocked CDN) the next one that resolves is answered
     * under the asked name, as AnimeAV1 does, rather than leaving the player loading.
     */
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const names = SERVER_NAMES;
        const wanted = names.find(known => known.toLowerCase() === server.toLowerCase());
        if (!wanted) throw new Error(`Servidor desconocido: ${server}`);

        let firstError: unknown;

        for (const name of [wanted, ...names.filter(known => known !== wanted)]) {
            try {
                const { videoSources, headers } = await this.resolve(episode, name);
                if (name !== wanted) console.error(`SeriesDonghua: ${wanted} falló, se usa ${name}`);

                return { server: wanted, headers, videoSources };
            } catch (err) {
                firstError = firstError || err;
            }
        }

        throw firstError;
    }
}
