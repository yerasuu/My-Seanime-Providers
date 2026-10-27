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
        const found: VideoSource[] = [];

        sources.forEach((s, i) => {
            const quality = s.label || s.height && `${s.height}p` || `auto ${i + 1}`;
            const type = String(s.mime_type || "").indexOf("mpegurl") !== -1 ? "m3u8" : "mp4";

            for (const edge of byseEdgeUrls(s.url))
                found.push({ url: edge.url, type, quality: edge.label ? `${quality} (${edge.label})` : quality, subtitles: [] });
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
 * played from Frankfurt - so the stream is offered from both.
 */
const BYSE_FALLBACK_EDGES = [{ origin: "https://edge1-frankfurt-sprintcdn.owphbf24.com", label: "Frankfurt" }];

/**
 * Every edge is offered as a source and none is probed first. A probe cannot be
 * cut short when an edge hangs, and the episode waited behind it, which left
 * the player loading although another server was ready. The assigned edge
 * comes first; the viewer can switch to the next when it does not play.
 */
function byseEdgeUrls(url: string): { url: string; label?: string }[] {
    const origin = url.match(/^https?:\/\/[^/]+/);
    if (!origin) return [{ url }];

    const path = url.slice(origin[0].length);

    return [
        { url },
        ...BYSE_FALLBACK_EDGES
            .filter(edge => edge.origin !== origin[0])
            .map(edge => ({ url: edge.origin + path, label: edge.label })),
    ];
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
