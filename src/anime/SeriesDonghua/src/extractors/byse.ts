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

    return sources.map((s, i) => ({
        url: s.url,
        type: String(s.mime_type || "").indexOf("mpegurl") !== -1 ? "m3u8" : "mp4",
        quality: s.label || s.height && `${s.height}p` || `auto ${i + 1}`,
        subtitles: [],
    }));
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
