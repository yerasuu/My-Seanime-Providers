/// <reference path="../http.ts" />

/**
 * OK.ru puts the player's config in the embed page's `data-options`, entity
 * escaped, with `flashvars.metadata` as a JSON string inside it. The HLS URL is
 * signed for the requesting IP, so it has to be read by the same client that plays it.
 * A video removed for copyright has no `data-options` at all.
 */
async function extractOkru(embed: string): Promise<VideoSource[]> {
    const res = await get(embed);
    if (!res.ok) return [];

    const options = res.text().match(/data-options="([^"]*)"/);
    if (!options) return [];

    const flashvars = JSON.parse(decodeEntities(options[1])).flashvars;
    const metadata = flashvars && (typeof flashvars.metadata === "string" ? JSON.parse(flashvars.metadata) : flashvars.metadata);
    if (!metadata) return [];

    const hls = metadata.ondemandHls || metadata.hlsManifestUrl;
    return hls ? [{ url: hls, type: "m3u8", quality: "auto", subtitles: [] }] : [];
}
