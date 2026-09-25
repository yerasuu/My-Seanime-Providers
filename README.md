# My Seanime Providers

Seanime extensions (providers/plugins) repo.

## Plugins

| Plugin | Type | Description | Notes |
|---|---|---|---|
| [AnimeAV1](AnimeAV1) | onlinestream-provider | Online streaming, hard subs + dubs, Spanish | Use version from [Seanime-contributions/Seanime-Providers](https://github.com/Seanime-contributions/Seanime-Providers), not this repo |
| [multi-marketplace](multi-marketplace) | plugin | Browse/manage extensions from multiple community marketplaces at once | test branch only |
| [OlympusScanlation](OlympusScanlation) | manga-provider | Manga provider (Olympus Scanlation, olympusxyz.com), Spanish | test branch only |
| [shademanga](shademanga) | manga-provider | Manga/comics provider (Shade Manga), Spanish | Use `main` branch version, not `test` |

Each plugin dir has its own `manifest.json` + `main.ts` payload.

AnimeAV1's `main.ts` is generated: edit `AnimeAV1/src/`, then run `node AnimeAV1/build.mjs` and commit both. Seanime loads only the payload file and never follows `/// <reference>`, so the build inlines them.
