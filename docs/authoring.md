# Authoring with Marpres

A presentation is a Markdown file plus its assets. Marpres adds structured layouts and editable objects, then writes visual adjustments back into that same file. Use [the starter](../slides/starter.md) for a new deck and [the demo](../slides/demo.md) for working examples.

## Open, edit, and build

Run commands from the project directory:

```sh
npm ci
npm run dev
```

The default editor opens `slides/demo.md` at `http://127.0.0.1:3030`. To work on another file:

```sh
cp slides/starter.md slides/my-talk.md
npm run dev -- slides/my-talk.md --port 3031
```

The server stays running until Ctrl+C. Each instance edits the file supplied to it. For HTML and PDF output:

```sh
npm run build -- slides/my-talk.md
```

Output goes to `dist/my-talk.html` and `dist/my-talk.pdf`. With no file argument, `npm run build` builds the demo. A successful build exits with status 0; invalid layouts, unreadable assets, and rendering or browser failures produce a nonzero status. Read the reported diagnostics before using the output. An HTML file may already have been written if the later PDF step fails.

PDF export and browser checks require installed Google Chrome. Set `CHROME_PATH` to a different browser executable when needed:

```sh
CHROME_PATH=/path/to/chrome npm run build -- slides/my-talk.md
```

## A minimal deck

```markdown
---
marp: true
theme: marpres
paginate: true
math: mathjax
---

# One clear message

::: box id=main-point
Write **Markdown**, lists, and inline math such as $E = mc^2$.
:::

---

# The next step

::: box id=next-point
A second slide, with its own object ID.
:::
```

A top-level `---` separates slides. Close every container before the next separator. The first `#` heading becomes the slide title; a `##` heading immediately following it can act as a subtitle. Standard Markdown paragraphs, lists, links, tables, code, and math still render.

To make content selectable in the GUI, wrap it in a supported object and give it an ID. IDs must be unique across the entire deck; names such as `overview-plot` and `summary-note` are easy to maintain. Blocks without IDs can render but do not have editing handles. Duplicate IDs produce diagnostics.

A cover can use the bundled title-slide style:

```markdown
<!-- _class: title-slide -->

# A presentation title

::: box id=cover-author
Author · Event · Date
:::
```

## Containers and panels

| Container | Purpose |
| --- | --- |
| `panel` | A layout region containing body content, captions, and references |
| `col` | Alias for `panel` |
| `figure` | One local Markdown image with a measurable crop frame |
| `box` | Text, lists, equations, or other body content |
| `caption` | A caption; inside a panel it enters the caption track |
| `ref` | A reference; inside a panel it enters the reference track |
| `shape` | An independently positioned shape with an empty body |
| `top`, `bottom` | Containers for shared content in the main slide flow |
| `footer` | Slide-level footer content |

Use a longer outer fence to make nesting easy to read:

```markdown
# Compare the results
<!-- _layout: cols 3 2 -->

:::: panel id=result-panel valign=center
::: figure id=result-plot
![Result](figures/result.svg)
:::

::: caption id=result-caption
The main observation.
:::

::: ref id=result-reference
Author, publication, year.
:::
::::

:::: panel id=explanation-panel
::: box id=result-explanation
- First conclusion
- Second conclusion
:::
::::

::: footer
A source or a short slide-level note.
:::
```

Replace example image paths with your own assets. Paths are relative to the Markdown file. Use `:::: panel` around `:::` children; equal-length nested container fences are also accepted. Raw HTML blocks need a blank line before a closing container fence so Markdown can recognize it.

A panel ID identifies its layout region. Panels themselves do not have object drag handles. Nested `box` content can render, but the GUI text editor edits only leaf text blocks; it will not replace a container's children with plain text.

### Layout directives

A directive with a leading underscore applies to the current slide:

```markdown
<!-- _layout: cols 2 1 -->
<!-- _gap: 32 -->
<!-- _valign: center -->
<!-- _caption_align: left -->
```

| Layout | Meaning |
| --- | --- |
| `cols 4 3 2` | Three columns with relative widths 4:3:2 |
| `grid 2x2` | Two rows and two columns |
| `grid 2x3 2 1 1 / 3 2` | Two rows, three columns; column weights 2:1:1 and row weights 3:2 |
| `single`, `hero` | Convenient names for a one-panel slide; author one panel |
| `figure-text` | Two equal columns |
| `comparison`, `summary` | Equal-width columns for the authored panels |

With no layout directive, authored panels form equal-width columns. Single-row layouts share caption/reference tracks so comparisons line up. Multi-row grids reserve these tracks within each panel.

Place and span panels explicitly when needed:

```markdown
<!-- _layout: grid 2x2 -->

:::: panel row=1-2 col=1
::: box id=tall-panel-copy
This panel spans both rows.
:::
::::

:::: panel row=1 col=2
::: box id=upper-panel-copy
Upper right.
:::
::::

:::: panel row=2 col=2
::: box id=lower-panel-copy
Lower right.
:::
::::
```

Indices start at 1. `row=1-2 col=1` spans rows; `row=1 col=1-2` spans columns. The positional form `col 2,1` or `col 2, 1` is also accepted. Explicit placements must fit the declared grid without overlapping. Layout weights must be positive, and grids support at most 12 rows and 12 columns.

Panel options include:

| Option | Values and effect |
| --- | --- |
| `align` | `left`, `center`, `right`: figure placement within the panel |
| `valign` | `top`, `center`, `bottom`: vertical placement within its body |
| `pack` | `top`, `center`, `bottom`: compact the entire body/caption/reference group |
| `stage` | Reveal the panel's group cumulatively at this stage |

For a compact image group, use `pack=center` and an explicit figure width. `_gap` sets the panel gap in slide pixels; `_valign` and `_caption_align` provide slide defaults.

## Text, typography, and math

```markdown
::: box id=important-note width=480 font=28 font_family="Georgia, serif" bold=true color=#6546a5 align=left
A paragraph with **emphasis**, *italics*, ~~strikethrough~~,
<u>underlining</u>, and $x^2$.

$$
E = mc^2
$$
:::
```

`box`, `caption`, and `ref` support these text options:

| Option | Accepted values |
| --- | --- |
| `font` | Pixel size, 1–400 |
| `font_family` | Comma-separated CSS font family names; quote stacks containing spaces |
| `bold`, `italic`, `underline`, `strike` | `true` or `false` |
| `color` | `#rgb` or `#rrggbb` |
| `align` | `left`, `center`, `right` |

Omit an option to inherit it from the deck or surrounding layout. Omit `height` for natural text height. The GUI displays effective fonts and sizes; changing width or position preserves inherited typography and unpinned height. **Reset style** removes local text-style overrides.

Fonts come from the machine rendering the deck, with normal browser fallback. A family stack names preferences; it does not guarantee that every glyph uses the first face. Math retains its mathematical typesetting.

In the GUI, **Text** creates a text box. Double-click a text object to focus **Edit text**, write Markdown, and choose **Apply text**. Select words in that editor to format only those words. Whole-block formatting is available in the horizontal toolbar. Drafts survive changing selection, navigating slides, and saving geometry or styles.

## Figures and cropping

A figure contains exactly one Markdown image:

```markdown
::: figure id=detail width=480 crop=10,20,60,50 dx=8 dy=-4
![A closer look](figures/result.svg)
:::
```

`crop=left,top,width,height` uses percentages of the **original image**. All four numbers must describe a positive rectangle within 0–100%. In this example, the crop starts 10% from the left and 20% from the top, and shows 60% of the width and 50% of the height.

`width=480` is the visible frame width in slide pixels. Figure height follows the source aspect ratio and crop; do not give a figure an explicit `height`. With a 1600 × 800 source, the example's visible frame is 480 × 200. Cropping does not rewrite the image.

Double-click a figure to enter crop mode. Drag a handle to change the visible region, or drag the image inside it to pan. Enter or **Apply crop** saves one undoable operation; Escape or **Cancel** restores the committed crop. Precise percentage inputs are also available. Alignment and snapping use the visible frame.

Crop figures require local PNG, JPEG, SVG, GIF, or WebP files. Ordinary Markdown can display remote images, but remote URLs cannot supply measured crop figures. **Image** imports a local file of at most 10 MB into `figures/imported/` beside the deck. Deleting the figure or undoing its insertion leaves that asset available for redo.

## Layout offsets and free placement

Marpres uses a 1280 × 720 slide canvas. `dx` and `dy` are slide-pixel adjustments, with positive X moving right and positive Y moving down.

| Object | Coordinate meaning |
| --- | --- |
| Normal layout object | Offset from its position after automatic layout |
| Top-level text with `position=absolute` | X/Y from the slide origin |
| Figure with `position=absolute` | X/Y from the slide origin |
| Shape | X/Y of its unrotated frame from the slide origin |
| Absolute text nested in a positioned box | X/Y relative to that parent box |

```markdown
::: box id=free-label position=absolute dx=720 dy=100 width=360
A free annotation.
:::
```

Free objects leave the main layout flow. Moving a normal panel object keeps its panel membership and reserves its original flow space. Large manual offsets can move it outside the panel or slide. After a substantial content change, **Reset layout offsets** returns a layout object to its automatic position. The corresponding action for a free object moves it to its origin.

Shared geometry options are `dx`, `dy`, `width`, `height`, `stage`, and `layer`, subject to each object kind. Width/height range from 1 to 10000, and offsets from −10000 to 10000. Figures derive height instead. `layer` is an integer from −99 to 99; higher values draw above lower ones within their stacking context. Arrange offers **Bring front** and **Send back**.

### Inserting into a panel

**Insert into** defaults to **Free on slide**. Select **Panel 1**, **Panel 2**, and so on to add text or images inside that panel's Markdown and layout. This choice stays explicit: selecting an existing object does not change it, and changing slides resets it to Free on slide. Shapes always insert as free annotations. Moving an object over a panel does not make it a member of that panel.

### Aligning and distributing

Shift-click to add or remove objects from a selection. Drag on empty canvas to select several. You can drag the selection together and undo that movement in one step.

Choose an **Align to** target before using left/centre/right or top/middle/bottom alignment:

- **Selected objects:** the combined visible bounds of two or more objects.
- **Containing panel:** the complete shared panel, including caption and reference tracks. All selected objects must belong to it.
- **Content area:** the main region below the title and above the footer.
- **Slide:** the complete canvas, including title and footer areas.

Unavailable targets are disabled. Alignment changes offsets once; it does not create a lasting constraint or change layout membership.

Distribution needs at least three objects. Choose **Equal gaps** for equal edge-to-edge space, or **Equal centres** for equal distances between object centres. Horizontal and vertical distribution preserve the first and last objects on that axis. They use the selected objects, independently of the alignment target. With unequal object sizes, the two spacing modes produce different results; with too little room, equal gaps can be negative and objects can overlap.

## Shapes

```markdown
::: shape id=process-arrow shape=arrow dx=600 dy=300 width=200 height=32 rotate=-20 stroke=#6546a5 stroke_width=3 fill=none stage=2
:::
```

Keep the shape body empty. `rotate` is a clockwise angle in degrees, from −360 to 360, about the shape's centre. `stroke` and `fill` accept hex colours; `fill=none` makes the interior transparent. `stroke_width` ranges from 0.1 to 40. Open lines, connectors, brackets, and braces ignore fill.

The gallery and source use the same shape names:

| Group | Types |
| --- | --- |
| Basic | `rect`, `rounded-rect`, `ellipse`, `triangle`, `right-triangle`, `diamond`, `pentagon`, `hexagon`, `octagon`, `parallelogram`, `trapezoid` |
| Lines and arrows | `line`, `arrow`, `double-arrow`, `elbow-arrow`, `curve-arrow`, `right-arrow`, `left-arrow`, `up-arrow`, `down-arrow`, `left-right-arrow`, `up-down-arrow` |
| Symbols and callouts | `star`, `heart`, `plus`, `chevron`, `callout`, `cloud`, `left-bracket`, `right-bracket`, `left-brace`, `right-brace` |

Drag, resize, and rotate a selected shape in the GUI. These are independent drawing objects; arrows do not automatically attach to or reroute around other objects.

## Shared themes and master positions

Open **Theme** to edit the shared design. The live preview starts at the current slide; choose another preview slide to inspect its content without navigating the editor. Fonts, colours, positions, and CSS update before being saved. Invalid values or CSS leave the last valid preview visible. Closing the dialog discards its uncommitted changes; **Apply to deck** saves one undoable operation.

**Typography** sets the family and sizes for titles, body text, captions, references, footers, and page numbers. Shared sizes range from 8 to 200 pixels. Local object overrides remain effective until **Reset style** restores inheritance.

**Colours** defines light and dark palettes for background, text, titles, secondary text, accents, and dividers. Set the deck's default appearance here. Use the selector above the canvas for a slide override, or author it directly:

```markdown
<!-- _appearance: dark -->
```

Use `light` or `inherit` for the other choices. This changes slide styling; it does not recolour image pixels.

**Positions** moves title text, the footer, and the page number relative to their template positions across the deck. It preserves the original layout space and does not move independent objects. Each role has its own Reset button. The portable preset fields are:

| Role | Fields |
| --- | --- |
| Title | `title_dx`, `title_dy` |
| Footer | `footer_dx`, `footer_dy` |
| Page number | `page_number_dx`, `page_number_dy` |

All default to 0. X offsets range from −1280 to 1280; Y offsets from −720 to 720.

**Advanced** accepts CSS for the presentation. For example:

```css
section .layout-box {
  line-height: 1.4;
}
```

**Save preset** downloads the current typography, palettes, positions, and CSS as JSON. **Import preset** loads those values into the dialog for review; Apply saves them to the deck. Applied design settings live in a managed Markdown block. Preserve that block when copying a deck, and use the dialog or presets to update it.

**Show page numbers** enables numbering across the deck. An explicit per-slide directive can suppress it:

```markdown
<!-- _paginate: false -->
```

## Reveal stages and playback

`stage=0` is visible from the start. Positive stages reveal cumulatively, keeping earlier content visible:

```markdown
::: box id=starting-point stage=0
Start here.
:::

::: box id=next-result stage=2
Reveal this next.
:::

::: caption id=final-message stage=5
Finish with the conclusion.
:::
```

This slide uses stages 0, 2, and 5; unused stage numbers are skipped. Stages are integers from 0 to 99. A panel can carry `stage=N` to reveal its group. Nested content cannot reveal before its enclosing staged container. Hidden objects retain their layout space.

Use **Reveal → All** while arranging a slide. **Play** starts at stage 0 of the current slide, advances through its used stages, and then moves to the next slide. Use arrows, Space, or the on-screen controls; Escape returns to the editing view and restores its selection and zoom.

PDF contains one physical page for stage 0 and each used positive stage. These pages keep their logical slide number. Exported HTML with reveals has Previous/Next controls and Arrow, PageUp/PageDown, Space, Home, and End navigation. A deck without reveals uses a scrolling HTML view and one PDF page per slide.

## Source editing, saving, and shortcuts

Open the Markdown in your preferred editor and keep the browser beside it. **Source** opens the read-only source pane. **Show source** highlights the selected object's block; clicking a line navigates back to its slide or object. **Open in VS Code** opens the corresponding local file location when VS Code's URL handler is available.

Geometry, style, crop, insertion, deletion, and arrangement operations save after completion. Text uses **Apply text**. Play and GUI PDF export first save valid pending text drafts. If external edits changed a draft's original content, explicitly keep or discard that draft before continuing.

External file edits trigger a source conflict. Save the external edit, choose **Reload source**, and review any retained text drafts. Undo/redo is kept in the running server, survives browser refresh, and resets after a server restart or external source change. Each application has its own editing history; use Git checkpoints for durable versions.

| Action | Shortcut or control |
| --- | --- |
| Fine movement | Arrow keys; Shift+Arrow moves 10 pixels |
| Undo / redo | Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z |
| Add/remove selection | Shift-click |
| Select a region | Drag on empty canvas |
| View scale | Fit or 25–200% zoom |
| Pan a zoomed canvas | Hold Space and drag |
| Cycle guides | G: off, layout, grid |
| Temporarily bypass snapping | Hold Alt while dragging |
| Apply/cancel cropping | Enter / Escape |
| Leave Play | Escape |

The fine grid is a visual guide. Optional snapping uses object and layout guides. There is no automatic collision avoidance, semantic connector routing, direct rich-text editing inside the slide, or editable PowerPoint/Keynote export. See [compatibility](compatibility.md) for renderer boundaries and the [presenter guide](presenter.md) for two-screen talks.

## Presenter mode and notes

Use **Present** for two-screen talks. The console shows current/next previews, notes, a timer, pointer modes, and slide/whiteboard drawing tools. Add hidden Markdown notes with **Notes** in the editor. See the [presenter guide](presenter.md) for setup, shortcuts, and recovery. **Play** remains the quick rehearsal mode.
