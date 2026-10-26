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
 * Seanime asks for every listed server one after another, waiting on each,
 * so an episode costs the sum of all of them. The first ask resolves them
 * all at once instead and leaves the outcomes in the store, which outlives
 * the call and is shared across VMs; the asks that follow just read it.
 * An ask that finds its server missing or expired resolves again only the
 * servers in that state, not the ones still held.
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

    if (!usable(held[wanted])) {
        const stale = servers.filter(server => !usable(held[server]));

        const settled = await Promise.all(
            stale.map(server =>
                resolve(server).then(
                    (found): ServerOutcome => ({ found, at: Date.now() }),
                    (err): ServerOutcome => ({ error: err instanceof Error ? err.message : String(err), at: Date.now() })
                )
            )
        );

        stale.forEach((server, i) => (held[server] = settled[i]));
        keep(key, held);
    }

    const outcome = held[wanted];
    if (outcome && outcome.found) return outcome.found;

    throw new Error(outcome && outcome.error || `Servidor desconocido: ${wanted}`);
}
