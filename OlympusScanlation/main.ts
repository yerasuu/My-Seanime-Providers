/// <reference path="../manga-provider.d.ts" />

interface Serie {
  id: number;
  name: string;
  summary: string;
  slug: string;
  created_at: string;
  cover: string;
  first_chapter: {
    id: number;
    name: string;
  } | null;
}

interface Chapter {
  chapter: {
    id: number;
    name: string;
    title: string | null;
    published_at: string;
    pages: string[];
    team: {
      id: number;
      name: string;
    };
  };
  comic: {
    id: number;
    name: string;
    slug: string;
  };
}

interface SerieItemList {
  id: number;
  name: string;
  slug: string;
  cover: string;
  type: "comic" | "novel";
}

interface ChaptersList {
  data: {
    name: string;
    id: number;
    team: { id: number; name: "Olympus" } | null;
    published_at: string;
  }[];
  meta: {
    current_page: number;
    last_page: number;
  };
}

class Provider {
  private baseUrl = "";
  private apiBaseUrl = "";

  getSettings(): Settings {
    return {
      supportsMultiLanguage: false,
      supportsMultiScanlator: true,
    };
  }

  private formatUrl(
    url: string,
    defaultProtocol: "http" | "https" = "https",
    subdomain?: string,
  ) {
    if (url.endsWith("/")) url = url.slice(0, -1);
    if (!url.startsWith("http")) url = `${defaultProtocol}://` + url;
    if (!url.startsWith("https")) url = `${defaultProtocol}://` + url;
    if (subdomain) url = url.replace("://", `://${subdomain}.`);
    return url;
  }

  private loadUrls() {
    // olympusbiblioteca.com now 301s here permanently, so this is the live domain.
    const url = "https://olympusxyz.com";
    this.baseUrl = this.formatUrl(url, "https");
    this.apiBaseUrl = this.formatUrl(url, "https", "panel");
  }

  async search(opts: QueryOptions): Promise<SearchResult[]> {
    this.loadUrls();
    const list = await this.getSeriesList();

    const ids = list
      .filter(
        (item) =>
          item.name.toLowerCase().includes(opts.query.toLowerCase()) &&
          item.type === "comic",
      )
      .map((i) => i.slug);

    const series: SearchResult[] = [];

    for (const id of ids) {
      const serie = await this.getSearchSerie(id);
      if (!serie) continue;

      series.push(serie);
    }

    return series;
  }

  async findChapters(mangaId: string): Promise<ChapterDetails[]> {
    this.loadUrls();
    const firstPage = await this.getChapterList(mangaId, 1);
    const listChapters = firstPage.data;
    const countPages = firstPage.meta.last_page;

    for (let i = 2; i <= countPages; i++) {
      const page = await this.getChapterList(mangaId, i);
      if (page.data.length <= 0) break;
      listChapters.push(...page.data);
    }

    return listChapters
      .map((item) => ({
        id: `${item.id}/comic-${mangaId}`,
        url: `${this.baseUrl}/capitulo/${item.id}/comic-${mangaId}`,
        title: `Capítulo ${item.name}`,
        chapter: item.name,
        index: parseInt(item.name) ?? 0,
        scanlator: item.team?.name.trim() ?? "Olympus",
        updatedAt: item.published_at,
      }))
      .reverse();
  }

  async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
    this.loadUrls();
    const [id, slug] = chapterId.split("/");
    const chapter = await this.getChapter(parseInt(id), slug);

    if (!chapter) return [];

    return chapter.chapter.pages.map((p, i) => ({
      url: p.trim(),
      index: i + 1,
      headers: { Referer: `${this.baseUrl}/capitulo/${chapterId}` },
    }));
  }

  async getSeriesList(): Promise<SerieItemList[]> {
    const res = await fetch(`${this.baseUrl}/api/series/list`);

    if (!res.ok) return [];

    const list: { data: SerieItemList[] } = await res.json();

    return list.data;
  }

  async getSearchSerie(id: string): Promise<SearchResult | null> {
    const check = await this.getChapterList(id, 1);

    if (check.data.length > 0) {
      const serie = await this.getSerie(id);
      if (!serie) return null;
      return {
        id: serie.slug,
        title: serie.name,
        image: serie.cover,
      };
    }

    const realId = await this.getRealSerieId(id);
    if (!realId) return null;

    const serie = await this.getSerie(realId);
    if (!serie) return null;

    return {
      id: serie.slug,
      title: serie.name,
      image: serie.cover,
    };
  }

  async getSerie(id: string): Promise<Serie | null> {
    const req = await fetch(`${this.baseUrl}/api/series/${id}?type=comic`);

    if (!req.ok) return null;

    const json = await req.json();
    return json.data;
  }

  async getRealSerieId(id: string): Promise<string | null> {
    const serie = await this.getSerie(id);

    if (!serie || !serie.first_chapter) return null;

    const chapter = await this.getChapter(serie.first_chapter.id, id);

    if (!chapter) return null;

    return chapter.comic.slug;
  }

  async getChapterList(id: string, page: number): Promise<ChaptersList> {
    const req = await fetch(
      `${this.apiBaseUrl}/api/series/${id}/chapters?page=${page}&direction=desc&type=comic`,
    );

    if (!req.ok)
      return {
        data: [],
        meta: {
          current_page: page,
          last_page: page,
        },
      };

    return req.json();
  }

  async getChapter(
    chapterId: number,
    serieSlug: string,
  ): Promise<Chapter | null> {
    const chapter = await fetch(
      `${this.baseUrl}/api/capitulo/${serieSlug}/${chapterId.toString()}?type=comic`,
    );

    if (!chapter.ok) return null;

    return chapter.json();
  }
}
