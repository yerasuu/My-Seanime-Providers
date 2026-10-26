# My Seanime Providers

Seanime extensions (providers/plugins) repo.

## Plugins

| Plugin | Type | Description | Manifest branch | Notes |
|---|---|---|---|---|
| [AnimeAV1](src/anime/AnimeAV1) | onlinestream-provider | Online streaming, hard subs + dubs, Spanish. Servers: HLS, UPNShare, Byse, Voe, MP4Upload | `test` | Use version from [Seanime-contributions/Seanime-Providers](https://github.com/Seanime-contributions/Seanime-Providers), not this repo |
| [multi-marketplace](src/others/multi-marketplace) | plugin | Browse/manage extensions from multiple community marketplaces at once | `test-marketplace` | |
| [OlympusScanlation](src/manga/OlympusScanlation) | manga-provider | Manga provider (Olympus Scanlation, olympusxyz.com), Spanish | `test` | |
| [shademanga](src/manga/shademanga) | manga-provider | Manga/comics provider (Shade Manga), Spanish | `main` | |

Install by adding a plugin's manifest to Seanime:
`https://raw.githubusercontent.com/yerasuu/My-Seanime-Providers/<branch>/src/<category>/<plugin>/manifest.json`

Plugins live in `src/<category>/<plugin>` (`anime`, `manga`, `others`). Each plugin dir has its own `manifest.json` + `main.ts` payload.

## Building

Plugins with their own `src/` directory (today only AnimeAV1) have a generated `main.ts`. Edit that `src/`, never `main.ts`.

```sh
npm install          # once
npm run build        # regenerate every plugin's main.ts
npm run check        # fail if any main.ts is out of date with its src/
# build just one plugin
npm run build AnimeAV1   # or anime/AnimeAV1
# or
node build.mjs AnimeAV1
```

Commit `src/` and the regenerated `main.ts` together.

Seanime loads only the payload file and never follows `/// <reference>`, so the build inlines every referenced file. The exception is a shared `.d.ts` outside the plugin's directory (`src/core.d.ts`, `src/<category>/*.d.ts`), which stays a `/// <reference>`; ambient `declare`s are dropped because the runtime supplies them. It reprints the result with the TypeScript printer: still TypeScript and readable, with no comments.
