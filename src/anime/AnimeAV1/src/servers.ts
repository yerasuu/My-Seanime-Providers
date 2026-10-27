/// <reference path="../../online-streaming-provider.d.ts" />
/// <reference path="store.ts" />

type ServerOutcome = { found?: EpisodeServer; error?: string; at: number };

/**
 * How long a failure is believed. Seanime asks for the remaining servers
 * within milliseconds of the first answer, so this only has to outlast one
 * round of asks: long enough that a dead server is not retried, and so not
 * waited on twice, within that round; short enough that a refresh tries it
 * again rather than replaying a failure that may have been a one-off.
 */
const SERVER_FAILURE_MS = 20 * 1000;

/**
 * How long a resolved server is kept: about one episode, so moving between
 * servers while watching never refetches. Well inside the stream URLs' own
 * lives - three hours for Byse, four for Voe and UPNShare as of October 2026.
 */
const SERVER_FOUND_MS = 24 * 60 * 1000;

/**
 * Seanime waits on each ask before the player lets the viewer change episode,
 * so an ask must not wait on a server it was not asked for: one that hangs
 * would lock the episode buttons for as long as it holds the line, and no
 * timer exists here to cut it short. Every stale server is started together,
 * as before, and each leaves its outcome in the store, which outlives the call
 * and is shared across VMs, as it settles. The ask returns as soon as its own
 * server has settled; only when that one failed does it wait on the rest,
 * to fall back to one that resolved.
 */
async function resolveServers(
    key: string,
    servers: string[],
    wanted: string,
    resolve: (server: string) => Promise<EpisodeServer>
): Promise<EpisodeServer> {
    const now = Date.now();
    const held = remember<{ [server: string]: ServerOutcome }>(key, SERVER_FOUND_MS) || {};

    const usable = (outcome: ServerOutcome | undefined) =>
        !!outcome && now - outcome.at < (outcome.found ? SERVER_FOUND_MS : SERVER_FAILURE_MS);

    let outcome = held[wanted];
    const others: Promise<ServerOutcome>[] = [];

    if (!usable(outcome)) {
        let own: Promise<ServerOutcome> | undefined;

        for (const server of servers.filter(name => !usable(held[name]))) {
            const pending = resolve(server)
                .then(
                    (found): ServerOutcome => ({ found, at: Date.now() }),
                    (err): ServerOutcome => ({ error: err instanceof Error ? err.message : String(err), at: Date.now() })
                )
                .then(settled => {
                    const current = remember<{ [server: string]: ServerOutcome }>(key, SERVER_FOUND_MS) || {};
                    current[server] = settled;
                    keep(key, current);
                    held[server] = settled;
                    return settled;
                });

            if (server === wanted) own = pending;
            else others.push(pending);
        }

        if (own) outcome = await own;
    }

    if (outcome && outcome.found) return outcome.found;

    if (outcome) {
        // Only a failure needs the rest: a server that has lost this episode
        // (UPNShare answers 404 for a removed video) falls back to one that
        // resolved, in the order listed. A mistyped name still fails.
        await Promise.all(others);

        for (const server of servers) {
            const alternative = held[server];
            if (alternative && alternative.found) {
                console.error(`AnimeAV1: ${wanted} falló (${outcome.error}), se usa ${server}`);

                // Seanime keeps the server the viewer picked by name, so an answer
                // under another name leaves the player waiting on one that never comes.
                const asked = servers.find(name => name.toUpperCase() === wanted);
                return { ...alternative.found, server: asked || alternative.found.server };
            }
        }
    }

    throw new Error(outcome && outcome.error || `Servidor desconocido: ${wanted}`);
}
