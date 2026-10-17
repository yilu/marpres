# Development and release checks

Use Node.js 20 or later and an installed Chrome. `CHROME_PATH` selects a non-default browser executable. Install the locked dependencies with `npm ci`.

## Verification

```sh
npm test
npm run test:browser
npm run test:gui
npm run test:arrangement
npm run test:theme-preview
npm run test:titles
npm run test:export
npm run test:media
npm run test:print
npm run test:presenter
npm run build
npm run legacy:pdf
```

The unit suite covers source preservation, atomic history, conflict detection, layout parsing, shared styles, image imports, and legacy compatibility. Browser checks exercise real editing, crop geometry at multiple zoom levels, alignment targets, both distribution modes, panel insertion, preview isolation, stage playback, and PDF export. Title checks compare rasterized glyphs in sixteen typography cases to catch clipped descenders.

The public demo contains 12 slides and exports to 14 PDF pages because its reveal example has three stages. The legacy fixture exports to 16 pages. Both use 16:9 pages. Browser tests use temporary decks or read-only fixtures; generated output belongs in ignored `dist/`.

Before publishing, check a clean checkout as well as the working tree. Keep private decks and session artifacts out of the release. Preserve `engine/layout-engine.mjs`, `themes/nju-unofficial.css`, and `marp.config.mjs` when changing the current renderer; compatibility tests pin the legacy engine/theme bytes.

## Dependency baseline

The lockfile is part of the release. The scoped `speech-rule-engine` override selects the patched `@xmldom/xmldom` 0.9.12 within the same minor series; rendering checks cover it.

As of 2026-10-17, `npm audit` still reports ten affected dependency-tree entries rooted in three packages:

| Package | Remaining upstream issue |
| --- | --- |
| `basic-ftp` 5.3.1 | [Directory-listing parser denial of service](https://github.com/advisories/GHSA-c475-qrg2-pj4r); its fix is outside the transitive dependency's accepted major version. |
| `extract-zip` 2.0.1 | [Symlink archive path traversal](https://github.com/advisories/GHSA-jmr9-qjv8-65gv), also tracked by [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3); no patched release is available. It arrives through the legacy CLI's browser tooling. |
| `katex` 0.16.47 | [Trust bypass when prototype pollution already exists](https://github.com/advisories/GHSA-238p-pmpm-9mq7); the fixed release is outside Marp Core 4's dependency range. |

These are unresolved dependencies, not a clean audit. The current PDF exporter uses installed Chrome through Playwright. Do not use `npm audit fix --force` as a release step: its suggested changes include an incompatible CLI downgrade and a new Marp major version. A future renderer/dependency migration needs math, theme, export, and legacy-deck validation together.

The presenter browser suite covers guarded notes, two-window stage navigation, private-note isolation, live pointers and ink, slide/whiteboard history, fullscreen, timers, controller ownership, recovery, and session isolation. It uses temporary decks and installed Chrome.
