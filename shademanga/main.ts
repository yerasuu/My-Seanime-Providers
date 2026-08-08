// Tipos del contrato de Seanime para providers de manga.
// El runtime los provee; esbuild los borra al transpilar.

declare interface Settings {
    supportsMultiLanguage?: boolean;
    supportsMultiScanlator?: boolean;
}

declare interface QueryOptions {
    query: string;
    year?: number;
}

declare interface SearchResult {
    id: string;
    title: string;
    synonyms?: string[];
    year?: number;
    image?: string;
    imageHeaders?: { [key: string]: string };
}

declare interface ChapterDetails {
    id: string;
    url: string;
    title: string;
    chapter: string;
    index: number;
    scanlator?: string;
    language?: string;
    rating?: number;
    updatedAt?: string;
}

declare interface ChapterPage {
    url: string;
    index: number;
    headers: { [key: string]: string };
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

/** Respuestas de la API de ShadeManga. */
interface ScanGroup {
    id: number;
    nombre: string;
    slug: string;
    logo: string;
    color: string | null;
}

interface ApiSearchItem {
    id: number;
    titulo: string;
    portadaUrl?: string;
    titulosAlternativos?: string;
}

interface ApiChapterItem {
    id: number;
    publicId: string;
    numeroCapitulo: number;
    titulo?: string;
    grupoScan?: ScanGroup;
}

interface ApiPagesResponse {
    paginas: string[];
}

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// El contrato pide que el delimitador de los IDs compuestos no sea una barra.
const ID_SEPARATOR = "$";

class Provider {
    private web = "https://shademanga.com";
    private api = "https://shademanga.com/api";

    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    private buildHeaders(referer: string): Record<string, string> {
        return {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Referer": referer,
        };
    }

    private async fetchWithRetry(url: string, referer?: string, retries: number = 2): Promise<FetchResponse> {
        let lastErr: unknown = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await fetch(url, {
                    headers: this.buildHeaders(referer || this.web),
                    timeout: 15,
                });

                if (res.status >= 500 && attempt < retries) continue;

                return res;
            } catch (err) {
                lastErr = err;
            }
        }

        throw lastErr ?? new Error(`No se pudo conectar con ${url}`);
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const query = encodeURIComponent(opts.query);
        const url = `${this.api}/series-locales/search-candidates?q=${query}&includeAdult=true&showSinPortada=false&take=120`;

        try {
            const res = await this.fetchWithRetry(url);
            if (!res.ok) return [];

            const series = res.json<ApiSearchItem[]>();
            if (!Array.isArray(series)) return [];

            const results: SearchResult[] = [];

            for (const item of series) {
                if (!item || !item.id || !item.titulo) continue;

                // titulosAlternativos viene como "Wan Pis, OP, ワンピース"; ayuda al matching.
                const synonyms = (item.titulosAlternativos || "")
                    .split(",")
                    .map(s => s.trim())
                    .filter(s => s.length > 0);

                const result: SearchResult = {
                    id: String(item.id),
                    title: item.titulo,
                };

                if (item.portadaUrl) result.image = item.portadaUrl;
                if (synonyms.length > 0) result.synonyms = synonyms;

                results.push(result);
            }

            return results;
        } catch (err) {
            console.error("Error searching ShadeManga:", err);
            return [];
        }
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const url = `${this.api}/series-locales/${id}/capitulos`;

        try {
            const res = await this.fetchWithRetry(url, this.api);
            if (!res.ok) return [];

            const chapterList = res.json<ApiChapterItem[]>();
            if (!Array.isArray(chapterList)) return [];

            const chapters: ChapterDetails[] = [];

            for (const item of chapterList) {
                if (!item || !item.publicId) continue;

                // numeroCapitulo puede ser 0 (prólogos): comparar contra null, no por falsy.
                const number = item.numeroCapitulo;
                if (typeof number !== "number") continue;

                chapters.push({
                    id: `${id}${ID_SEPARATOR}${item.publicId}`,
                    url: `${this.api}/series-locales/${id}/capitulos/${item.publicId}/paginas`,
                    title: item.titulo || `Capítulo ${number}`,
                    chapter: String(number),
                    index: chapters.length,
                });
            }

            return chapters;
        } catch (err) {
            console.error("Error finding ShadeManga chapters:", err);
            return [];
        }
    }

    async findChapterPages(id: string): Promise<ChapterPage[]> {
        // Los IDs viejos usaban "/" como separador; se siguen aceptando.
        const parts = id.split(id.indexOf(ID_SEPARATOR) !== -1 ? ID_SEPARATOR : "/");
        if (parts.length < 2) return [];

        const mangaId = parts[parts.length - 2];
        const chapterId = parts[parts.length - 1];

        const url = `${this.api}/series-locales/${mangaId}/capitulos/${chapterId}/paginas`;

        try {
            const res = await this.fetchWithRetry(url, this.api);
            if (!res.ok) return [];

            const data = res.json<ApiPagesResponse>();
            if (!data || !Array.isArray(data.paginas)) return [];

            const pages: ChapterPage[] = [];

            for (const pageUrl of data.paginas) {
                if (typeof pageUrl !== "string" || pageUrl.length === 0) continue;

                pages.push({
                    url: pageUrl,
                    index: pages.length,
                    headers: {
                        "Referer": this.api,
                        "User-Agent": USER_AGENT,
                    },
                });
            }

            return pages;
        } catch (err) {
            console.error("Error finding ShadeManga chapter pages:", err);
            return [];
        }
    }
}
