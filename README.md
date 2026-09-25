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

A plugin with a `src/` directory (today only AnimeAV1) has a generated `main.ts`: edit `src/`, then from the repo root run `npm install` once and `npm run build`, and commit both. `node build.mjs AnimeAV1` builds just that plugin. Seanime loads only the payload file and never follows `/// <reference>`, so the build inlines them and reprints the result without comments. `npm run check` fails when `main.ts` is out of date.
