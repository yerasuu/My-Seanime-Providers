/// <reference path="../../online-streaming-provider.d.ts" />
/// <reference path="store.ts" />
/// <reference path="http.ts" />
/// <reference path="catalog.ts" />
/// <reference path="embeds.ts" />
/// <reference path="extractors/dailymotion.ts" />
/// <reference path="extractors/voe.ts" />
/// <reference path="extractors/byse.ts" />

const EXTRACTORS: { [server: string]: (embed: string) => Promise<VideoSource[]> } = {
    Dailymotion: extractDailymotion,
    Filemoon: extractByse,
    VOE: extractVoe,
};

class Provider {
    getSettings(): Settings {
        return { episodeServers: ["Dailymotion", "Filemoon", "VOE"], supportsDub: false };
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const media = opts.media;
        const titles = [opts.query, media && media.romajiTitle, media && media.englishTitle].concat(
            media && media.synonyms || []
        );
        const named = titles.filter((title): title is string => !!title && title.trim() !== "");
        const queries = named
            .concat(named.map(withoutSeasonNumber))
            .filter((title, i, all) => title !== "" && all.indexOf(title) === i);

        for (const query of queries.slice(0, 6)) {
            const res = await get(`${BASE_URL}/buscar.php?s=${encodeURIComponent(query)}`);
            if (!res.ok) continue;

            const results: SearchResult[] = [];
            const cards = allMatches(/<article class="donghua-card">\s*<a href="\/([^"\/]+)\/"[\s\S]*?<h3 class="card-title">([^<]+)<\/h3>/, res.text());

            for (const [, slug, title] of cards) {
                results.push({ id: slug, title: decodeEntities(title.trim()), url: `${BASE_URL}/${slug}/`, subOrDub: "sub" });
            }

            if (results.length > 0) return rankByEpisodes(results, media);
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

    private async resolve(episode: EpisodeDetails, name: string): Promise<VideoSource[]> {
        const key = `sd:${episode.url}:${name}`;

        const cached = remember<VideoSource[]>(key, RESOLVED_MS);
        if (cached) return cached;

        const videoSources = await EXTRACTORS[name](await embedUrl(episode.url, name));
        if (videoSources.length === 0) throw new Error(`${name} no devolvió fuentes`);

        keep(key, videoSources);
        return videoSources;
    }

    /**
     * Seanime keeps the server the viewer picked by name, so when it fails
     * (a removed video, a blocked CDN) the next one that resolves is answered
     * under the asked name, as AnimeAV1 does, rather than leaving the player loading.
     */
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const names = Object.keys(EXTRACTORS);
        const wanted = names.find(known => known.toLowerCase() === server.toLowerCase());
        if (!wanted) throw new Error(`Servidor desconocido: ${server}`);

        let firstError: unknown;

        for (const name of [wanted, ...names.filter(known => known !== wanted)]) {
            try {
                const videoSources = await this.resolve(episode, name);
                if (name !== wanted) console.error(`SeriesDonghua: ${wanted} falló, se usa ${name}`);

                return { server: wanted, headers: { "User-Agent": BROWSER_UA }, videoSources };
            } catch (err) {
                firstError = firstError || err;
            }
        }

        throw firstError;
    }
}
