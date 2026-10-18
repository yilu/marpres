# Presenting with Marpres

**Present** is the primary toolbar action for an audience window and a separate presenter console. The secondary **Preview** button (eye icon) runs a quick rehearsal inside the editor; Escape returns to editing. Both save valid drafts before starting.

These interfaces are optional. Markdown-only builds and the original template’s native Marp CLI workflow remain available; see [compatibility](compatibility.md).

## Start a two-screen presentation

1. Open your deck with `npm run dev -- slides/my-talk.md` and select the starting slide.
2. Choose **Present**. Valid text and notes drafts are saved before the console opens. Resolve any source conflict first. If the browser blocks the popup, use the presenter link shown in the editor or allow popups for its local address.
3. In the console, choose **Start presenting**. In Chrome, allow display access when asked. Marpres chooses another display, preferring an external one, and places the audience window there. After a permission prompt, click Start again if the status asks for a fresh click.
4. If the browser does not allow the new window to enter fullscreen automatically, choose **Enter audience fullscreen** in the console. You can also use **Enter fullscreen** in the audience window. **Swap displays** exchanges the console and audience while preserving the current slide, reveals, notes, timer, and ink.
5. Start the timer when you begin speaking. Its target defaults to **16 minutes** and can be changed independently of slide navigation.
6. Choose **End** in the console when finished. Audience windows show an ended screen, and the snapshot is released.

Keep the editor's terminal server running and use the same browser profile and local address for both windows. Marpres targets installed Chrome. Automatic placement uses its permission-gated [Window Management API](https://developer.chrome.com/docs/capabilities/web-apis/window-management); fullscreen remains subject to browser policy. Opening a popup normally consumes the initial click, so another fullscreen click can be necessary. No browser flags or extensions are required. Escape exits fullscreen.

**Detect displays** requests or refreshes display access. With permission already granted, discovery happens when the console opens. **Audience window** remains available for manual placement when discovery is unsupported or denied. Swap is available only when Marpres can identify the connected audience on a separate display. If the browser refuses to move a console opened as an ordinary tab, the status message asks you to move it manually; consoles opened with the editor's Present button use a dedicated popup.

Disconnecting a screen or changing permission updates the controls without resetting the presentation or forcing a new fullscreen window. Arrange the windows or use Start again for the new setup. The operating system decides where a window goes when its display disconnects.

## Presenting with one screen

With one screen, **Start presenting** shows only the current slide and its annotations fullscreen in the console's existing window. Notes, next preview, timer, and editing controls stay outside that fullscreen view. Arrow keys and the normal pointer/drawing shortcuts keep working. Press **Escape** to return to the same console, or **F** to toggle this slide-only view.

No extra audience window is required, and Swap is disabled. The manual Audience window action is still available if you want a separate window for rehearsal. Mirrored displays share the same desktop: they show the fullscreen slide together, and returning to the console makes the console visible on both. Use an extended desktop for private notes on one display and slides on another.

The console shows the current slide, the next reveal, speaker notes, elapsed time, and audience connection status. Forward navigation walks through the used reveal stages before changing slides. Backward navigation returns to the previous slide's last reveal. The slide menu jumps directly to a slide's beginning.

## Speaker notes

Choose **Notes** at the bottom of the editor to write Markdown notes for the selected slide. **Save notes** is undoable; valid drafts are also saved before Preview, Present, PDF export, and slide reordering. Conflicting drafts stay available until you explicitly keep or discard them.

Notes are stored as an explicit hidden comment on their slide:

```markdown
<!-- notes
Explain the main result before discussing the axes.

- Pause after the first reveal.
- Allow one minute for the comparison.
-->
```

Use one notes comment per slide. Its opening and closing markers must be on separate lines. The comment terminator `-->` cannot appear inside the notes. Literal examples inside fenced code remain examples.

Notes appear only in the console. They are absent from the audience snapshot, its rendered frame, and the generated PDF/HTML. The presenter URL contains a private capability in its fragment; do not share that URL as an audience link. Markdown source files still contain their notes.

Drag the divider beside the current slide to widen the notes column. The next preview and timer leave most of that column's height for notes; **A− / A+** adjusts note text size. With the divider focused, use Left/Right to resize, Shift for larger steps, and Home/End for the minimum/maximum width. These keys do not navigate slides while the divider is focused.

**Hide** collapses the entire notes or next-preview card, giving its space to the remaining card. The footer's **Notes** and **Next preview** buttons restore them. **Reset layout** restores the default width, visible cards, and text size. These preferences persist in the browser independently of slide position, timer, and ink; narrow windows use a stacked layout.

Change note contents in the editor, then start a new presentation to use the updated source.

## Display resolution

Audience slides are live HTML and SVG, not screenshots. Text, SVG equations, SVG figures, and vector annotations render at the display's resolution. The slide document retains a 1280 × 720 logical viewport and scales proportionally to the window, with letterboxing when needed. This keeps authored CSS, including viewport units and media queries, consistent between the console and audience.

PNG, JPEG, and other bitmap figures retain their original pixel dimensions. Enlarging a low-resolution figure cannot add detail; use an SVG source or a larger original when available. Image imports are not downsampled. Browser zoom and operating-system display scaling can also affect apparent sharpness.

Automated Chrome checks cover 3840 × 2160 at device pixel ratios 1 and 2, resizing, sharp SVG detail, authored CSS consistency, and annotation alignment. The previously reported monitor blur was not reproduced in those checks.

## Pointers, ink, and whiteboard

Choose **Arrow**, **Hand**, **Laser**, or **Spotlight**, then move over the current-slide preview. The audience sees the same pointer at the corresponding position. These tools also work directly in the audience window. Clicking with a pointer advances a reveal; dragging does not.

**Pen** and **Highlight** draw over the slide. Colour and width apply to new strokes. **Eraser** removes a stroke; **Undo**, **Redo**, and **Clear ink** operate on the current slide or whiteboard. A short click makes a dot. Annotation coordinates remain aligned when a window changes size.

Ink belongs to its logical slide, so it remains across reveals and when you return to that slide. **Whiteboard** opens a separate blank canvas with its own ink. Toggle it off to return to the slide. **Black screen** hides the slide and pointers while keeping the console controls available. Navigation leaves either temporary screen mode and moves through the slide sequence.

Drawings belong to the presentation session. They do not change the Markdown, undo history, or exported PDF. Reloading the console restores its position, timer, and committed ink when browser storage is available; ink undo/redo history and unfinished strokes reset on reload. End the session to start afresh. Up to 200 strokes per canvas and 4096 points per stroke are retained.

## Keyboard controls

| Key | Action |
| --- | --- |
| Right, Down, Space, Page Down | Next reveal |
| Left, Up, Page Up | Previous reveal |
| Home / End | First slide / last reveal |
| B / W | Black screen / whiteboard |
| V / L / S | Arrow / laser / spotlight |
| P / H / E | Pen / highlighter / eraser |
| Ctrl/⌘ Z / Ctrl/⌘ Shift Z | Undo / redo ink |
| F | Toggle audience fullscreen, or slide-only fullscreen in the console |
| Escape | Exit fullscreen, or leave black/whiteboard/pointer mode |
| ?, in the console | Show shortcuts |

Typing in a field does not navigate the presentation. Audience controls fade while fullscreen; move the mouse to reveal them.

## Recovery and boundaries

Each presentation uses a fixed snapshot of the saved deck. Editing the source during a talk does not change the projected slide. Start a new session to use a newer version.

Only one console controls a session at a time. If a second console reports that it is already controlled, close the first and retry. Audience reloads and reopened audience windows request the current slide and ink from the console. Closing the console leaves the last audience slide in place and shows a disconnection message; reopening its existing presenter link reconnects it. Keep that console open while presenting.

Restarting the server clears its snapshots. An ended or missing session offers a route back to the editor. At most twelve sessions can be active; end unused sessions to make room. Browser storage failures do not stop a live presentation, but can prevent restoration after refresh.

The dual-window console runs from the local editor. Standalone exported HTML retains its existing reveal playback; it does not bundle the console, private notes, or live ink. Remote control from another device, recording, and permanent annotation export are outside this version. Display tests use real Chrome APIs with virtual monitors; window-manager behavior on a physical projector or a different browser may still require manual placement or a fullscreen click.
