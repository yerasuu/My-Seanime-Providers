/// <reference path="../manga-provider.d.ts" />

// Seanime's manga provider contract.
// The runtime supplies these; esbuild strips them while transpiling.

declare interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
}

declare interface FetchResponse {
    status: number;
    ok: boolean;
    text(): string;

    json<T = any>(): T;
}

declare function fetch(url: string, options?: FetchOptions): Promise<FetchResponse>;

interface LibraryItem {
    _id?: string;
    real_id?: string;
    the_real_name?: string;
    _imagen?: string;
}

interface ChapterVersion {
    link?: string;
    joint?: { name?: string }[];
    create?: number;
}

interface SeeChapter {
    chapter: number | string;
    link?: string;
    create?: number;
    versions?: ChapterVersion[];
}

class Provider {
    private api = "https://api.manhwaweb.com";
    private site = "https://manhwaweb.com/";

    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    private async getJson<T>(path: string): Promise<T | null> {
        const res = await fetch(`${this.api}${path}`, { method: "GET", headers: { Referer: this.site } });
        if (!res.ok) return null;
        return res.json<T>();
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const json = await this.getJson<{ data?: LibraryItem[] }>(
            `/manhwa/library?buscar=${encodeURIComponent(opts.query)}&estado=&tipo=&erotico=&demografia=&order_item=alfabetico&order_dir=desc&page=0&generes=`,
        );
        if (!json?.data) return [];

        return json.data
            .filter(item => item._id || item.real_id)
            .map(item => ({
                id: (item._id || item.real_id) as string,
                title: item.the_real_name || "Sin título",
                synonyms: [item.real_id].filter((s): s is string => !!s),
                image: item._imagen || "",
            }));
    }

    async findChapters(mangaId: string): Promise<ChapterDetails[]> {
        const json = await this.getJson<{ _id?: string; chapters?: SeeChapter[] }>(`/manhwa/see/${encodeURIComponent(mangaId)}`);
        if (!json?.chapters) return [];

        const tail = (link?: string) => (link ? link.substring(link.lastIndexOf("/") + 1) : "");

        return json.chapters.map((ch, index) => {
            const version = ch.versions?.[0];
            // The page endpoint wants the id of the uploaded version, e.g. "<manga>-12_01".
            const id = tail(version?.link) || tail(ch.link) || `${json._id || mangaId}-${ch.chapter}_01`;
            return {
                id,
                url: version?.link || ch.link || `${this.site}leer/${id}`,
                title: `Capítulo ${ch.chapter}`,
                chapter: String(ch.chapter),
                index,
                scanlator: version?.joint?.[0]?.name,
                language: "es",
            };
        });
    }

    async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
        const json = await this.getJson<{ img?: string[] }>(`/chapters/see_new/${encodeURIComponent(chapterId)}`);
        if (!json?.img) return [];

        return json.img.map((url, index) => ({
            url,
            index,
            headers: { Referer: this.site },
        }));
    }
}
