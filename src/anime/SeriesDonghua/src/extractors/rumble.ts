/// <reference path="../http.ts" />

/**
 * The embed page carries the whole player config as JSON, with a master
 * playlist under `hls` that lists every quality.
 */
async function extractRumble(embed: string): Promise<VideoSource[]> {
    const res = await get(embed);
    if (!res.ok) return [];

    const hls = res.text().match(/"hls":\{"url":"([^"]+)"/);
    if (!hls) return [];

    return [{ url: hls[1].replace(/\\\//g, "/"), type: "m3u8", quality: "auto", subtitles: [] }];
}
