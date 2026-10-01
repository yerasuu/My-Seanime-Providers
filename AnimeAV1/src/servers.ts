/// <reference path="../../online-streaming-provider.d.ts" />
/// <reference path="store.ts" />

type ServerOutcome = { found?: EpisodeServer; error?: string };

/**
 * Seanime asks for every listed server one after another, waiting on each,
 * so an episode costs the sum of all of them. The first ask resolves them
 * all at once instead and leaves the outcomes in the store, which outlives
 * the call and is shared across VMs; the asks that follow just read it.
 * Failures are kept too, so a dead server is not tried again per ask.
 */
async function resolveServers(
    key: string,
    servers: string[],
    wanted: string,
    resolve: (server: string) => Promise<EpisodeServer>
): Promise<EpisodeServer> {
    let outcomes = remember<{ [server: string]: ServerOutcome }>(key);

    if (!outcomes || !outcomes[wanted]) {
        const settled = await Promise.all(
            servers.map(server =>
                resolve(server).then(
                    (found): ServerOutcome => ({ found }),
                    (err): ServerOutcome => ({ error: err instanceof Error ? err.message : String(err) })
                )
            )
        );

        const fresh: { [server: string]: ServerOutcome } = {};
        servers.forEach((server, i) => (fresh[server] = settled[i]));

        keep(key, fresh);
        outcomes = fresh;
    }

    const outcome = outcomes[wanted];
    if (outcome && outcome.found) return outcome.found;

    throw new Error(outcome && outcome.error || `Servidor desconocido: ${wanted}`);
}
