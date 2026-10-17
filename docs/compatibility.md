# Compatibility and migration

Marpres has a current authoring renderer and a retained legacy renderer. Choose the path that matches the source deck. Keeping an older deck's renderer and theme preserves its existing layout behavior; switching renderers is a migration that needs visual review.

## Rendering paths

| Source | Renderer and theme |
| --- | --- |
| New Marpres deck | `npm run dev` / `npm run build`, `engine/layout.mjs`, `theme: marpres` |
| Earlier visual-authoring deck | The current renderer also accepts `theme: nju-unofficial-v2` |
| Original legacy layout deck | `marp.config.mjs`, `engine/layout-engine.mjs`, `theme: nju-unofficial` |

`engine/layout-engine-v2.mjs` remains an import compatibility shim for the current layout engine. New integrations should use `engine/layout.mjs`.

The original `engine/layout-engine.mjs`, `themes/nju-unofficial.css`, and `marp.config.mjs` are retained unchanged. The old demonstration source is retained as `test/fixtures/legacy-demo.md` for regression coverage. The public `slides/demo.md` demonstrates the current Marpres workflow.

## Build an existing legacy deck

Run the retained configuration explicitly from the project directory:

```sh
mkdir -p dist
./node_modules/.bin/marp --config-file ./marp.config.mjs --html \
  --output ./dist/legacy.html /path/to/existing/deck.md
./node_modules/.bin/marp --config-file ./marp.config.mjs --pdf \
  --output ./dist/legacy.pdf /path/to/existing/deck.md
```

Keep the deck's existing front matter and relative asset paths. `marp.config.mjs` registers the legacy layout engine and allows its local assets. The normal `npm run build` command uses the current Marpres renderer, so use the explicit legacy configuration for an unchanged older layout.

Retaining the renderer and theme does not freeze external dependencies such as installed fonts, browser rendering, or remote assets. Use the lockfile, the same fonts, and local assets when reproducing an earlier export.

## Migrate a legacy deck

Work on a copy and keep the original source and assets available.

1. Set `theme: marpres` and build the copy with `npm run build -- path/to/copy.md`.
2. Review panel bounds, title/subtitle heights, caption/reference tracks, and image sizes. The current layout engine uses different structure and sizing rules.
3. Keep existing `col` containers where useful; `panel` is the current equivalent. Check grid spans and make sure every container closes before a slide separator.
4. Add unique deck-wide IDs to objects you want to edit: `figure`, `box`, `caption`, `ref`, and `shape`.
5. Wrap a local image in `figure` for measured resizing and cropping. Wrap editable text in `box`, `caption`, or `ref`.
6. Resolve diagnostics, inspect every slide, then use the GUI for visual adjustments.

The current renderer accepts weighted columns, grids, the `col` alias, and positional spans such as `col 2, 1`. This syntax overlap helps migration; it does not promise identical rendering. Automatic migration of arbitrary CSS, HTML layouts, or third-party Marp plugins is not provided.

## Standard Marp tools

Marpres uses Marp for Markdown and slide rendering, while its container layouts, editable metadata, shared theme settings, and cumulative reveal export come from additional code in this repository. A standard Marp viewer or extension does not automatically load those additions.

Use the Marpres editor/build commands for a current deck's intended rendering. Sharing the generated PDF or HTML avoids requiring recipients to install the authoring tools. Local images are embedded in generated output; remote URLs and externally loaded fonts or styles still depend on their resources being available.

The GUI is not a general importer for PowerPoint or Keynote. PDF output is presentation output, not an editable `.pptx` or `.key` document.

## Assets, presets, and project copies

Keep the Markdown and its relative asset directories together. Imported images live under `figures/imported/` beside the deck, and remain there after undo or object deletion so redo can restore them.

Applied theme settings are stored in the Markdown. A JSON theme preset carries shared typography, light/dark palettes, master positions, and CSS; it does not carry slide content or image assets. Earlier presets without master-position fields use zero offsets.

The editor is intended for one local author at a time. External Markdown changes are detected and require a reload before further visual edits. There is no concurrent collaborative editing protocol.
