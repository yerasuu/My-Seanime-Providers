/// <reference path="runtime.d.ts" />

const BASE_URL = "https://seriesdonghua.com";

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const decodeEntities = (text: string) =>
    text
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

// Pulled from AnimeAV1: a transient 5xx or a refused connection is worth one more try.
async function get(url: string, headers: { [key: string]: string } = {}, retries = 1): Promise<FetchResponse> {
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers } });
            if (res.status < 500 || attempt >= retries) return res;
        } catch (err) {
            if (attempt >= retries) throw err;
        }
    }
}

/**
 * Every match of a global pattern. Seanime rejected a search that used
 * String.prototype.matchAll, which its engine most likely lacks, and
 * AnimeAV1 avoids it too.
 */
function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
    const found: RegExpExecArray[] = [];
    const global = new RegExp(pattern.source, "g");

    for (let match = global.exec(text); match; match = global.exec(text)) found.push(match);

    return found;
}
