# Compatibility and migration

**The original template remains usable directly with Marp CLI.** The GUI and presenter are optional tools. They are not required to author the Markdown, use the original columns/grids, or generate its HTML/PDF.

Marpres has a current authoring renderer and a retained original renderer, called the legacy path below. Choose the path that matches the source deck. Keeping an older deck's renderer and theme preserves its existing layout behavior; switching renderers is a migration that needs visual review.

## Rendering paths

| Source | Renderer and theme |
| --- | --- |
| New Marpres deck | `npm run dev` / `npm run build`, `engine/layout.mjs`, `theme: marpres` |
| Earlier visual-authoring deck | The current renderer also accepts `theme: nju-unofficial-v2` |
| Original legacy layout deck | `marp.config.mjs`, `engine/layout-engine.mjs`, `theme: nju-unofficial` |

The first two paths support Markdown-only builds through `npm run build`; `npm run dev` is optional. The original path uses Marp CLI directly. None of these command-line builds needs the browser editor or the presenter console to be running.

`engine/layout-engine-v2.mjs` remains an import compatibility shim for the current layout engine. New integrations should use `engine/layout.mjs`.

The original `engine/layout-engine.mjs`, `themes/nju-unofficial.css`, and `marp.config.mjs` are retained unchanged. The old demonstration source is retained as `test/fixtures/legacy-demo.md` for regression coverage. The public `slides/demo.md` demonstrates the current Marpres workflow.

## Build an existing legacy deck

To verify the original workflow with the retained example:

```sh
npm run legacy:html
npm run legacy:pdf
```

These scripts invoke the installed `marp` CLI directly, producing `dist/legacy-demo.html` and `dist/legacy-demo.pdf` from the original 16-slide example. They do not use the Marpres GUI or its build script.

Run the retained configuration explicitly from the project directory:

```sh
mkdir -p dist
./node_modules/.bin/marp --config-file ./marp.config.mjs --html \
  --output ./dist/legacy.html /path/to/existing/deck.md
./node_modules/.bin/marp --config-file ./marp.config.mjs --pdf \
  --output ./dist/legacy.pdf /path/to/existing/deck.md
```

Keep the deck's existing front matter and relative asset paths. `marp.config.mjs` registers the legacy layout engine and allows its local assets. The normal `npm run build` command uses the current Marpres renderer, so use the explicit legacy configuration for an unchanged older layout.

Marp CLI's normal watch mode is also available. For example, rebuild the original HTML whenever its source changes:

```sh
./node_modules/.bin/marp --config-file ./marp.config.mjs --html --watch \
  --output ./dist/legacy-demo.html ./test/fixtures/legacy-demo.md
```

For a talk stored alongside the repository, keep the talk's Markdown and figures together and point its own configuration at the template:

```text
talks/
├── marpres/
└── my-talk/
    ├── marp.config.mjs
    ├── slides.md
    └── figures/
```

In `my-talk/marp.config.mjs`:

```js
import layoutEngine from '../marpres/engine/layout-engine.mjs'

export default {
  allowLocalFiles: true,
  html: true,
  themeSet: '../marpres/themes',
  engine: ({ marp }) => marp.use(layoutEngine)
}
```

From `my-talk`, run `../marpres/node_modules/.bin/marp --config-file ./marp.config.mjs --pdf slides.md`. Existing talk directories can keep their original import paths; renaming the GitHub repository does not require moving a local checkout that those paths depend on.

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

The original system is a Marp theme **plus a layout plugin**. Its native Marp CLI workflow uses the CLI's supported [configuration and engine-extension mechanism](https://github.com/marp-team/marp-cli#configuration-file). Custom directives such as `_layout: cols 1 1` and containers such as `::: col` come from that plugin; CSS alone does not implement them.

Registering a theme in a stock Marp preview is therefore not equivalent to loading this repository's engine. Marp for VS Code documents [custom theme registration](https://github.com/marp-team/marp-vscode#use-custom-theme-css-%EF%B8%8F); this project does not provide an extension adapter that automatically loads its layout plugin. Use the configured CLI output to verify the original template when authoring in VS Code.

The current system also builds on Marp, with additional processing for local-image embedding, managed page numbers, shared theme settings, and cumulative reveal export. `npm run build` includes that processing without opening the GUI. Passing a current deck to the original `marp.config.mjs` is not the same build path.

Use the Marpres editor/build commands for a current deck's intended rendering. Sharing the generated PDF or HTML avoids requiring recipients to install the authoring tools. Local images are embedded in generated output; remote URLs and externally loaded fonts or styles still depend on their resources being available.

The GUI is not a general importer for PowerPoint or Keynote. PDF output is presentation output, not an editable `.pptx` or `.key` document.

## Assets, presets, and project copies

Keep the Markdown and its relative asset directories together. Imported images live under `figures/imported/` beside the deck, and remain there after undo or object deletion so redo can restore them.

See [image management](assets.md) for GUI imports, content-based filenames, shared folders, and exporting.

Applied theme settings are stored in the Markdown. A JSON theme preset carries shared typography, light/dark palettes, master positions, and CSS; it does not carry slide content or image assets. Earlier presets without master-position fields use zero offsets.

The editor is intended for one local author at a time. External Markdown changes are detected and require a reload before further visual edits. There is no concurrent collaborative editing protocol.
