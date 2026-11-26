/// <reference path="../http.ts" />
/// <reference path="../packed.ts" />

/**
 * VidHide (morencius.com) and StreamWish (embedwish.com) are the same player:
 * a packed script with `var links={"hls2":...,"hls4":...}`. hls2 is an absolute
 * playlist; hls4 is a path on the embed's own host.
 */
async function extractHg(embed: string): Promise<VideoSource[]> {
    const res = await get(embed, { Referer: BASE_URL + "/" });
    if (!res.ok) return [];

    const origin = embed.match(/^https?:\/\/[^/]+/);
    const config = unpackAll(res.text()).map(code => code.match(/var links=(\{[^}]*\})/)).find(Boolean);
    if (!config || !origin) return [];

    const links = JSON.parse(config[1]);
    const sources: VideoSource[] = [];

    for (const key of ["hls2", "hls4"]) {
        const link: string | undefined = links[key];
        if (!link) continue;

        sources.push({
            url: link.charAt(0) === "/" ? origin[0] + link : link,
            type: "m3u8",
            quality: sources.length === 0 ? "auto" : `auto ${sources.length + 1}`,
            subtitles: [],
        });
    }

    return sources;
}
