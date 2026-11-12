/// <reference path="http.ts" />
/// <reference path="store.ts" />

/**
 * The site numbers seasons its own way (AniList's Tunshi Xingkong 4 is its
 * "Swallowed Star 3", and its 2 folds AniList's 2 and 3 into 59 episodes), and
 * its search finds nothing for a title ending in a season number. The episode
 * count each side reports is what tells the entries apart.
 */
const COUNT_MS = 60 * 60 * 1000;

// "Swallowed Star 4" and "Swallowed Star Season 4" both search as "Swallowed Star".
function withoutSeasonNumber(title: string): string {
    return title.replace(/\s+(?:(?:season|temporada|part|parte)\s+)?\d+$/i, "").trim();
}

async function episodeCount(slug: string): Promise<number> {
    const key = `sd:count:${slug}`;

    const cached = remember<number>(key, COUNT_MS);
    if (cached !== undefined) return cached;

    try {
        const res = await get(`${BASE_URL}/${slug}/`);
        const found = res.ok && res.text().match(/"numberOfEpisodes":\s*(\d+)/);
        const count = found ? parseInt(found[1], 10) : 0;

        if (count > 0) keep(key, count);
        return count;
    } catch (err) {
        return 0;
    }
}

/**
 * Orders results by how close their episode count is to AniList's, a count
 * above it being the worse fit since the site cannot have more than exists.
 * An airing entry is only ever behind the site, so when the closest result is
 * not past AniList's count it is the only one offered: Seanime would otherwise
 * choose among the titles and take the wrong season.
 */
async function rankByEpisodes(results: SearchResult[], media: Media | undefined): Promise<SearchResult[]> {
    const target = media && media.episodeCount;
    if (!target || results.length < 2) return results;

    const counts = await Promise.all(results.map(result => episodeCount(result.id)));
    const distance = (i: number) => counts[i] <= 0 ? Infinity : counts[i] > target ? 1000 + counts[i] - target : target - counts[i];

    const order = results.map((_, i) => i).sort((a, b) => distance(a) - distance(b));
    const best = order[0];

    if (media && media.status === "RELEASING" && counts[best] > 0 && counts[best] <= target) return [results[best]];

    return order.map(i => results[i]);
}
