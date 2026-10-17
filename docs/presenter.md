# Presenting with Marpres

**Present** is the primary toolbar action for an audience window and a separate presenter console. The secondary **Preview** button (eye icon) runs a quick rehearsal inside the editor; Escape returns to editing. Both save valid drafts before starting.

These interfaces are optional. Markdown-only builds and the original template’s native Marp CLI workflow remain available; see [compatibility](compatibility.md).

## Start a two-screen presentation

1. Open your deck with `npm run dev -- slides/my-talk.md` and select the starting slide.
2. Choose **Present**. Valid text and notes drafts are saved before the console opens. Resolve any source conflict first. If the browser blocks the popup, use the presenter link shown in the editor or allow popups for its local address.
3. In the console, choose **Open audience window**. Move that window to the projector or second display, then click **Enter fullscreen** there. Keep the console on your own screen.
4. Start the timer when you begin speaking. Its target defaults to **16 minutes** and can be changed independently of slide navigation.
5. Choose **End** in the console when finished. Audience windows show an ended screen, and the snapshot is released.

Keep the editor's terminal server running and use the same browser profile and local address for both windows. Marpres targets installed Chrome. The browser controls display placement and [fullscreen permission](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen); Marpres does not automatically move a window between monitors. Escape exits fullscreen.

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

The console can hide notes or enlarge their text. Change their contents in the editor, then start a new presentation to use the updated source.

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
| F, in the audience window | Toggle fullscreen |
| Escape | Exit fullscreen, or leave black/whiteboard/pointer mode |
| ?, in the console | Show shortcuts |

Typing in a field does not navigate the presentation. Audience controls fade while fullscreen; move the mouse to reveal them.

## Recovery and boundaries

Each presentation uses a fixed snapshot of the saved deck. Editing the source during a talk does not change the projected slide. Start a new session to use a newer version.

Only one console controls a session at a time. If a second console reports that it is already controlled, close the first and retry. Audience reloads and reopened audience windows request the current slide and ink from the console. Closing the console leaves the last audience slide in place and shows a disconnection message; reopening its existing presenter link reconnects it. Keep that console open while presenting.

Restarting the server clears its snapshots. An ended or missing session offers a route back to the editor. At most twelve sessions can be active; end unused sessions to make room. Browser storage failures do not stop a live presentation, but can prevent restoration after refresh.

The dual-window console runs from the local editor. Standalone exported HTML retains its existing reveal playback; it does not bundle the console, private notes, or live ink. Remote control from another device, automatic monitor selection, recording, and permanent annotation export are outside this version.
