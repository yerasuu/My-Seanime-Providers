// Generated from src/ by build.mjs on 2026-11-26 - edit those files, not this one.

/// <reference path="../online-streaming-provider.d.ts" />
/// <reference path="../../core.d.ts" />

const RESOLVED_MS = 20 * 60 * 1000;

function remember<T>(key: string, maxAge: number): T | undefined {
    if (typeof $store === "undefined" || !$store)
        return undefined;
    try {
        const hit = $store.get<{
            at: number;
            value: T;
        }>(key);
        if (hit && Date.now() - hit.at < maxAge)
            return hit.value;
    }
    catch (err) {
    }
    return undefined;
}

function keep(key: string, value: unknown): void {
    if (typeof $store === "undefined" || !$store)
        return;
    try {
        $store.set(key, { at: Date.now(), value });
    }
    catch (err) {
    }
}

const BASE_URL = "https://www.mundodonghua.com";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const decodeEntities = (text: string) => text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

async function get(url: string, headers: {
    [key: string]: string;
} = {}, retries = 1): Promise<FetchResponse> {
    for (let attempt = 0;; attempt++) {
        try {
            const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers } });
            if (res.status < 500 || attempt >= retries)
                return res;
        }
        catch (err) {
            if (attempt >= retries)
                throw err;
        }
    }
}

function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
    const found: RegExpExecArray[] = [];
    const global = new RegExp(pattern.source, "g");
    for (let match = global.exec(text); match; match = global.exec(text))
        found.push(match);
    return found;
}

const PACKER_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function unpackAll(html: string): string[] {
    const blocks = allMatches(/\}\('((?:[^'\\]|\\.)*)',(\d+),\d+,'((?:[^'\\]|\\.)*)'\.split\('\|'\)/, html);
    return blocks.map(([, payload, radix, words]) => {
        const base = parseInt(radix, 10);
        const table = words.split("|");
        return payload.replace(/\\'/g, "'").replace(/\\\\/g, "\\").replace(/\b\w+\b/g, token => {
            let index = 0;
            for (const digit of token) {
                const value = PACKER_DIGITS.indexOf(digit);
                if (value < 0 || value >= base)
                    return token;
                index = index * base + value;
            }
            return table[index] || token;
        });
    });
}

const PAD_BLOCK_HEX = "10101010101010101010101010101010";

function decryptAesGcm(keyHex: string, ivHex: string, dataHex: string): string {
    if (ivHex.length !== 24 || dataHex.length <= 32)
        return "";
    const key = CryptoJS.enc.Hex.parse(keyHex);
    const body = dataHex.slice(0, -32);
    let plain = "";
    for (let block = 0; block * 32 < body.length; block++) {
        const counter = ivHex + ("0000000" + (block + 2).toString(16)).slice(-8);
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

function padBase64(value: string): string {
    const std = value.replace(/-/g, "+").replace(/_/g, "/");
    return std + "===".slice((std.length + 3) % 4);
}

const VOE_MARKERS = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

async function extractVoe(embed: string): Promise<VideoSource[]> {
    let html = (await get(embed)).text();
    const hop = html.match(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/);
    if (hop && html.indexOf("application/json") === -1)
        html = (await get(hop[1])).text();
    const blob = html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
    if (!blob)
        return [];
    const packed = JSON.parse(blob[1]);
    const info = JSON.parse(unpackVoe(Array.isArray(packed) ? packed[0] : packed));
    if (info.source)
        return [{ url: info.source, type: "m3u8", quality: "auto", subtitles: [] }];
    if (info.direct_access_url)
        return [{ url: info.direct_access_url, type: "mp4", quality: "auto", subtitles: [] }];
    return [];
}

function unpackVoe(packed: string): string {
    let text = packed.replace(/[a-zA-Z]/g, c => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
    for (const marker of VOE_MARKERS)
        text = text.split(marker).join("");
    const shifted = CryptoJS.enc.Latin1.stringify(CryptoJS.enc.Base64.parse(padBase64(text)));
    let reversed = "";
    for (let i = shifted.length - 1; i >= 0; i--)
        reversed += String.fromCharCode(shifted.charCodeAt(i) - 3);
    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(padBase64(reversed)));
}

async function extractByse(embed: string): Promise<VideoSource[]> {
    const match = embed.match(/^(https?:\/\/[^/]+)\/[a-z]\/([A-Za-z0-9]+)/);
    if (!match)
        return [];
    const res = await get(`${match[1]}/api/videos/${match[2]}`);
    if (!res.ok)
        return [];
    const playback = res.json().playback;
    if (!playback || !Array.isArray(playback.key_parts))
        return [];
    const plain = decryptAesGcm(byseKeyParts(playback).map((part: string) => base64ToHex(part)).join(""), base64ToHex(playback.iv), base64ToHex(playback.payload));
    if (!plain)
        return [];
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

const BYSE_FALLBACK_EDGES = [{ origin: "https://edge1-frankfurt-sprintcdn.owphbf24.com", label: "Frankfurt" }];

function byseEdgeUrls(url: string): {
    url: string;
    label?: string;
}[] {
    const origin = url.match(/^https?:\/\/[^/]+/);
    if (!origin)
        return [{ url }];
    const path = url.slice(origin[0].length);
    return [
        { url },
        ...BYSE_FALLBACK_EDGES
            .filter(edge => edge.origin !== origin[0])
            .map(edge => ({ url: edge.origin + path, label: edge.label })),
    ];
}

function byseKeyParts(playback: {
    key_parts: string[];
    version?: string;
}): string[] {
    const parts = playback.key_parts;
    const version = String(playback.version || "").trim();
    const first = /^\d+$/.test(version) ? parseInt(version, 10) : 0;
    const second = 31 - first;
    if (first < 1 || first > 20 || first > parts.length || second > parts.length)
        return parts;
    return [parts[first - 1], parts[second - 1]];
}

async function extractHg(embed: string): Promise<VideoSource[]> {
    const res = await get(embed, { Referer: BASE_URL + "/" });
    if (!res.ok)
        return [];
    const origin = embed.match(/^https?:\/\/[^/]+/);
    const config = unpackAll(res.text()).map(code => code.match(/var links=(\{[^}]*\})/)).find(Boolean);
    if (!config || !origin)
        return [];
    const links = JSON.parse(config[1]);
    const sources: VideoSource[] = [];
    for (const key of ["hls2", "hls4"]) {
        const link: string | undefined = links[key];
        if (!link)
            continue;
        sources.push({
            url: link.charAt(0) === "/" ? origin[0] + link : link,
            type: "m3u8",
            quality: sources.length === 0 ? "auto" : `auto ${sources.length + 1}`,
            subtitles: [],
        });
    }
    return sources;
}

const SERVER_NAMES = ["VOE", "VidHide", "StreamWish", "Filemoon"];

function serverOf(embed: string): string | undefined {
    if (/voe\.sx/i.test(embed))
        return "VOE";
    if (/filemoon|byse/i.test(embed))
        return "Filemoon";
    if (/morencius|vidhide|vidhidepro/i.test(embed))
        return "VidHide";
    if (/embedwish|streamwish|streamhg|hlswish/i.test(embed))
        return "StreamWish";
    return undefined;
}

function extractorFor(server: string): (embed: string) => Promise<VideoSource[]> {
    if (server === "VOE")
        return extractVoe;
    if (server === "Filemoon")
        return extractByse;
    return extractHg;
}

async function embedsOf(pageUrl: string): Promise<{
    [server: string]: string;
}> {
    const page = await get(pageUrl);
    if (!page.ok)
        throw new Error(`Episodio no disponible (${page.status})`);
    const found: {
        [server: string]: string;
    } = {};
    for (const code of unpackAll(page.text())) {
        const frame = code.match(/<iframe src='(https?:\/\/[^']+)'/);
        const server = frame && serverOf(frame[1]);
        if (frame && server && !found[server])
            found[server] = frame[1];
    }
    return found;
}

class Provider {
    getSettings(): Settings {
        return { episodeServers: SERVER_NAMES, supportsDub: false };
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const media = opts.media;
        const titles = [opts.query, media && media.romajiTitle, media && media.englishTitle].concat(media && media.synonyms || []);
        const queries = titles.filter((title, i): title is string => !!title && title.trim() !== "" && titles.indexOf(title) === i);
        for (const query of queries.slice(0, 4)) {
            const res = await get(`${BASE_URL}/busquedas?donghua=${encodeURIComponent(query)}`);
            if (!res.ok)
                continue;
            const results: SearchResult[] = [];
            const cards = allMatches(/<a href="\/donghua\/([^"\/]+)">[\s\S]*?<h5 class="md-card-title">([^<]+)<\/h5>/, res.text());
            for (const [, slug, title] of cards) {
                results.push({ id: slug, title: decodeEntities(title.trim()), url: `${BASE_URL}/donghua/${slug}`, subOrDub: "sub" });
            }
            if (results.length > 0)
                return results;
        }
        return [];
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const res = await get(`${BASE_URL}/donghua/${id}`);
        if (!res.ok)
            return [];
        const episodes = new Map<number, EpisodeDetails>();
        for (const [, path, number] of allMatches(/<a href="(\/ver\/[^"\/]+\/(\d+))" class="md-ep-link"/, res.text())) {
            const n = parseInt(number, 10);
            if (episodes.has(n))
                continue;
            episodes.set(n, { id: `${BASE_URL}${path}`, number: n, title: `Episodio ${n}`, url: `${BASE_URL}${path}` });
        }
        return Array.from(episodes.values()).sort((a, b) => a.number - b.number);
    }

    private async resolve(episode: EpisodeDetails, name: string): Promise<{
        videoSources: VideoSource[];
        headers: {
            [key: string]: string;
        };
    }> {
        const key = `md1:${episode.url}:${name}`;
        const cached = remember<{
            videoSources: VideoSource[];
            headers: {
                [key: string]: string;
            };
        }>(key, RESOLVED_MS);
        if (cached)
            return cached;
        const embed = (await embedsOf(episode.url))[name];
        if (!embed)
            throw new Error(`${name} no está disponible en este episodio`);
        const videoSources = await extractorFor(name)(embed);
        if (videoSources.length === 0)
            throw new Error(`${name} no devolvió fuentes`);
        const resolved = { videoSources, headers: { "User-Agent": BROWSER_UA } };
        keep(key, resolved);
        return resolved;
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const wanted = SERVER_NAMES.find(known => known.toLowerCase() === server.toLowerCase());
        if (!wanted)
            throw new Error(`Servidor desconocido: ${server}`);
        let firstError: unknown;
        for (const name of [wanted, ...SERVER_NAMES.filter(known => known !== wanted)]) {
            try {
                const { videoSources, headers } = await this.resolve(episode, name);
                if (name !== wanted)
                    console.error(`MundoDonghua: ${wanted} falló, se usa ${name}`);
                return { server: wanted, headers, videoSources };
            }
            catch (err) {
                firstError = firstError || err;
            }
        }
        throw firstError;
    }
}
