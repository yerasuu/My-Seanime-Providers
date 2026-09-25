/// <reference path="../../online-streaming-provider.d.ts" />
/// <reference path="store.ts" />
/// <reference path="http.ts" />
/// <reference path="titles.ts" />
/// <reference path="extractors/hls.ts" />
/// <reference path="extractors/mp4upload.ts" />
/// <reference path="extractors/voe.ts" />
/// <reference path="extractors/upnshare.ts" />
/// <reference path="extractors/byse.ts" />

/**
 * AnimeAV1 runs on SvelteKit, so every page exposes its state at `__data.json`.
 * devalue serialises that JSON: `data` is a flat array whose objects hold
 * indices instead of values, so reading anything means following pointers.
 */
class Provider {
    private baseUrl = "https://animeav1.com";

    getSettings(): Settings {
        /**
         * Seanime asks for every server listed here before it hands back any
         * source, so all of them are resolved even when only one gets watched.
         * HLS stays first for the episodes that still carry it; by September
         * 2026 the site had stopped listing it, and a server an episode lacks
         * fails at once from the cached embeds table. mp4upload goes last as
         * the fallback, and it looks after its own stalls, so a bad spell on
         * its side costs the fallback rather than the episode.
         */
        return {
            episodeServers: ["HLS", "UPNShare", "Byse", "Voe", "MP4Upload"],
            supportsDub: true,
        };
    }


    private buildAnimeId(slug: string, isDub: boolean): string {
        return JSON.stringify({ slug, type: isDub ? "dub" : "sub" });
    }

    private _resolveRemixData(json: any, isDub: boolean): SearchResult[] {
        if (!json || !json.nodes) return [];

        for (const node of json.nodes) {
            if (node && node.uses && node.uses.search_params) {
                const data = node.data;
                if (!data || data.length === 0) continue;

                const rootConfig = data[0];
                if (!rootConfig || typeof rootConfig.results !== "number") continue;

                const animePointers = data[rootConfig.results];
                if (!Array.isArray(animePointers)) continue;

                const results: SearchResult[] = [];

                for (const pointer of animePointers) {
                    const rawObj = data[pointer];
                    if (!rawObj) continue;

                    const title = data[rawObj.title];
                    const slug = data[rawObj.slug];
                    if (!title || !slug) continue;

                    results.push({
                        id: this.buildAnimeId(slug, isDub),
                        title,
                        url: `${this.baseUrl}/media/${slug}`,
                        subOrDub: isDub ? "dub" : "sub",
                    });
                }

                return results;
            }
        }

        return [];
    }

    /**
     * Seanime searches once per romaji title and once per english, and a miss
     * sends us back out with the remaining titles, so the same query comes up
     * repeatedly while one episode list is being built. The store outlives a
     * single call and is shared across this extension's VMs, so remember what
     * each query returned for a few minutes.
     */
    private async searchOnce(query: string, isDub: boolean): Promise<SearchResult[]> {
        const key = `av1:search:${isDub ? "dub" : "sub"}:${normalize(query)}`;

        const cached = remember<SearchResult[]>(key);
        if (cached) return cached;

        const params = new URLSearchParams();
        params.append("page", "1");

        if (query && query.trim() !== "") params.append("search", query);

        const res = await fetchWithRetry(`${this.baseUrl}/catalogo/__data.json?${params.toString()}`);
        if (!res.ok) return [];

        const results = this._resolveRemixData(res.json(), isDub);
        keep(key, results);

        return results;
    }


    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const isDub = opts.dub || false;
        /**
         * Every title is fair game as a search query; only the primary ones
         * are trusted to say which entry we are looking at.
         */
        const titles = mediaTitles(opts.media);
        const primary = primaryTitles(opts.media);

        /**
         * Overriding Seanime is for series, where the decoy is a neighbouring
         * season. Films number and romanise themselves however they like -
         * "Evangelion Shin Movie: Kyuu" is the same film as "Evangelion Movie
         * 3: Q" - and there is no season to reason about, so leave them alone.
         */
        const narrow = (opts.media && opts.media.format || "").toUpperCase() !== "MOVIE";

        /**
         * Seanime searches the same anime twice, once per title, and merges the
         * two lists by id. animeav1 drops roughly one connection in six and a
         * dropped one hangs for a quarter of a minute before it gives up, so
         * the second search is mostly another chance to stall. Answer it from
         * what the first one worked out.
         */
        const cacheKey = opts.media && opts.media.id
            ? `av1:media:${opts.media.id}:${isDub ? "dub" : "sub"}`
            : "";

        const cached = cacheKey ? remember<SearchResult[]>(cacheKey) : undefined;
        if (cached) return cached;

        try {
            const results = await this.searchOnce(opts.query, isDub);

            /**
             * The catalog is titled in romaji, so searching by english title
             * tends to return twenty unrelated entries. Seanime picks whichever
             * result sits closest and applies no threshold, so a list of noise
             * still resolves to some anime, silently the wrong one. When nothing
             * resembles what we are after, search again with the other titles.
             */
            if (titles.length === 0) return results;

            if (bestScore(results, primary) >= 0.6) {
                const kept = dropOtherSeasons(results, titles);
                const picked = narrow ? narrowToBest(kept, primary) : kept;
                if (cacheKey) keep(cacheKey, picked);
                return picked;
            }

            const seen: { [id: string]: boolean } = {};
            const merged: SearchResult[] = [];

            for (const result of results) {
                if (seen[result.id]) continue;
                seen[result.id] = true;
                merged.push(result);
            }

            const tried = [normalize(opts.query)];

            for (const title of titles.slice(0, 3)) {
                const key = normalize(title);
                if (tried.indexOf(key) !== -1) continue;
                tried.push(key);

                const extra = await this.searchOnce(title, isDub);
                for (const result of extra) {
                    if (seen[result.id]) continue;
                    seen[result.id] = true;
                    merged.push(result);
                }

                if (bestScore(merged, primary) >= 0.6) break;
            }

            const kept = dropOtherSeasons(merged, titles);
            const picked = narrow ? narrowToBest(kept, primary) : kept;
            if (cacheKey) keep(cacheKey, picked);
            return picked;
        } catch (err) {
            console.error("Error searching AnimeAV1:", err);
            return [];
        }
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        let slug: string;
        let type: SubOrDub = "sub";

        try {
            const parsed = JSON.parse(id);
            slug = parsed.slug;
            if (parsed.type) type = parsed.type;
        } catch {
            slug = id;
        }

        const url = `${this.baseUrl}/media/${slug}/__data.json`;

        try {
            const res = await fetchWithRetry(url);
            if (!res.ok) throw new Error("Error fetching episodes");

            const json = res.json();
            const nodes = json.nodes || [];

            let data: any[] | null = null;
            let mediaDescriptor: any = null;

            for (const node of nodes) {
                if (!node?.data) continue;

                for (const obj of node.data) {
                    if (obj && typeof obj === "object" && "slug" in obj && "episodes" in obj) {
                        const slugPointer = obj.slug;
                        if (typeof slugPointer === "number" && node.data[slugPointer] === slug) {
                            data = node.data;
                            mediaDescriptor = obj;
                            break;
                        }
                    }
                }

                if (data) break;
            }

            if (!data || !mediaDescriptor) throw new Error("Anime no encontrado");

            const episodeIndexes = data[mediaDescriptor.episodes];
            if (!Array.isArray(episodeIndexes)) throw new Error("Lista inválida");

            const episodes: EpisodeDetails[] = [];

            episodeIndexes.forEach((epIdx: number, i: number) => {
                const ep = data![epIdx];
                if (!ep) return;

                let number = i + 1;
                if (typeof ep.number === "number") {
                    const resolved = data![ep.number];
                    if (typeof resolved === "number") number = resolved;
                }

                if (!Number.isInteger(number) || number <= 0) return;

                let title = `Episodio ${number}`;
                if (typeof ep.title === "number") {
                    title = data![ep.title];
                } else if (ep.title) {
                    title = ep.title;
                }

                episodes.push({
                    id: JSON.stringify({ slug, number, type }),
                    number,
                    title,
                    url: `${this.baseUrl}/media/${slug}/${number}`,
                });
            });

            /**
             * Sub is what the site always carries; a dub is the exception, and
             * the anime's own page never says which. Settle it here rather than
             * hand back a list whose every episode fails once Seanime asks for
             * an audio track that was never there. Where no dub exists the
             * episodes are handed back as sub, so the show still plays.
             */
            if (type === "dub" && episodes.length > 0 && !(await this.hasDub(slug, episodes[0].number))) {
                console.error(`AnimeAV1: ${slug} no tiene doblaje, se usa el sub`);

                return episodes.map(episode => ({
                    ...episode,
                    id: JSON.stringify({ slug, number: episode.number, type: "sub" }),
                }));
            }

            return episodes;
        } catch (err) {
            console.error("Error finding episodes:", err);
            return [];
        }
    }

    /**
     * An episode page's embeds table, with the array its indices point into.
     *
     * Seanime asks for one server at a time and every one of them needs this
     * same page, so fetching it once and keeping it briefly is the difference
     * between one request per episode and one per server.
     */
    private async episodeEmbeds(slug: string, number: number): Promise<{ data: any[]; embeds: any } | null> {
        const key = `av1:ep:${slug}:${number}`;

        const cached = remember<{ data: any[]; embeds: any }>(key);
        if (cached) return cached;

        const res = await fetchWithRetry(`${this.baseUrl}/media/${slug}/${number}/__data.json`);
        if (!res.ok) return null;

        const json = res.json();

        for (const node of json?.nodes || []) {
            if (!node?.data) continue;

            const root = node.data.find(
                (item: any) => item && typeof item === "object" && "embeds" in item
            );

            if (root) {
                const found = { data: node.data, embeds: node.data[root.embeds] || {} };
                keep(key, found);
                return found;
            }
        }

        return null;
    }

    /**
     * Which audio an episode page carries, as the keys of its embeds object:
     * ["SUB"] on its own, or ["SUB", "DUB"] where a dub exists.
     */
    private async audioTracks(slug: string, number: number): Promise<string[]> {
        const found = await this.episodeEmbeds(slug, number);
        return found ? Object.keys(found.embeds) : [];
    }

    /**
     * Whether this anime is dubbed at all.
     *
     * Nothing on the anime's own page says so - the two look alike whether a
     * dub exists or not - so it takes looking at an episode. Worth the one
     * request: without it Seanime lists every episode, then fails on each one
     * in turn as it asks for an audio track that was never there.
     */
    private async hasDub(slug: string, number: number): Promise<boolean> {
        const key = `av1:dub:${slug}`;

        const cached = remember<boolean>(key);
        if (cached !== undefined) return cached;

        const dubbed = (await this.audioTracks(slug, number)).indexOf("DUB") !== -1;

        keep(key, dubbed);
        return dubbed;
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        // Seanime passes the whole EpisodeDetails, but accept a bare id too.
        const rawId = typeof episode === "string" ? episode : episode.id;

        let slug: string;
        let number: number;
        let type: SubOrDub = "sub";

        try {
            const parsed = JSON.parse(rawId);
            slug = parsed.slug;
            number = parsed.number;
            if (parsed.type) type = parsed.type;
        } catch {
            throw new Error("ID inválido");
        }

        try {
            const found = await this.episodeEmbeds(slug, number);
            if (!found) throw new Error("No se encontraron servidores");

            const data = found.data;
            const embeds = found.embeds;
            const category = type.toUpperCase();

            /**
             * A dub can also stop partway through a run, so fall back per
             * episode as well and play the sub rather than nothing.
             */
            let listIndex = embeds[category];
            if (typeof listIndex !== "number" && category === "DUB") {
                listIndex = embeds["SUB"];
                if (typeof listIndex === "number") {
                    console.error(`AnimeAV1: ${slug} ${number} sin doblaje, se usa el sub`);
                }
            }

            if (typeof listIndex !== "number") throw new Error(`No hay contenido en ${category}`);

            const serverList = data[listIndex];
            if (!Array.isArray(serverList)) throw new Error("Lista vacía");

            const wanted = (server || "HLS").trim().toUpperCase();

            let embedUrl: string | null = null;
            let serverName: string | null = null;

            for (const ptr of serverList) {
                const entry = data[ptr];
                if (!entry) continue;

                const name = data[entry.server];
                const link = data[entry.url];
                if (!name || !link) continue;

                if (String(name).trim().toUpperCase() === wanted) {
                    embedUrl = link;
                    serverName = name;
                    break;
                }
            }

            if (!embedUrl || !serverName) {
                throw new Error(`No se encontró servidor ${server} para ${type}`);
            }

            let sources: VideoSource[] = [];
            let headers: { [key: string]: string } = {};

            if (wanted === "HLS") {
                sources = [{
                    url: embedUrl.replace("/play/", "/m3u8/"),
                    type: "m3u8",
                    quality: "auto",
                    subtitles: [],
                }];
                headers = HLS_HEADERS;
            } else if (wanted === "UPNSHARE") {
                sources = await extractUpnShare(embedUrl);
                headers = upnShareHeaders(embedUrl);
            } else if (wanted === "BYSE") {
                sources = await extractByse(embedUrl);
                headers = PLAIN_HEADERS;
            } else if (wanted === "VOE") {
                sources = await extractVoe(embedUrl);
                headers = PLAIN_HEADERS;
            } else if (wanted === "MP4UPLOAD") {
                const source = await extractMp4Upload(embedUrl);
                if (source) sources = [source];
                headers = MP4UPLOAD_HEADERS;
            }

            if (sources.length === 0) throw new Error(`No se pudo extraer el video de ${serverName}`);

            return {
                server: serverName,
                headers,
                videoSources: sources,
            };
        } catch (err) {
            console.error("Error finding episode server:", err);
            throw err;
        }
    }
}
