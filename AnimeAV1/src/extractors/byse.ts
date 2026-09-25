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

        const sources: any[] = JSON.parse(plain).sources || [];

        return sources
            .filter(s => s && typeof s.url === "string")
            .map((s, i) => ({
                url: s.url,
                type: String(s.mime_type || "").indexOf("mpegurl") !== -1 ? "m3u8" : "mp4",
                quality: s.label || s.height && `${s.height}p` || `auto ${i + 1}`,
                subtitles: [],
            }));
    } catch (err) {
        console.error("AnimeAV1: Byse no respondió como se esperaba:", err);
    }

    return [];
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
