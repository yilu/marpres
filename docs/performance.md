# Editor performance audit — 2026-10-22

Measured using a private copy of a 24-page scientific deck with large native
SVG plots and bitmap figures, on local Chrome. The working deck was not edited
by the benchmarks. Timings are indicative measurements, not performance guarantees.

| Operation | Before | After |
| --- | ---: | ---: |
| Deck response payload | 106.98 MB | 0.51 MB |
| Warm deck request | 201–230 ms | 26–29 ms |
| Theme-preview payload | 106.89 MB | 0.42 MB |
| Browser initial load, same-server comparison | 3.33 s | 1.01 s |
| Geometry save | 546 ms | 380 ms |
| Drag release | 604 ms | 518 ms |
| Resize release | 633 ms | 499 ms |
| Concurrent deck request during PDF export | 17.3 s | 28 ms |

## Changes

- Editor, theme preview and presentation snapshots reference cached images by
  content hash. The server retains the original bytes for each URL, so a later
  file edit cannot change an existing presentation snapshot. Default standalone
  renderer behavior still embeds images.
- Image file changes invalidate the editor render cache on its next deck request,
  even when Markdown did not change.
- Slide appearance metadata shares one source map and Markdown parse instead of
  parsing the whole document again for every slide.
- Initial rendering explicitly waits only for the displayed slide's images.
  Other images load normally. Crop/inspector geometry waits for visible images.
- Unchanged slide thumbnails keep their DOM nodes, decoded images and focus.
  Editing one slide retained 23 of 24 thumbnails; navigator refresh fell from
  14–18 ms to roughly 1 ms. Source-line offsets alone do not invalidate a thumbnail;
  changed slide markup or CSS does.
- PDF jobs have their own sequential queue. Chromium printing no longer holds
  the editor's request queue; the export still rejects a stale source hash before
  returning. The initiating editor retains its existing busy-state behavior.
- HTML export can bundle original assets, link original files with `--link-images`,
  or embed them with `--embed-images`. Single-file output embeds each repeated
  payload once. No image resampling or lossy compression is performed.

## Verification

The unit suite covers cached asset bytes, file invalidation, presentation
immutability, theme previews, batched appearance metadata and export concurrency.
Browser checks cover directory/linked/embedded offline HTML, original image
dimensions, SVG crops, PDF page sizes/stages, theme preview, presentation windows
and 4K/DPR rendering. Existing GUI, Shift-axis drag and sidebar keyboard checks
remain passing.

The focused browser regression can be run with:

```sh
node test/ui-performance-browser.mjs
node test/asset-delivery-browser.mjs
node test/link-images-browser.mjs
```

It covers drag and resize release, crop opening/cancel, draft retention across
geometry/style saves, text save, undo/redo, thumbnail identity and navigation.

## Remaining costs

Main slide DOM is still rebuilt after a saved edit to clear temporary gesture
styles and renderer state safely. Whole-deck rendering and this DOM update leave
roughly 0.4–0.5 s end-to-end latency for edits in the measured deck. A deeper
incremental-rendering change would need broader correctness work.

Full-quality PDF export still takes about 17 s for this deck. No browser pooling,
worker architecture or image-quality reduction was introduced. Idle server
sampling did not show a busy loop. Presentation ink heartbeat traffic and
long-lived asset-map memory remain candidates for future measurement with large
whiteboard sessions; this audit found no reason to change them speculatively.
