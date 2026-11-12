/// <reference path="../http.ts" />

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
