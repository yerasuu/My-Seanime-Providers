/// <reference path="../online-streaming-provider.d.ts" />
/// <reference path="../../core.d.ts" />

const BASE_URL = "https://seriesdonghua.com";

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Filler Voe scatters through its packed config; the payload only decodes once every one is gone.
const VOE_MARKERS = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

const decodeEntities = (text: string) =>
    text
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

async function get(url: string, headers: { [key: string]: string } = {}): Promise<FetchResponse> {
    return fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers } });
}

/**
 * The site hands each episode's embed URLs out through a POST that only
 * answers with the CSRF token of the page's own session, so the episode page
 * is fetched first and its token and cookies replayed.
 */
async function embedUrl(pageUrl: string, serverName: string): Promise<string> {
    const page = await get(pageUrl);
    if (!page.ok) throw new Error(`Episodio no disponible (${page.status})`);

    const html = page.text();
    const token = html.match(/name="csrf-token" content="([^"]+)"/);
    if (!token) throw new Error("La página del episodio no trae token CSRF");

    const tabs = [...html.matchAll(/data-video-id="(\d+)"\s+data-server-index="(\d+)">\s*<i[^>]*><\/i>\s*<span>([^<]+)<\/span>/g)];
    const tab = tabs.find(match => match[3].trim().toLowerCase() === serverName.toLowerCase());
    if (!tab) throw new Error(`${serverName} no está disponible en este episodio`);

    const cookie = Object.entries(page.cookies || {}).map(([name, value]) => `${name}=${value}`).join("; ");
    const res = await fetch(`${BASE_URL}/api/player/get-server`, {
        method: "POST",
        headers: {
            "User-Agent": BROWSER_UA,
            "Content-Type": "application/json",
            "X-CSRF-TOKEN": token[1],
            "X-Requested-With": "XMLHttpRequest",
            "Referer": pageUrl,
            "Cookie": cookie,
        },
        body: JSON.stringify({ video_id: parseInt(tab[1], 10), server_index: parseInt(tab[2], 10) }),
    });

    const data = res.json();
    if (!data || !data.success || !data.embed_url) throw new Error(`${serverName} no devolvió el vídeo`);

    return data.embed_url;
}

async function extractDailymotion(embed: string): Promise<VideoSource[]> {
    const id = embed.match(/[?&]video=([A-Za-z0-9]+)/) || embed.match(/\/video\/([A-Za-z0-9]+)/);
    if (!id) return [];

    const res = await get(`https://www.dailymotion.com/player/metadata/video/${id[1]}`);
    if (!res.ok) return [];

    const meta = res.json();
    const stream = meta && meta.qualities && meta.qualities.auto && meta.qualities.auto[0];
    if (!stream || !stream.url) return [];

    const subtitles: VideoSubtitle[] = [];
    const tracks = meta.subtitles && meta.subtitles.data || {};
    Object.keys(tracks).forEach(code => {
        const url = tracks[code].urls && tracks[code].urls[0];
        if (url) subtitles.push({ id: code, url, language: tracks[code].label || code, isDefault: false });
    });

    return [{ url: stream.url, type: "m3u8", quality: "auto", subtitles }];
}

async function extractVoe(embed: string): Promise<VideoSource[]> {
    let html = (await get(embed)).text();

    // voe.sx answers with a script that sends the browser on to whichever mirror is current.
    const hop = html.match(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/);
    if (hop && html.indexOf("application/json") === -1) html = (await get(hop[1])).text();

    const blob = html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
    if (!blob) return [];

    const packed = JSON.parse(blob[1]);
    const info = JSON.parse(unpackVoe(Array.isArray(packed) ? packed[0] : packed));

    if (info.source) return [{ url: info.source, type: "m3u8", quality: "auto", subtitles: [] }];
    if (info.direct_access_url) return [{ url: info.direct_access_url, type: "mp4", quality: "auto", subtitles: [] }];
    return [];
}

// rot13, filler markers, base64, every character shifted by 3, reversed, base64 again.
function unpackVoe(packed: string): string {
    let text = packed.replace(/[a-zA-Z]/g, c => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });

    for (const marker of VOE_MARKERS) text = text.split(marker).join("");

    const shifted = CryptoJS.enc.Latin1.stringify(CryptoJS.enc.Base64.parse(padBase64(text)));

    let reversed = "";
    for (let i = shifted.length - 1; i >= 0; i--) reversed += String.fromCharCode(shifted.charCodeAt(i) - 3);

    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(padBase64(reversed)));
}

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

const PAD_BLOCK_HEX = "10101010101010101010101010101010";

/**
 * AES-GCM decryption without the tag check. The runtime's AES is CBC only, but
 * GCM's ciphertext is plain CTR, and CBC over a single block is one raw block
 * encryption with the IV folded in. A wrong key still shows up as JSON that will not parse.
 */
function decryptAesGcm(keyHex: string, ivHex: string, dataHex: string): string {
    // GCM only counts from IV || 1 when the IV is 96 bits.
    if (ivHex.length !== 24 || dataHex.length <= 32) return "";

    const key = CryptoJS.enc.Hex.parse(keyHex);
    const body = dataHex.slice(0, -32);
    let plain = "";

    for (let block = 0; block * 32 < body.length; block++) {
        // Counter IV || 1 is spent on the tag, so the payload starts at 2.
        const counter = ivHex + ("0000000" + (block + 2).toString(16)).slice(-8);

        // An empty message encrypts to its padding block alone, so an IV of counter ^ padding makes that block E(counter).
        const keystream = CryptoJS.AES.encrypt("", key, {
            iv: CryptoJS.enc.Hex.parse(xorHex(counter, PAD_BLOCK_HEX)),
        }).toString(CryptoJS.enc.Hex);

        plain += xorHex(body.slice(block * 32, block * 32 + 32), keystream);
    }

    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Hex.parse(plain));
}

function xorHex(a: string, b: string): string {
    let out = "";

    for (let i = 0; i < a.length; i += 2) {
        const byte = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
        out += (byte < 16 ? "0" : "") + byte.toString(16);
    }

    return out;
}

function base64ToHex(value: string): string {
    return CryptoJS.enc.Hex.stringify(CryptoJS.enc.Base64.parse(padBase64(value)));
}

// Standard, padded base64, the only kind the runtime's decoder accepts.
function padBase64(value: string): string {
    const std = value.replace(/-/g, "+").replace(/_/g, "/");
    return std + "===".slice((std.length + 3) % 4);
}

const EXTRACTORS: { [server: string]: (embed: string) => Promise<VideoSource[]> } = {
    Dailymotion: extractDailymotion,
    Filemoon: extractByse,
    VOE: extractVoe,
};

class Provider {
    getSettings(): Settings {
        return { episodeServers: ["Dailymotion", "Filemoon", "VOE"], supportsDub: false };
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const queries = [opts.query, opts.media.romajiTitle, opts.media.englishTitle, ...opts.media.synonyms]
            .filter((title): title is string => !!title && title.trim() !== "");

        for (const query of [...new Set(queries)].slice(0, 4)) {
            const res = await get(`${BASE_URL}/buscar.php?s=${encodeURIComponent(query)}`);
            if (!res.ok) continue;

            const results: SearchResult[] = [];
            const cards = res.text().matchAll(/<article class="donghua-card">\s*<a href="\/([^"\/]+)\/"[\s\S]*?<h3 class="card-title">([^<]+)<\/h3>/g);

            for (const [, slug, title] of cards) {
                results.push({ id: slug, title: decodeEntities(title.trim()), url: `${BASE_URL}/${slug}/`, subOrDub: "sub" });
            }

            if (results.length > 0) return results;
        }

        return [];
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const res = await get(`${BASE_URL}/${id}/`);
        if (!res.ok) return [];

        const episodes = new Map<number, EpisodeDetails>();

        for (const [, path, number] of res.text().matchAll(/<a href="(\/[^"]+-episodio-(\d+)\/)"/g)) {
            const n = parseInt(number, 10);
            if (episodes.has(n)) continue;

            episodes.set(n, { id: `${BASE_URL}${path}`, number: n, title: `Episodio ${n}`, url: `${BASE_URL}${path}` });
        }

        return [...episodes.values()].sort((a, b) => a.number - b.number);
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const name = Object.keys(EXTRACTORS).find(known => known.toLowerCase() === server.toLowerCase());
        if (!name) throw new Error(`Servidor desconocido: ${server}`);

        const embed = await embedUrl(episode.url, name);
        const videoSources = await EXTRACTORS[name](embed);
        if (videoSources.length === 0) throw new Error(`${name} no devolvió fuentes`);

        return { server: name, headers: { "User-Agent": BROWSER_UA }, videoSources };
    }
}
