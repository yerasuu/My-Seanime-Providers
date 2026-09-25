/// <reference path="../http.ts" />
/// <reference path="../crypto.ts" />

/**
 * Fixed in UPNShare's player rather than sent per request: its API answers in
 * hex AES-128-CBC under these, so a rotation there breaks this server outright.
 */
const UPNSHARE_KEY = "kiemtienmua911ca";
const UPNSHARE_IV = "1234567890oiuytr";

/**
 * UPNShare's player reads the video id from the URL fragment and asks its
 * own origin's API for the stream, which answers encrypted.
 *
 * Only `cfNative` plays outside that player. `source` points at a bare IP
 * that held the connection until timeout, `cf` answers 403, and
 * `hlsVideoTiktok` serves its segments wrapped in PNGs that only the
 * player knows to unwrap. Now and then a response leaves `cfNative` out, so
 * one more is asked for before giving up.
 */
async function extractUpnShare(embedUrl: string): Promise<VideoSource[]> {
    const match = embedUrl.match(/^(https?:\/\/[^/#?]+)[^#]*#(.+)$/);
    if (!match) return [];

    const api = `${match[1]}/api/v1/video?id=${encodeURIComponent(match[2])}`;

    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            const res = await fetchWithRetry(api, 1, upnShareHeaders(embedUrl));
            if (!res.ok) return [];

            const plain = CryptoJS.AES.decrypt(
                CryptoJS.enc.Base64.stringify(CryptoJS.enc.Hex.parse(res.text().trim())),
                CryptoJS.enc.Utf8.parse(UPNSHARE_KEY),
                { iv: CryptoJS.enc.Utf8.parse(UPNSHARE_IV) }
            ).toString(CryptoJS.enc.Utf8);

            const url = JSON.parse(plain).cfNative;
            if (url) return [{ url, type: "m3u8", quality: "auto", subtitles: [] }];
        }
    } catch (err) {
        console.error("AnimeAV1: UPNShare no respondió como se esperaba:", err);
    }

    return [];
}

// Its segment host answers 403 to anything not referred by the player's origin.
function upnShareHeaders(embedUrl: string): { [key: string]: string } {
    const origin = embedUrl.match(/^https?:\/\/[^/#?]+/);

    return {
        "Referer": origin ? `${origin[0]}/` : embedUrl,
        "User-Agent": BROWSER_UA,
    };
}
