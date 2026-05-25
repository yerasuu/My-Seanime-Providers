interface Settings {
    supportsMultiLanguage: boolean;
    supportsMultiScanlator: boolean;
}

interface QueryOptions {
    query: string;
}

interface SearchResult {
    id: string;
    title: string;
    image?: string;
}

interface ChapterDetails {
    id: string;
    url: string;
    title: string;
    chapter: string;
    index: number;
    language: string;
    scanlator: string;
}

interface ScanGroup {
    id: number;
    nombre: string;
    slug: string;
    logo: string;
    color: string | null;
}

interface ApiChapter {
    id: number;
    publicId: string;
    numeroCapitulo: number;
    titulo: string;
    totalPaginas: number;
    fechaSubida: string;
    orden: number;
    visible: boolean;
    tomoId: number | null;
    grupoScan: ScanGroup;
    score: number;
    miVoto: number | null;
}

interface ChapterPage {
    url: string;
    index: number;
    headers: Record<string, string>;
}

interface ApiPagesResponse {
    paginas: string[];
    totalPaginas: number;
    capituloId: number;
    publicCapituloId: string;
    serieId: number;
    publicSerieId: string;
    numeroCapitulo: number;
    grupoScan: ScanGroup;
    score: number;
    miVoto: number | null;
}

class Provider {
    private web = "https://shademanga.com"
    private api = "https://shademanga.com/api"
    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        }
    }

    async fetchWithHeaders(url: string, baseApi?: string) {
        const referer = baseApi || this.web;
        return fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Referer": referer,
            }
        })
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const query = encodeURIComponent(opts.query);
        const url = `${this.api}/series-locales/search-candidates?q=${query}&includeAdult=true&showSinPortada=false&take=120`;

        try {
            const response = await this.fetchWithHeaders(url);
            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            const results: SearchResult[] = [];
            const series = Array.isArray(data) ? data : data.series || data.data || [];

            for (const item of series) {
                const id = item.id;
                const title = item.titulo;
                const image = item.portadaUrl || "";

                if (id && title) {
                    results.push({
                        id: String(id),
                        title,
                        image,
                    });
                }
            }

            return results;
        } catch (e) {
            return [];
        }
    }

    async findChapters(mangaId: string): Promise<ChapterDetails[]> {
        const chapters: ChapterDetails[] = [];
        const url = `${this.api}/series-locales/${mangaId}/capitulos`;

        try {
            const response = await this.fetchWithHeaders(url, this.api);
            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            const chapterList = Array.isArray(data) ? data : data.data || [];

            for (let index = 0; index < chapterList.length; index++) {
                const chapter = chapterList[index];
                const chapterId = chapter.publicId;
                const chapterNum = chapter.numeroCapitulo;
                const chapterTitle = `Capítulo ${chapterNum}`;
                const scanGroup = chapter.grupoScan?.nombre || "Unknown";

                if (chapterId && chapterNum) {
                    chapters.push({
                        id: `${mangaId}/${chapterId}`,
                        url: `${this.api}/series-locales/${mangaId}/capitulos/${chapterId}/paginas`,
                        title: chapterTitle,
                        chapter: String(chapterNum),
                        index,
                        language: "es",
                        scanlator: scanGroup
                    });
                }
            }

            return chapters;
        } catch (e) {
            return [];
        }
    }

    async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
        const parts = chapterId.split('/');
        const mangaId = parts[parts.length - 2];
        const publicChapterId = parts[parts.length - 1];

        const apiUrl = `${this.api}/series-locales/${mangaId}/capitulos/${publicChapterId}/paginas`;

        try {
            const response = await this.fetchWithHeaders(apiUrl, this.api);
            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            const pages: ChapterPage[] = [];

            if (!data || !Array.isArray(data.paginas)) {
                return [];
            }

            for (let index = 0; index < data.paginas.length; index++) {
                const pageUrl = data.paginas[index];
                if (typeof pageUrl === 'string' && pageUrl.length > 0) {
                    pages.push({
                        url: pageUrl,
                        index,
                        headers: {
                            "Referer": this.api,
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                        }
                    });
                }
            }

            return pages;
        } catch (e) {
            return [];
        }
    }
}