# Image management

Images remain ordinary files. Markdown references them by path; visual placement and cropping are separate settings in the deck.

## Images inserted through the GUI

The **Image** button copies a selected PNG, JPEG, SVG, GIF, or WebP file into **`figures/imported/` relative to the Markdown file's directory**. Each import is limited to 10 MB.

For a deck at `my-talk/slides.md`:

```text
my-talk/
├── slides.md
└── figures/
    └── imported/
        └── <sha256-content-hash>.png
```

The inserted Markdown uses a relative reference such as `![original-name.png](figures/imported/<hash>.png)` inside an editable `figure` block.

- The original selected file is left untouched; moving or deleting that original later does not break the imported copy.
- The filename comes from the image bytes. Identical imports reuse the same file, while different images with the same original filename remain separate.
- Each insertion is a separate slide object, even when it shares an image file with another object.
- The original filename is kept as the image's alternative text. The copied file is not resized or recompressed.
- Imported assets are treated as immutable. To use a changed image, import the new version. An import detects and rejects an existing hashed file whose contents were altered.

The import folder belongs to the Markdown file's **directory**, not to its filename. Two decks in one directory share `figures/imported/`. Keep each talk in its own directory for separate asset collections.

## Images referenced in Markdown

You can organize manually added images under any convenient folder, for example `figures/results.svg`, and reference them relative to the Markdown file. Marpres reads these files in place; it does not move them into the import folder.

Use a `figure` block with a unique ID when you want GUI resizing and cropping:

```markdown
::: figure id=results width=600
![Results](figures/results.svg)
:::
```

Crop percentages and frame size are saved on the figure's opening line. The image bytes remain unchanged, and multiple figures can show different crops of the same source. See [figures and cropping](authoring.md#figures-and-cropping).

## Deletion, undo, and sharing

Deleting a slide object or undoing an insertion removes its Markdown reference, but keeps the imported file. This supports redo and reuse by other slides or decks. There is currently no automatic unused-image cleanup or media library.

Before manually removing an imported file, check every deck that shares its directory. Moving or renaming a referenced asset requires updating its Markdown references too.

Keep the Markdown and its `figures/` folder together when moving a talk or sharing its editable source, and track both in Git. The `figures/imported/` directory is source material, not a disposable build cache.

For sharing finished slides, Marpres's HTML/PDF builds include the local Markdown image elements in the rendered output. Remote image URLs, external styles/fonts, or references inside an SVG may still depend on external resources. Original-template Marp CLI exports follow Marp's own asset handling; keep source assets with that deck when editing or rebuilding it.

Image imports and rendering do not change an image's copyright or license.
