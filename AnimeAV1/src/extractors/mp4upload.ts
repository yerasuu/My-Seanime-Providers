/// <reference path="../http.ts" />
/// <reference path="../store.ts" />

/**
 * Past this, a host is not being slow, it has stopped answering: mp4upload
 * serves in well under a second or not at all. Well clear of a normal reply.
 */
const SLOW_HOST_MS = 6000;

/**
 * Written down when mp4upload stalls, so it is passed over while this is set
 * rather than costing another 35s on the next episode. Shares SEARCH_CACHE_MS.
 */
const MP4UPLOAD_DOWN_KEY = "av1:mp4upload:down";

const MP4UPLOAD_HEADERS: { [key: string]: string } = {
    "Referer": "https://www.mp4upload.com/",
    "User-Agent": BROWSER_UA,
};

/**
 * MP4Upload leaves the direct mp4 in the embed HTML, unobfuscated.
 *
 * Seanime asks for every declared server before it hands back any source,
 * so this runs on the way to playing an episode even when HLS is the one
 * being watched. mp4upload answers in well under a second almost always,
 * but now and then it stops answering and holds the request for the 35s
 * fetch allows, which is felt as the episode taking 35s to start.
 *
 * Nothing here can shorten that one stall, so the point is to not pay it
 * twice: a stall is written down and mp4upload is passed over for the next
 * few minutes. Seanime keeps whichever servers did answer, so skipping it
 * costs the fallback and nothing else.
 */
async function extractMp4Upload(embedUrl: string): Promise<VideoSource | null> {
    if (remember<boolean>(MP4UPLOAD_DOWN_KEY)) return null;

    const started = Date.now();

    try {
        // No retries: when mp4upload stalls, each attempt costs 35s.
        const res = await fetchWithRetry(embedUrl, 0, MP4UPLOAD_HEADERS);

        if (Date.now() - started >= SLOW_HOST_MS) keep(MP4UPLOAD_DOWN_KEY, true);
        if (!res.ok) return null;

        const match = res.text().match(/src:\s*"([^"]+\.mp4[^"]*)"/);
        if (!match) return null;

        return {
            url: match[1],
            type: "mp4",
            quality: "auto",
            subtitles: [],
        };
    } catch (err) {
        keep(MP4UPLOAD_DOWN_KEY, true);
        return null;
    }
}
