// <reference path="../online-streaming-provider.d.ts" />

class Provider {
    baseUrl = "https://animeav1.com";
    cdnUrl = "https://cdn.animeav1.com";

    getSettings(): Settings {
        return {
            episodeServers: ["HLS", "MP4Upload"],
            supportsDub: true,
        };
    }

    // El runtime de Seanime no expone AbortController ni setTimeout.
    // fetch acepta `timeout` (segundos) y ya aborta solo, así que no hace falta nada más.
    private async fetchWithRetry(url: string, retries: number = 2): Promise<Response> {
        let lastErr: unknown = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await fetch(url, { timeout: 15 });

                // 5xx suele ser un fallo transitorio del backend: reintentar.
                if (res.status >= 500 && attempt < retries) continue;

                return res;
            } catch (err) {
                lastErr = err;
            }
        }

        throw lastErr ?? new Error(`No se pudo conectar con ${url}`);
    }

    private _resolveRemixData(json: any, isDub: boolean): SearchResult[] {
        if (!json || !json.nodes) return [];

        for (const node of json.nodes) {
            if (node && node.uses && node.uses.search_params) {
                const data = node.data;
                if (!data || data.length === 0) continue;

                const rootConfig = data[0];
                if (!rootConfig || typeof rootConfig.results !== 'number') continue;

                const resultsIndex = rootConfig.results;
                const animePointers = data[resultsIndex];

                if (!Array.isArray(animePointers)) continue;

                return animePointers.map((pointer: number) => {
                    const rawObj = data[pointer];
                    if (!rawObj) return null;

                    const realId = data[rawObj.id];
                    const title = data[rawObj.title];
                    const slug = data[rawObj.slug];

                    if (!title || !slug) return null;

                    const idPayload = JSON.stringify({ slug: slug, type: isDub ? "dub" : "sub" });

                    return {
                        id: idPayload,
                        title: title,
                        url: `${this.baseUrl}/media/${slug}`,
                        image: realId ? `${this.cdnUrl}/covers/${realId}.jpg` : undefined,
                        subOrDub: isDub ? "dub" : "sub"
                    };
                }).filter(Boolean) as SearchResult[];
            }
        }
        return [];
    }

    async search(query: SearchOptions): Promise<SearchResult[]> {
        const params = new URLSearchParams();
        params.append('page', '1');

        if (query.query && query.query.trim() !== "") {
            params.append('search', query.query);
        }

        const url = `${this.baseUrl}/catalogo/__data.json?${params.toString()}`;

        try {
            const response = await this.fetchWithRetry(url);
            if (!response.ok) return [];
            const json = await response.json();

            return this._resolveRemixData(json, query.dub || false);
        } catch (error) {
            console.error("Error searching AnimeAV1:", error);
            return [];
        }
    }

    async findEpisodes(animeId: string): Promise<EpisodeDetails[]> {

        let slug: string;
        let type: "sub" | "dub" = "sub";

        try {
            const parsed = JSON.parse(animeId);
            slug = parsed.slug;
            if (parsed.type) type = parsed.type;
        } catch {

            slug = animeId;
        }

        const url = `${this.baseUrl}/media/${slug}/__data.json`;

        try {
            const res = await this.fetchWithRetry(url);
            if (!res.ok) throw new Error("Error fetching episodes");

            const json = await res.json();
            const nodes = json.nodes || [];

            let data: any[] | null = null;
            let mediaDescriptor: any = null;

            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node?.data) continue;

                for (const obj of node.data) {
                    if (obj && typeof obj === 'object' && 'slug' in obj && 'episodes' in obj) {
                        const slugPointer = obj.slug;
                        if (typeof slugPointer === 'number' && node.data[slugPointer] === slug) {
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

            const mediaId = data[mediaDescriptor.id];
            const image = mediaId ? `${this.cdnUrl}/backdrops/${mediaId}.jpg` : undefined;

            return episodeIndexes
                .map((epIdx: number, i: number) => {
                    const ep = data![epIdx];

                    let realNumber = i + 1;

                    if (typeof ep.number === 'number') {
                        const resolvedNum = data![ep.number];

                        if (typeof resolvedNum === 'number') {
                            realNumber = resolvedNum;
                        }
                    }

                    if (!Number.isInteger(realNumber) || realNumber <= 0) return null;

                    let realTitle = `Episodio ${realNumber}`;

                    if (typeof ep.title === 'number') {
                        realTitle = data![ep.title];
                    } else if (ep.title) {
                        realTitle = ep.title;
                    }

                    const episodeIdPayload = JSON.stringify({
                        slug,
                        number: realNumber,
                        type
                    });

                    return {
                        id: episodeIdPayload,
                        number: realNumber,
                        title: realTitle,
                        url: `${this.baseUrl}/media/${slug}/${realNumber}`,
                        image
                    };
                })
                .filter(Boolean) as EpisodeDetails[];

        } catch (err) {
            console.error('Error finding episodes:', err);
            return [];
        }
    }

    private async extractMp4Upload(embedUrl: string): Promise<VideoSource | null> {
        const res = await this.fetchWithRetry(embedUrl);
        if (!res.ok) return null;
        const html = await res.text();

        const match = html.match(/src:\s*"([^"]+\.mp4[^"]*)"/);
        if (!match) return null;

        return {
            url: match[1],
            type: "mp4",
            quality: "auto",
            subtitles: [],
        };
    }

    async findEpisodeServer(episodeOrId: any, server: string): Promise<EpisodeServer> {
        let slug: string;
        let number: number;
        let type: string = "sub";

        const idStr = typeof episodeOrId === "string" ? episodeOrId : episodeOrId.id;

        try {
            const parsed = JSON.parse(idStr);
            slug = parsed.slug;
            number = parsed.number;
            if (parsed.type) type = parsed.type;
        } catch (e) {
            throw new Error("ID inválido");
        }

        const pageUrl = `${this.baseUrl}/media/${slug}/${number}/__data.json`;

        try {
            const res = await this.fetchWithRetry(pageUrl);
            if (!res.ok) throw new Error("Error obteniendo datos");
            const json = await res.json();

            let data: any[] | null = null;
            let root: any = null;

            if (json.nodes) {
                for (const node of json.nodes) {
                    if (node?.data) {
                        const foundRoot = node.data.find((item: any) => item && typeof item === 'object' && 'embeds' in item);
                        if (foundRoot) {
                            data = node.data;
                            root = foundRoot;
                            break;
                        }
                    }
                }
            }

            if (!data || !root) throw new Error("No se encontraron servidores");

            const embedsIndex = root.embeds;
            const embedsObj = data[embedsIndex];

            const catKey = type.toUpperCase();

            const listIndex = embedsObj?.[catKey];

            if (typeof listIndex !== "number") throw new Error(`No hay contenido en ${catKey}`);

            const serverList = data[listIndex];
            if (!Array.isArray(serverList)) throw new Error("Lista vacía");

            const requestedServer = (server || "HLS").trim().toUpperCase();

            let embedLink: string | null = null;
            let resolvedServer: string | null = null;

            for (const ptr of serverList) {
                const srv = data[ptr];
                if (!srv) continue;
                const serverName = data[srv.server];
                const link = data[srv.url];

                if (!serverName || !link) continue;

                if (String(serverName).trim().toUpperCase() === requestedServer) {
                    embedLink = link;
                    resolvedServer = serverName;
                    break;
                }
            }

            if (!embedLink || !resolvedServer) throw new Error(`No se encontró servidor ${server} para ${type}`);

            let chosen: VideoSource | null = null;
            let headers: { [key: string]: string } = {};

            if (requestedServer === "HLS") {
                chosen = {
                    url: embedLink.replace("/play/", "/m3u8/"),
                    type: "m3u8",
                    quality: "auto",
                    subtitles: [],
                };
                headers = { Referer: "null", "Sec-Fetch-Site": "same-origin" };
            } else if (requestedServer === "MP4UPLOAD") {
                chosen = await this.extractMp4Upload(embedLink);
                headers = { Referer: "https://www.mp4upload.com/" };
            }

            if (!chosen) throw new Error(`No se pudo extraer el video de ${resolvedServer}`);

            return {
                server: resolvedServer,
                headers,
                videoSources: [chosen]
            };
        } catch (err) {
            console.error('Error finding episode server:', err);
            throw err;
        }
    }
}