// Tipos del contrato de Seanime para providers de onlinestream.
// Se declaran aquí porque el runtime los provee: esbuild los borra al transpilar
// y así el archivo es autocontenido (no hay .d.ts que referenciar en el repo).

declare type SubOrDub = "sub" | "dub" | "both";

declare type VideoSourceType = "mp4" | "m3u8" | "unknown";

declare interface Settings {
    episodeServers: string[];
    supportsDub: boolean;
}

declare interface FuzzyDate {
    year: number;
    month?: number;
    day?: number;
}

declare interface Media {
    id: number;
    idMal?: number;
    status?: string;
    format?: string;
    englishTitle?: string;
    romajiTitle?: string;
    episodeCount?: number;
    synonyms: string[];
    isAdult: boolean;
    startDate?: FuzzyDate;
}

declare interface SearchOptions {
    media: Media;
    query: string;
    dub: boolean;
    year?: number;
}

declare interface SearchResult {
    id: string;
    title: string;
    url: string;
    subOrDub: SubOrDub;
}

declare interface EpisodeDetails {
    id: string;
    number: number;
    url: string;
    title?: string;
}

declare interface VideoSubtitle {
    id: string;
    url: string;
    language: string;
    isDefault: boolean;
}

declare interface VideoSource {
    url: string;
    type: VideoSourceType;
    quality: string;
    label?: string;
    subtitles: VideoSubtitle[];
}

declare interface EpisodeServer {
    server: string;
    headers: { [key: string]: string };
    videoSources: VideoSource[];
}

declare interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    noCloudflareBypass?: boolean;
    redirect?: "follow" | "manual" | "error";
    /** Timeout en segundos. Por defecto 35. */
    timeout?: number;
}

declare interface FetchResponse {
    status: number;
    statusText: string;
    ok: boolean;
    url: string;
    headers: Record<string, string>;

    text(): string;

    json<T = any>(): T;
}

declare function fetch(url: string, options?: FetchOptions): Promise<FetchResponse>;

/**
 * AnimeAV1 usa SvelteKit, así que cada página expone su estado en `__data.json`.
 * Ese JSON viene serializado con devalue: `data` es un array plano donde los
 * objetos guardan índices en vez de valores, y hay que ir resolviendo punteros.
 */
// Cloudflare bloquea los segmentos (/segs/) del reproductor si la petición no
// parece venir del propio player: sin Sec-Fetch-Site responde 403, el player se
// atasca y Seanime reintenta la fuente en bucle. Estas cabeceras las reenvía el
// proxy de Seanime en cada segmento, no solo en la playlist.
const HLS_HEADERS: { [key: string]: string } = {
    "Referer": "https://player.zilla-networks.com/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

class Provider {
    private baseUrl = "https://animeav1.com";

    getSettings(): Settings {
        // Seanime pide TODOS los servidores de esta lista antes de devolver
        // ninguna fuente, así que un servidor lento retrasa cada reproducción.
        // mp4upload responde en <1s casi siempre, pero se cuelga ~32s cada
        // tantas peticiones, y el `timeout` de fetch no se aplica (Seanime lo
        // lee con .(int) y goja exporta los enteros como int64), así que ese
        // cuelgue se come el arranque entero. Queda fuera de la lista; el
        // extractor sigue abajo por si se quiere reactivar.
        return {
            episodeServers: ["HLS"],
            supportsDub: true,
        };
    }

    // El runtime no expone AbortController ni setTimeout. `timeout` tampoco
    // surte efecto por el bug de tipos de arriba: cada petición se corta a los
    // 35s por defecto, así que conviene no multiplicar reintentos.
    private async fetchWithRetry(url: string, retries: number = 2): Promise<FetchResponse> {
        let lastErr: unknown = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await fetch(url, { timeout: 15 });

                // Los 5xx de animeav1 suelen ser transitorios: reintentar.
                if (res.status >= 500 && attempt < retries) continue;

                return res;
            } catch (err) {
                lastErr = err;
            }
        }

        throw lastErr ?? new Error(`No se pudo conectar con ${url}`);
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

    /** Minúsculas, sin acentos ni signos, para comparar títulos. */
    private normalize(value: string): string {
        return value
            .toLowerCase()
            .replace(/[áàäâã]/g, "a")
            .replace(/[éèëê]/g, "e")
            .replace(/[íìïî]/g, "i")
            .replace(/[óòöôõ]/g, "o")
            .replace(/[úùüû]/g, "u")
            .replace(/ñ/g, "n")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    /** Parecido por solapamiento de palabras (Dice). Barato y suficiente. */
    private similarity(a: string, b: string): number {
        const x = this.normalize(a).split(" ").filter(Boolean);
        const y = this.normalize(b).split(" ").filter(Boolean);
        if (x.length === 0 || y.length === 0) return 0;

        const pool = y.slice();
        let hits = 0;

        for (const word of x) {
            const at = pool.indexOf(word);
            if (at !== -1) {
                hits++;
                pool.splice(at, 1);
            }
        }

        return (2 * hits) / (x.length + y.length);
    }

    /** Todos los títulos que Seanime conoce de la obra. */
    private mediaTitles(media?: Media): string[] {
        if (!media) return [];

        const titles = [media.romajiTitle, media.englishTitle, ...(media.synonyms || [])];
        return titles.filter((t): t is string => typeof t === "string" && t.trim() !== "");
    }

    private bestScore(results: SearchResult[], titles: string[]): number {
        let best = 0;

        for (const result of results) {
            for (const title of titles) {
                const score = this.similarity(result.title, title);
                if (score > best) best = score;
            }
        }

        return best;
    }

    private async searchOnce(query: string, isDub: boolean): Promise<SearchResult[]> {
        const params = new URLSearchParams();
        params.append("page", "1");

        if (query && query.trim() !== "") params.append("search", query);

        const res = await this.fetchWithRetry(`${this.baseUrl}/catalogo/__data.json?${params.toString()}`);
        if (!res.ok) return [];

        return this._resolveRemixData(res.json(), isDub);
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const isDub = opts.dub || false;
        const titles = this.mediaTitles(opts.media);

        try {
            const results = await this.searchOnce(opts.query, isDub);

            // El catálogo está titulado en romaji, así que buscar por el título
            // en inglés suele devolver 20 resultados sin relación. Seanime elige
            // por distancia mínima sin umbral, o sea que con solo basura en la
            // lista acaba escogiendo la obra equivocada en silencio. Si nada se
            // parece a lo que buscamos, reintentamos con los otros títulos.
            if (titles.length === 0 || this.bestScore(results, titles) >= 0.6) {
                return results;
            }

            const seen: { [id: string]: boolean } = {};
            const merged: SearchResult[] = [];

            for (const result of results) {
                if (seen[result.id]) continue;
                seen[result.id] = true;
                merged.push(result);
            }

            const tried = [this.normalize(opts.query)];

            for (const title of titles.slice(0, 3)) {
                const key = this.normalize(title);
                if (tried.indexOf(key) !== -1) continue;
                tried.push(key);

                const extra = await this.searchOnce(title, isDub);
                for (const result of extra) {
                    if (seen[result.id]) continue;
                    seen[result.id] = true;
                    merged.push(result);
                }

                if (this.bestScore(merged, titles) >= 0.6) break;
            }

            return merged;
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
            const res = await this.fetchWithRetry(url);
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

            return episodes;
        } catch (err) {
            console.error("Error finding episodes:", err);
            return [];
        }
    }

    /** MP4Upload deja el mp4 directo en el HTML del embed, sin ofuscar. */
    private async extractMp4Upload(embedUrl: string): Promise<VideoSource | null> {
        // Sin reintentos: si mp4upload se cuelga, cada intento cuesta 35s.
        const res = await this.fetchWithRetry(embedUrl, 0);
        if (!res.ok) return null;

        const match = res.text().match(/src:\s*"([^"]+\.mp4[^"]*)"/);
        if (!match) return null;

        return {
            url: match[1],
            type: "mp4",
            quality: "auto",
            subtitles: [],
        };
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        // Seanime manda el EpisodeDetails completo, pero aceptamos el id suelto por si acaso.
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

        const url = `${this.baseUrl}/media/${slug}/${number}/__data.json`;

        try {
            const res = await this.fetchWithRetry(url);
            if (!res.ok) throw new Error("Error obteniendo datos");

            const json = res.json();

            let data: any[] | null = null;
            let root: any = null;

            for (const node of json?.nodes || []) {
                if (!node?.data) continue;

                const found = node.data.find(
                    (item: any) => item && typeof item === "object" && "embeds" in item
                );

                if (found) {
                    data = node.data;
                    root = found;
                    break;
                }
            }

            if (!data || !root) throw new Error("No se encontraron servidores");

            const category = type.toUpperCase();
            const listIndex = data[root.embeds]?.[category];
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

            let source: VideoSource | null = null;
            let headers: { [key: string]: string } = {};

            if (wanted === "HLS") {
                source = {
                    url: embedUrl.replace("/play/", "/m3u8/"),
                    type: "m3u8",
                    quality: "auto",
                    subtitles: [],
                };
                headers = HLS_HEADERS;
            } else if (wanted === "MP4UPLOAD") {
                source = await this.extractMp4Upload(embedUrl);
                headers = { Referer: "https://www.mp4upload.com/" };
            }

            if (!source) throw new Error(`No se pudo extraer el video de ${serverName}`);

            return {
                server: serverName,
                headers,
                videoSources: [source],
            };
        } catch (err) {
            console.error("Error finding episode server:", err);
            throw err;
        }
    }
}
