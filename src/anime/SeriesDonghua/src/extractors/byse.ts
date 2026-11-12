/// <reference path="../http.ts" />
/// <reference path="../crypto.ts" />

// Filemoon is Byse: sources come AES-256-GCM encrypted, with the key hidden among decoy `key_parts`.
async function extractByse(embed: string): Promise<VideoSource[]> {
    const match = embed.match(/^(https?:\/\/[^/]+)\/[a-z]\/([A-Za-z0-9]+)/);
    if (!match) return [];

    const res = await get(`${match[1]}/api/videos/${match[2]}`);
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

        for (const edge of byseEdgeUrls(s.url)) {
            found.push({ url: edge.url, type, quality: edge.label ? `${quality} (${edge.label})` : quality, subtitles: [] });
        }
    });

    return found;
}

/**
 * Byse's API picks the edge, and some edges refuse a connection outright: from
 * an Orange Spain line in November 2026 the Madrid `*.r66nv9ed.com` edge reset
 * the connection on most tries, so Seanime's proxy failed on the playlist. The
 * token is not bound to the edge, so the stream is also offered from Frankfurt
 * (as AnimeAV1 does) and the viewer can switch when the first does not play.
 */
const BYSE_FALLBACK_EDGES = [{ origin: "https://edge1-frankfurt-sprintcdn.owphbf24.com", label: "Frankfurt" }];

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

// The player keeps only parts `version` and `31 - version` (1-based); the rest are decoys.
function byseKeyParts(playback: { key_parts: string[]; version?: string }): string[] {
    const parts = playback.key_parts;
    const version = String(playback.version || "").trim();
    const first = /^\d+$/.test(version) ? parseInt(version, 10) : 0;
    const second = 31 - first;

    if (first < 1 || first > 20 || first > parts.length || second > parts.length) return parts;

    return [parts[first - 1], parts[second - 1]];
}
