# Marpres

<img src="assets/brand/marpres-wordmark.svg" alt="Marpres" width="360">

**Write slides in Markdown. Refine them visually.**

Marpres is an independent presentation tool built on [Marp](https://marp.app/). Use Markdown for the narrative, equations, figures, and reusable layouts; use the local browser editor for placement, cropping, typography, and diagrams. Both work on the same Markdown file.

## Quickstart

Install **Node.js 20 or later** and **Google Chrome**, then:

```sh
git clone https://github.com/yilu/marpres.git
cd marpres
npm ci
npm run dev
```

Open **http://127.0.0.1:3030**. The editor opens [the demo](slides/demo.md), which demonstrates the layouts and editing features. Edits are saved directly to that file.

To start your own presentation:

```sh
cp slides/starter.md slides/my-talk.md
npm run dev -- slides/my-talk.md --port 3031
```

Open **http://127.0.0.1:3031**. Keep the terminal running; press Ctrl+C to stop the editor. If Chrome is installed at a different location, set `CHROME_PATH` to its executable before exporting or running browser tests:

```sh
CHROME_PATH=/path/to/chrome npm run build
```

## From Markdown to finished slides

1. **Write the content.** Start with `theme: marpres`. Put selectable text in `::: box id=...` blocks and images in `::: figure id=...` blocks. Give every editable object a unique ID across the deck.
2. **Arrange it visually.** Select and drag objects, resize with handles, and double-click a figure to crop. Double-click text to edit it in the inspector; **Apply text** saves the draft.
3. **Set a shared style.** Open **Theme** to preview fonts, light/dark palettes, CSS, and title/footer/page-number positions on actual slides. **Apply to deck** saves one undoable change. Presets let you reuse these settings in another deck.
4. **Rehearse, present, and export.** **Play** rehearses from the current slide. **Present** opens a console with current/next previews, notes, timer, pointers, and drawing tools; its **Open audience window** button creates the second-screen view. **Export PDF** downloads the presentation.

The [authoring guide](docs/authoring.md) covers syntax, shortcuts, and the complete workflow. The [starter deck](slides/starter.md) is a small starting point; the [demo](slides/demo.md) shows the features together.

### Layout and precise arrangement

**Insert into** defaults to **Free on slide**. Choose an existing panel to insert text or an image into its automatic layout. Selecting an object does not change that choice; changing slides resets it. Shapes remain free annotations.

Shift-click objects, or drag on empty canvas, to select several. **Arrange → Align to** chooses the bounds used by the six alignment commands:

| Target | Bounds |
| --- | --- |
| Selected objects | The combined bounds of two or more selected objects |
| Containing panel | The full shared panel, including its caption and reference tracks |
| Content area | The slide's main content region |
| Slide | The complete 1280 × 720 canvas |

**Distribute** needs at least three objects. **Equal gaps** spaces their visible edges evenly; **Equal centres** spaces their centres evenly. Both preserve the first and last objects. Alignment and distribution apply once, and each group action has one undo step.

Figure alignment uses the visible cropped frame. Double-click a figure to drag its crop edges or pan the image inside the crop; Enter applies and Escape cancels. The source image stays intact. **Fit** and **25–200%** zoom change the view; hold Space and drag to pan.

### Source, text, and history

The horizontal toolbar formats whole text blocks. The text editor has separate buttons for formatting selected words. Math and Markdown remain in the source. Text drafts survive selection changes; Play and PDF export save valid drafts first and stop for unresolved conflicts.

**Show source** highlights the selected object's Markdown in a read-only pane. Click a source line to select its object, or use **Open in VS Code** to open that file location. Save external Markdown edits, then use **Reload source** when the editor detects the change.

Undo/redo belongs to the running editor server and survives a browser refresh. It resets when the server restarts or the source changes externally. Use Git for durable project history.

## Build HTML and PDF

```sh
npm run build
npm run build -- slides/my-talk.md
```

The first command writes `dist/demo.html` and `dist/demo.pdf`; the second writes `dist/my-talk.html` and `dist/my-talk.pdf`. Exports use the presentation renderer without editing guides or selection handles.

Reveals are cumulative: stage 0 appears first, followed by each used positive stage. PDF contains one page per stage; exported HTML provides stage navigation. Slides without reveals export as one page each. The [authoring guide](docs/authoring.md#reveal-stages-and-playback) explains the details.

## Scope and compatibility

Marpres currently provides a local, single-user editor and 16:9 HTML/PDF output. Editable PowerPoint/Keynote export, attached diagram connectors, and automatic collision avoidance are not implemented. Remote images can display in Markdown; crop figures require local image files.

For two-screen talks, see the [presenter guide](docs/presenter.md). Add hidden Markdown notes with **Notes** in the editor. Presentations use a fixed snapshot; live pointers, slide annotations, and the whiteboard do not change your deck or exports. Move the audience window to the second display and enter fullscreen there.

Existing decks have a retained legacy rendering path. See [compatibility and migration](docs/compatibility.md) before moving a deck between renderers.

## Project structure

| Path | Purpose |
| --- | --- |
| `slides/demo.md`, `slides/starter.md` | Feature showcase and a small starting deck |
| `editor/server.mjs` | Local editor server |
| `editor/source-store.mjs` | Markdown mapping, guarded writes, and undo/redo |
| `editor/web/` | Browser editor, source pane, and theme preview |
| `presenter/` | Dual-window console, audience view, navigation, pointers, and live ink |
| `engine/layout.mjs` | Presentation layout and editable-object rendering |
| `engine/`, `themes/` | Shared validation, shapes, design settings, and themes |
| `scripts/` | HTML/PDF rendering and export |
| `test/` | Source, rendering, compatibility, and browser checks |
| `assets/brand/` | Marpres identity assets and their licensing information |

## Testing

```sh
npm test
npm run test:browser
```

For feature-level browser checks:

```sh
npm run test:gui
npm run test:arrangement
npm run test:theme-preview
npm run test:presenter
```

Feature browser checks use temporary decks; layout checks render the demo and fixtures without editing them. All use installed Chrome. Set `CHROME_PATH` when needed. See the [development guide](docs/development.md) for release checks and the current dependency baseline, and `package.json` for all focused checks.
