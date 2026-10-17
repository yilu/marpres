export function createNotesPanel({ getDeck, getPage, canMutate, mutate, navigate, report }) {
  const pane = document.createElement('section')
  pane.id = 'notes-pane'; pane.hidden = true
  pane.setAttribute('aria-label', 'Speaker notes')
  pane.innerHTML = '<div class="notes-heading"><strong>Speaker notes</strong><span id="notes-slide"></span><span class="notes-private">Private to presenter · Markdown supported</span><button id="close-notes" class="icon-button" aria-label="Close notes">×</button></div><textarea id="notes-editor" aria-label="Speaker notes" placeholder="Add reminders, context, or your speaking script…" spellcheck="true"></textarea><div class="notes-actions"><span id="notes-status" role="status"></span><button id="keep-notes" class="quiet" hidden>Keep my draft</button><button id="discard-notes" class="quiet" hidden>Discard draft</button><button id="save-notes" class="quiet">Save notes</button></div>'
  document.querySelector('.canvas-footer').before(pane)
  const toggle = document.createElement('button')
  toggle.id = 'toggle-notes'; toggle.className = 'quiet'; toggle.textContent = 'Notes'
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'notes-pane')
  document.querySelector('#toggle-inspector').before(toggle)
  const text = pane.querySelector('#notes-editor'), notice = pane.querySelector('#notes-status'), save = pane.querySelector('#save-notes'), discard = pane.querySelector('#discard-notes'), keep = pane.querySelector('#keep-notes')
  const drafts = new Map()
  const normalize = value => value.trim() ? value.replaceAll('\r\n', '\n') : ''
  const slideAt = page => getDeck()?.slides?.[page]
  const conflict = (page, draft) => draft.stale || !slideAt(page) || draft.base !== (slideAt(page).notes ?? '')
  let shownPage = -1
  function open() { pane.hidden = false; toggle.setAttribute('aria-expanded', 'true'); sync(); text.focus() }
  function close() { pane.hidden = true; toggle.setAttribute('aria-expanded', 'false') }
  function sync() {
    const page = getPage(), source = slideAt(page), draft = drafts.get(page)
    if (draft && !draft.stale && normalize(draft.value) === (source?.notes ?? '')) drafts.delete(page)
    const pending = drafts.get(page), changed = pending && conflict(page, pending), invalid = pending?.value.includes('-->')
    const value = pending?.value ?? source?.notes ?? ''
    if (shownPage !== page || text.value !== value) text.value = value
    shownPage = page
    pane.querySelector('#notes-slide').textContent = `Slide ${page + 1}`
    text.disabled = !canMutate()
    save.disabled = !canMutate() || !pending || changed || invalid
    discard.hidden = !pending; keep.hidden = !changed
    discard.disabled = keep.disabled = !canMutate()
    notice.textContent = invalid ? 'Notes cannot contain the HTML comment terminator -->.' : changed ? 'Source changed. Review this slide, then keep or discard your draft.' : pending ? 'Unsaved notes · saved before Preview, Present, and PDF.' : 'Notes saved'
    notice.dataset.state = invalid || changed ? 'error' : pending ? 'draft' : 'saved'
  }
  text.addEventListener('input', () => {
    const page = getPage(), old = drafts.get(page)
    drafts.set(page, { base: old?.base ?? slideAt(page)?.notes ?? '', value: text.value, stale: old?.stale ?? false })
    sync()
  })
  async function saveDraft(page) {
    const draft = drafts.get(page)
    if (!draft) return true
    if (draft.value.includes('-->') || conflict(page, draft)) {
      navigate(page); open(); sync()
      report(draft.value.includes('-->') ? 'Remove the comment terminator from notes before continuing.' : 'Resolve the notes draft before continuing.', 'conflict')
      return false
    }
    const result = await mutate('/api/notes', { slide: page + 1, notes: draft.value }, null, 'Notes saved')
    if (!result) return false
    if (normalize(draft.value) === (result.slides?.[page]?.notes ?? '')) drafts.delete(page)
    sync()
    return true
  }
  save.addEventListener('click', () => saveDraft(getPage()))
  discard.addEventListener('click', () => { drafts.delete(getPage()); sync() })
  keep.addEventListener('click', () => {
    const draft = drafts.get(getPage())
    if (draft) { draft.base = slideAt(getPage())?.notes ?? ''; draft.stale = false }
    sync()
  })
  toggle.addEventListener('click', () => pane.hidden ? open() : close())
  pane.querySelector('#close-notes').addEventListener('click', close)
  return {
    sync,
    hasDrafts: () => drafts.size > 0,
    invalidate: () => { for (const draft of drafts.values()) draft.stale = true },
    async savePending() {
      for (const page of [...drafts.keys()]) if (!await saveDraft(page)) return false
      return true
    }
  }
}
