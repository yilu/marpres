# Editor Layers Implementation Plan

**Goal:** Select covered objects from a front-to-back layer list and use all four standard stacking actions, saved to Markdown and undoable.

**Architecture:** Reuse the existing integer layer option and atomic batch edit API. A focused browser module owns layer ordering, list selection and inspector tabs; existing client selection/history remains the owner of editing state. Nested objects stay within their parent stacking context. Preserve existing uncommitted work and use temporary test decks.

**Files:** New editor/web/layers.js; small edits to editor/web/client.js, index.html and client.css; test/layers.test.mjs and test/layers-browser.mjs; update authoring guide.

- [x] Write and run failing pure ordering tests and browser overlap-selection test.
- [x] Implement stable front/back/one-step ordering, preserving selected relative order and bounding integer layer values.
- [x] Add Format/Layers tabs, front-to-back object rows, four stacking controls, stage-aware selection, and keyboard list navigation.
- [x] Verify actual browser hit testing, persisted order, reload, atomic undo/redo, nested groups and geometry preservation.
- [x] Run existing arrangement/sidebar tests and unit suite; inspect wide/narrow UI and verify live editor serves the new assets.

## Additional fixes requested during implementation

- PDF export: reproduced a 500 with the actual ~142MiB inline HTML. Replaced browser-protocol transfer with a frozen temporary HTML and content-addressed original-byte assets. UI export on3031 now downloads the full 60-page deck in about11s. Original image resolution and vector artwork retained.
- Independent review: fixed anonymous stacking contexts (including static non-flex boxes), sparse layer updates on101-object slides, whitespace regexes. Source/history, client drafts and current presentation position remain owned by the established paths.
- Presentation remotes: removed the experimental start/stop shortcut and cross-window stop machinery at the user’s request; retained the existing F fullscreen control and slide navigation.
