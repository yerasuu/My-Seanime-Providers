# My Seanime Providers

Seanime extensions (providers/plugins) repo.

## ⚠️ `test` branch

This branch = testing ground. Unstable, unfinished, breaking changes possible any time.

**Do not install/use plugins from this branch.** Use `main` for stable manifests/payloads.

## Plugins

| Plugin | Type | Description | Notes |
|---|---|---|---|
| [AnimeAV1](AnimeAV1) | onlinestream-provider | Online streaming, hard subs + dubs, Spanish | Use version from [Seanime-contributions/Seanime-Providers](https://github.com/Seanime-contributions/Seanime-Providers), not this repo |
| [multi-marketplace](multi-marketplace) | plugin | Browse/manage extensions from multiple community marketplaces at once | test branch only |
| [shademanga](shademanga) | manga-provider | Manga/comics provider (Shade Manga), Spanish | Use `main` branch version, not `test` |

Each plugin dir has its own `manifest.json` + `main.ts` payload.
