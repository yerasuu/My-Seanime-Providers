/// <reference path="../../online-streaming-provider.d.ts" />

/**
 * Words that place an entry in a series without naming it, so a title made of
 * nothing else carries no signal about which show it belongs to.
 */
const GENERIC_WORDS: { [word: string]: boolean } = {
    season: true, part: true, cour: true, movie: true, special: true,
    ova: true, ona: true, tv: true, the: true, final: true,
};

/**
 * Titles get normalised over and over while scoring - every candidate
 * against every title, several times per search. goja interprets, so the
 * regex work is worth doing once per distinct string.
 */
const normalizedTitles: { [value: string]: string } = {};

// Lowercased, free of accents and punctuation, for comparing titles.
function normalize(value: string): string {
    const cached = normalizedTitles[value];
    if (cached !== undefined) return cached;

    return (normalizedTitles[value] = normalizeUncached(value));
}

function normalizeUncached(value: string): string {
    return value
        .toLowerCase()
        .replace(/[áàäâã]/g, "a")
        .replace(/[éèëê]/g, "e")
        .replace(/[íìïî]/g, "i")
        .replace(/[óòöôõ]/g, "o")
        .replace(/[úùüû]/g, "u")
        .replace(/ñ/g, "n")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
        .trim();
}

/**
 * Share of the wanted title's words that the candidate contains.
 *
 * Deliberately asymmetric. Seasons of the same show differ only by a short
 * suffix on top of a long shared prefix, so any measure that divides by the
 * combined length (Dice, and Levenshtein for that matter) is swamped by the
 * prefix and rates the longest, most specific entry worst. Asking instead
 * how much of the wanted title made it into the candidate keeps the weight
 * on the words that actually tell the seasons apart.
 */
function similarity(candidate: string, wanted: string): number {
    const words = normalize(wanted).split(" ").filter(Boolean);
    const pool = normalize(candidate).split(" ").filter(Boolean);
    if (words.length === 0 || pool.length === 0) return 0;

    let hits = 0;

    for (const word of words) {
        const at = pool.indexOf(word);
        if (at !== -1) {
            hits++;
            pool.splice(at, 1);
        }
    }

    return hits / words.length;
}

/**
 * Coverage weighed against how much of the candidate is padding.
 *
 * Coverage alone never charges for extra words, so "... the Movie 4: You're
 * Next" covers "Boku no Hero Academia 4" in full and outranks the season
 * being looked for. Balancing it against the share of the candidate that
 * was actually asked for puts the padded entry back behind.
 */
function balancedScore(candidate: string, wanted: string): number {
    const recall = similarity(candidate, wanted);
    if (recall === 0) return 0;

    const precision = similarity(wanted, candidate);
    if (precision === 0) return 0;

    return (2 * recall * precision) / (recall + precision);
}

/**
 * Season number stated in a title, or 0 when it states none.
 *
 * Only counts seasons. "Part" is a different axis: "The Final Season Part 3"
 * is the fourth season, and reading a 3 out of it makes the genuine third
 * season look like the match.
 */
function seasonOrdinal(title: string): number {
    const text = normalize(title);

    const ordinal = text.match(/\b(\d+)(?:st|nd|rd|th)?\s+season\b/);
    if (ordinal) return parseInt(ordinal[1], 10);

    const trailing = text.match(/\bseason\s+(\d+)\b/);
    if (trailing) return parseInt(trailing[1], 10);

    const roman = text.match(/\s(v?i{1,3})$/);
    if (roman) {
        const map: { [key: string]: number } = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
        return map[roman[1]] || 0;
    }

    return 0;
}

/**
 * Seanime picks the candidate with the smallest Levenshtein distance and
 * applies no threshold, so a neighbouring season is a dangerous decoy: for
 * Honzuki no Gekokujou the synonym "... 4th Season" sits 3 edits from the
 * site's "... 3rd Season" but much further from the season's actual title,
 * and the wrong season wins. Drop candidates that name a different season;
 * anything that names none is kept, since the site often titles a season
 * by its subtitle instead.
 */
function dropOtherSeasons(results: SearchResult[], titles: string[]): SearchResult[] {
    let wanted = 0;
    for (const title of titles) {
        const season = seasonOrdinal(title);
        if (season > wanted) wanted = season;
    }

    if (wanted === 0) return results;

    const kept = results.filter(r => {
        const season = seasonOrdinal(r.title);
        return season === 0 || season === wanted;
    });

    return kept.length > 0 ? kept : results;
}

/**
 * Levenshtein counts raw edits, so it rewards whichever catalog entry is
 * shortest rather than the one that matches: for Honzuki's fourth season
 * the synonym "... 4th Season" lands closer to the site's "... Recap" and
 * to the first season than to "... - Ryoushu no Youjo", the actual entry.
 * Word overlap does read that subtitle, so when one candidate clearly wins
 * on it we hand back only that one and Seanime has nothing to trip over.
 * A close second means we are not sure, and the full list goes back.
 */
function narrowToBest(results: SearchResult[], titles: string[]): SearchResult[] {
    let best: SearchResult | null = null;
    let bestScore = 0;
    let runnerUp = 0;

    for (const result of results) {
        let score = 0;
        for (const title of titles) {
            const value = balancedScore(result.title, title);
            if (value > score) score = value;
        }

        if (score > bestScore) {
            runnerUp = bestScore;
            bestScore = score;
            best = result;
        } else if (score > runnerUp) {
            runnerUp = score;
        }
    }

    /**
     * Thresholds are for the balanced score, which runs lower than plain
     * coverage: a right-but-wordier entry sits around 0.57 while its
     * siblings sit near 0.33. Demand a real gap so ties stay with Seanime.
     */
    if (best && bestScore >= 0.5 && bestScore - runnerUp >= 0.08) return [best];

    return results;
}

/**
 * Every title Seanime knows this anime by, minus the ones that cannot be
 * compared. Synonyms come in every script, and normalising a Thai or
 * Japanese title leaves only whatever digits it carried: "…ซีซั่น Part 3"
 * comes out as "part 3", which any entry with a part number covers in full
 * and scores a perfect match on. Keep the titles that are mostly latin.
 */
function mediaTitles(media?: Media): string[] {
    if (!media) return [];

    return usableTitles([media.romajiTitle, media.englishTitle, ...(media.synonyms || [])]);
}

/**
 * The titles that name this entry, as opposed to the series around it.
 *
 * Scoring has to stay off the numbered synonyms. Honzuki's fourth season
 * carries "... Erandeiraremasen 4th Season", which shares its long prefix
 * with every entry in the series and therefore rates whichever of them is
 * shortest, the recap, above the season that actually goes by a subtitle.
 * Those synonyms still make good extra search queries.
 */
function primaryTitles(media?: Media): string[] {
    if (!media) return [];

    return usableTitles([media.romajiTitle, media.englishTitle]);
}

function usableTitles(titles: (string | undefined)[]): string[] {
    return titles.filter((title): title is string => {
        if (typeof title !== "string" || title.trim() === "") return false;

        const stripped = title.replace(/\s+/g, "");
        if (stripped.length === 0) return false;

        const latin = stripped.replace(/[^a-zA-Z0-9]/g, "").length;
        if (latin / stripped.length < 0.7) return false;

        /**
         * Keep single-word titles: plenty of shows are just "Jigokuraku".
         * What has to go is a title left with nothing but numbering, which
         * is what a foreign one decays into once its own script is gone.
         */
        const words = normalize(title).split(" ").filter(Boolean);
        return words.some(w => w.length >= 3 && !GENERIC_WORDS[w]);
    });
}

function bestScore(results: SearchResult[], titles: string[]): number {
    let best = 0;

    for (const result of results) {
        for (const title of titles) {
            const score = similarity(result.title, title);
            if (score > best) best = score;
        }
    }

    return best;
}
