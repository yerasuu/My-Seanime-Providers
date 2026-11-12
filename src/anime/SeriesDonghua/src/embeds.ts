/// <reference path="http.ts" />

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

    const tabs = allMatches(/data-video-id="(\d+)"\s+data-server-index="(\d+)">\s*<i[^>]*><\/i>\s*<span>([^<]+)<\/span>/, html);
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
