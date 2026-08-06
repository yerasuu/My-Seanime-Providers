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

interface ChapterPage {
    url: string;
    index: number;
    headers: Record<string, string>;
}

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
}

interface ApiChapterItem {
    id: number;
    publicId: string;
    numeroCapitulo: number;
    grupoScan?: ScanGroup;
}

interface ApiPagesResponse {
    paginas: string[];
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

class Provider {
    private web = "https://shademanga.com"
    private api = "https://shademanga.com/api"
    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        }
    }

    private buildHeaders(referer: string): Record<string, string> {
        return {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Referer": referer,
        }
    }

    async fetchWithHeaders(url: string, baseApi?: string) {
        return fetch(url, {
            headers: this.buildHeaders(baseApi || this.web)
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

            const series: ApiSearchItem[] = await response.json();
            const results: SearchResult[] = [];

            for (const item of series) {
                if (item.id && item.titulo) {
                    results.push({
                        id: String(item.id),
                        title: item.titulo,
                        image: item.portadaUrl || "",
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

            const chapterList: ApiChapterItem[] = await response.json();

            for (let index = 0; index < chapterList.length; index++) {
                const chapter = chapterList[index];
                const chapterId = chapter.publicId;
                const chapterNum = chapter.numeroCapitulo;

                if (chapterId && chapterNum) {
                    chapters.push({
                        id: `${mangaId}/${chapterId}`,
                        url: `${this.api}/series-locales/${mangaId}/capitulos/${chapterId}/paginas`,
                        title: `Capítulo ${chapterNum}`,
                        chapter: String(chapterNum),
                        index,
                        language: "es",
                        scanlator: chapter.grupoScan?.nombre || "Unknown"
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

            const data: ApiPagesResponse = await response.json();
            const pages: ChapterPage[] = [];

            if (!Array.isArray(data.paginas)) {
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
                            "User-Agent": USER_AGENT
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