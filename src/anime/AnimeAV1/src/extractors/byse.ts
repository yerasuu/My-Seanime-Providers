/// <reference path="../http.ts" />
/// <reference path="../crypto.ts" />

/**
 * Byse hands its sources out AES-256-GCM
 * encrypted, with the key hidden among decoy `key_parts`.
 */
async function extractByse(embedUrl: string): Promise<VideoSource[]> {
    const match = embedUrl.match(/^(https?:\/\/[^/]+)\/[a-z]\/([A-Za-z0-9]+)/);
    if (!match) return [];

    try {
        const res = await fetchWithRetry(`${match[1]}/api/videos/${match[2]}`, 1, PLAIN_HEADERS);
        if (!res.ok) return [];

        const playback = res.json().playback;
        if (!playback || !Array.isArray(playback.key_parts)) return [];

        const plain = decryptAesGcm(
            byseKeyParts(playback).map((part: string) => base64ToHex(part)).join(""),
            base64ToHex(playback.iv),
            base64ToHex(playback.payload)
        );
        if (!plain) return [];

        const sources: any[] = (JSON.parse(plain).sources || []).filter((s: any) => s && typeof s.url === "string");
        const urls = await Promise.all(sources.map(s => reachableByseUrl(s.url)));

        const found: VideoSource[] = [];

        sources.forEach((s, i) => {
            const url = urls[i];
            if (!url) return;

            found.push({
                url,
                type: String(s.mime_type || "").indexOf("mpegurl") !== -1 ? "m3u8" : "mp4",
                quality: s.label || s.height && `${s.height}p` || `auto ${i + 1}`,
                subtitles: [],
            });
        });

        return found;
    } catch (err) {
        console.error("AnimeAV1: Byse no respondió como se esperaba:", err);
    }

    return [];
}

/**
 * Byse's API picks the edge, and some edges refuse a connection outright: in
 * October 2026, from an Orange Spain line, every Warsaw `*.r66nv9ed.com` edge
 * reset the connection, so Seanime's proxy failed on the playlist and the
 * player never started. The token is not bound to the edge - the same path
 * played from Frankfurt - so when the assigned edge does not answer, the
 * stream moves to one that does.
 */
const BYSE_FALLBACK_EDGES = ["https://edge1-frankfurt-sprintcdn.owphbf24.com"];

/**
 * Every edge is probed at once and the first to answer wins. One after another,
 * an edge that hangs holds the line until fetch gives up on it and the whole
 * episode waits behind it: 20s went by in October 2026 before Frankfurt was
 * even tried. Null when none answers.
 */
async function reachableByseUrl(url: string): Promise<string | null> {
    const origin = url.match(/^https?:\/\/[^/]+/);
    if (!origin) return url;

    const path = url.slice(origin[0].length);
    const edges = [origin[0], ...BYSE_FALLBACK_EDGES.filter(e => e !== origin[0])];

    const found = await new Promise<string | null>(resolve => {
        let pending = edges.length;

        for (const edge of edges) {
            // A reset rejects the fetch instead of answering, and is as much a "no" as a 403.
            fetchWithRetry(edge + path, 0, PLAIN_HEADERS)
                .then(res => res.ok, () => false)
                .then(answered => {
                    if (answered) resolve(edge + path);
                    else if (--pending === 0) resolve(null);
                });
        }
    });

    if (!found) console.error(`AnimeAV1: ningún edge de Byse responde para ${origin[0]}`);
    return found;
}

/**
 * The player keeps only parts `version` and `31 - version` (1-based) and
 * joins them; the rest are decoys. Outside the versions it knows, or when
 * either index falls off the list, it joins every part instead.
 */
function byseKeyParts(playback: { key_parts: string[]; version?: string }): string[] {
    const parts = playback.key_parts;
    const version = String(playback.version || "").trim();
    const first = /^\d+$/.test(version) ? parseInt(version, 10) : 0;
    const second = 31 - first;

    if (first < 1 || first > 20 || first > parts.length || second > parts.length) return parts;

    return [parts[first - 1], parts[second - 1]];
}
