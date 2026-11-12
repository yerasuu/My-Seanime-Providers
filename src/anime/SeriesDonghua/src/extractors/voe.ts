/// <reference path="../http.ts" />
/// <reference path="../crypto.ts" />

// Filler Voe scatters through its packed config; the payload only decodes once every one is gone.
const VOE_MARKERS = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

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
