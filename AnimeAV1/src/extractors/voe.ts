/// <reference path="../http.ts" />
/// <reference path="../crypto.ts" />

// Filler Voe scatters through its packed config; the payload only decodes
// once every one of them is gone.
const VOE_MARKERS = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

/**
 * Voe keeps its player config in a `<script type="application/json">`,
 * packed as rot13, filler markers, base64, every character shifted by 3,
 * reversed, then base64 again.
 */
async function extractVoe(embedUrl: string): Promise<VideoSource[]> {
    try {
        let html = (await fetchWithRetry(embedUrl, 1, PLAIN_HEADERS)).text();

        // voe.sx only answers with a script that sends the browser on to
        // whichever mirror is current, not with an HTTP redirect.
        const hop = html.match(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/);
        if (hop && html.indexOf("application/json") === -1) {
            html = (await fetchWithRetry(hop[1], 1, PLAIN_HEADERS)).text();
        }

        const blob = html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
        if (!blob) return [];

        const packed = JSON.parse(blob[1]);
        const info = JSON.parse(unpackVoe(Array.isArray(packed) ? packed[0] : packed));

        if (info.source) return [{ url: info.source, type: "m3u8", quality: "auto", subtitles: [] }];
        if (info.direct_access_url) {
            return [{ url: info.direct_access_url, type: "mp4", quality: "auto", subtitles: [] }];
        }
    } catch (err) {
        console.error("AnimeAV1: Voe no respondió como se esperaba:", err);
    }

    return [];
}

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
