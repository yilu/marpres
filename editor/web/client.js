import { createCropEditor } from './crop-editor.js'
import { createSourcePane } from './source-pane.js'
import { createThemePanel } from './theme-panel.js'
import { createNotesPanel } from './notes-panel.js'

const $ = selector => document.querySelector(selector)
const ui = {
  stage: $('#stage'), deck: $('#deck'), guides: $('#guides'), shell: $('#slide-shell'), workspace: $('#workspace'),
  status: $('#status'), reload: $('#reload'), previous: $('#previous'), next: $('#next'), page: $('#page-label'),
  grid: $('#grid-mode'), snap: $('#snap'), undo: $('#undo'), redo: $('#redo'),
  empty: $('#empty-selection'), controls: $('#selected-controls'), geometry: $('#geometry-form'), crop: $('#crop-form'),
  styles: $('#style-form'), content: $('#content-form'), text: $('#content-editor'), shape: $('#shape-form'),
  stages: $('#stage-preview'), stagePrevious: $('#stage-previous'), stageNext: $('#stage-next'), insert: $('#insert-shape')
}
const requestedPage = Number.parseInt(new URLSearchParams(location.search).get('slide'), 10)
const state = { deck: null, generation: 0, page: Number.isFinite(requestedPage) ? Math.max(0, requestedPage - 1) : 0, selected: null, scale: 1, busy: false, conflict: false, invalid: false, gesture: null, alt: false, nudge: null, stage: 'all', inspector: {}, cropping: false, selection: [], zoom: 'fit', presenting: false, presentation: null, space: false, panning: null }
const token = $('meta[name="editor-token"]').content
const round = value => Math.round(value * 10000) / 10000
const frameOf = object => object?.dataset.editKind === 'figure' ? object.querySelector('.figure-frame') ?? object : object
const optionsOf = object => JSON.parse(object?.dataset.editOptions ?? '{}')
const slides = () => [...ui.deck.querySelectorAll('.marpit > svg')]
const currentSlide = () => slides()[state.page]
const currentSection = () => currentSlide()?.querySelector('foreignObject > section')
const editable = () => !state.presenting && !state.busy && !state.conflict && !state.invalid && !state.cropping && state.selected
const sourceObject = object => state.deck?.objects?.find(item => item.id === object?.dataset.editId)
const isText = object => ['box', 'caption', 'ref'].includes(object?.dataset.editKind)
const canMutate = () => !state.presenting && !!state.deck && !state.busy && !state.conflict && !state.invalid && !state.gesture && !state.nudge && !state.cropping
const textStyleKeys = ['font_family', 'bold', 'italic', 'underline', 'strike', 'color', 'align']
const textDrafts = new Map()
const selectedIds = () => state.selection.map(object => object.dataset.editId)
const multiple = () => state.selection.length > 1
const objectById = id => [...ui.deck.querySelectorAll('[data-edit-id]')].find(object => object.dataset.editId === id)
const canonicalText = value => value.replace(/\r\n/g, '\n').replace(/\n+$/, '')
const isFree = object => object?.dataset.editKind === 'shape' || optionsOf(object).position === 'absolute'
const owningPanel = object => object && !isFree(object) ? object.closest('.panel') : null
let arrangementSelection = ''
let insertionPage = -1

function refreshInsertionTargets() {
  const target = $('#insertion-target')
  const previous = insertionPage === state.page ? target.value : ''
  target.replaceChildren(new Option('Free on slide', ''), ...[...currentSlide()?.querySelectorAll('.panel') ?? []].map(panel => new Option(`Panel ${panel.dataset.panelIndex}`, panel.dataset.panelIndex)))
  target.value = [...target.options].some(option => option.value === previous) ? previous : ''
  insertionPage = state.page
  $('#insertion-control').hidden = !state.deck?.capabilities?.panelInsertion
}

function insertionPanel() {
  const value = $('#insertion-target').value
  return value && state.deck?.capabilities?.panelInsertion ? { panel: Number(value) } : {}
}

function commonPanel() {
  const panel = owningPanel(state.selection[0])
  return panel && state.selection.every(object => owningPanel(object) === panel) ? panel : null
}

function updateAlignmentControls() {
  const target = $('#align-target'), panel = commonPanel(), count = state.selection.length
  const selectionOption = target.querySelector('[value="selection"]'), panelOption = target.querySelector('[value="panel"]')
  selectionOption.disabled = count < 2
  selectionOption.textContent = count < 2 ? 'Selected objects (select 2+)' : 'Selected objects'
  panelOption.disabled = !panel
  panelOption.textContent = panel ? 'Containing panel' : 'Containing panel (no common panel)'
  if (!count) {
    target.disabled = true
    for (const button of document.querySelectorAll('[data-align]')) button.disabled = true
    return
  }
  const key = JSON.stringify(selectedIds().sort())
  if (key !== arrangementSelection || target.selectedOptions[0]?.disabled) target.value = count > 1 ? 'selection' : panel ? 'panel' : 'content'
  arrangementSelection = key
  const notes = {
    selection: 'Use the combined bounds of the selected objects.',
    panel: `Use the full bounds of panel ${panel?.dataset.panelIndex ?? ''}, including its caption area.`,
    content: 'Use the content area between the title and footer.',
    slide: 'Use the full slide, including its outer edges.'
  }
  $('#alignment-note').textContent = notes[target.value]
  target.disabled = !editable()
  for (const button of document.querySelectorAll('[data-align]')) button.disabled = !editable()
}

function rememberTextDraft() {
  const source = sourceObject(state.selected)
  if (!source?.contentEditable) return
  const value = ui.text.value
  if (value === source.content) textDrafts.delete(source.id)
  else {
    const previous = textDrafts.get(source.id)
    textDrafts.set(source.id, { value, base: previous?.base ?? source.content })
  }
  refreshDraftNotice()
  updateControls()
}

function refreshDraftNotice() {
  const source = sourceObject(state.selected)
  const draft = textDrafts.get(source?.id)
  const conflict = !!draft && draft.base !== source?.content
  $('#content-note').textContent = !source?.contentEditable ? 'This group contains other objects. Select an individual text box to edit it.'
    : conflict ? 'Source text changed. Your unsaved draft is preserved. Keep it to replace the new source text, or discard it to load the source.'
    : draft ? 'Unsaved text draft · Apply text to save. Switching objects keeps this draft.'
    : 'Select words below, then choose a format.'
  $('#content-draft-actions').hidden = !draft
  $('#keep-content').hidden = !conflict
  $('#save-content').disabled = !!conflict || !source?.contentEditable || state.busy || state.conflict || state.invalid || state.cropping
}

function status(message, type = '') {
  ui.status.textContent = message
  ui.status.dataset.state = type
}

function setBusy(value) {
  if (value) state.generation++
  state.busy = value
  document.body.classList.toggle('saving', value)
  updateControls()
  updateHistory()
}

function updateControls() {
  const unavailable = state.busy || state.conflict || state.invalid || state.cropping || state.presenting
  for (const element of ui.controls.querySelectorAll('button, input, select, textarea')) element.disabled = unavailable
  const contentUnavailable = unavailable || !sourceObject(state.selected)?.contentEditable
  for (const element of ui.content.querySelectorAll('button, textarea')) element.disabled = contentUnavailable
  refreshDraftNotice()
  ui.insert.disabled = unavailable || !state.deck || !!state.gesture || !!state.nudge
  $('#insert-text').disabled = ui.insert.disabled
  $('#shape-type').disabled = ui.insert.disabled
  ui.stages.disabled = unavailable || !!state.gesture || !!state.nudge
  const values = [...ui.stages.options].map(option => option.value).filter(value => value !== 'all')
  const position = values.indexOf(state.stage)
  ui.stagePrevious.disabled = ui.stages.disabled || position <= 0
  ui.stageNext.disabled = ui.stages.disabled || position >= values.length - 1
  ui.previous.disabled = state.busy || state.cropping || state.page <= 0
  ui.next.disabled = state.busy || state.cropping || state.page >= slides().length - 1
  ui.reload.disabled = state.cropping
  themePanel.sync(state.page)
  notesPanel.sync()
  for (const element of document.querySelectorAll('#style-form input, #style-form select, #style-form button, #shape-form input, #shape-form button, #font-field input, #toolbar-crop, #delete-image')) element.disabled = unavailable || multiple()
  if (multiple()) for (const element of document.querySelectorAll('#geometry-form input, #geometry-form button, #content-form button, #content-form textarea, #crop-form button, #stage-form input, #stage-form button, #reset-position')) element.disabled = true
  for (const element of document.querySelectorAll('#insert-image, #shape-menu-toggle, [data-slide-action], #slide-title, #play, #present, #export-pdf')) element.disabled = !canMutate()
  for (const element of document.querySelectorAll('[data-distribute]')) element.disabled = unavailable || state.selection.length < 3
  for (const element of document.querySelectorAll('[data-slide-action]')) {
    const action = element.dataset.slideAction
    if (action === 'delete' && slides().length < 2 || action === 'move-up' && state.page === 0 || action === 'move-down' && state.page === slides().length - 1) element.disabled = true
  }
  for (const element of document.querySelectorAll('#zoom-level, #zoom-fit, #zoom-in, #zoom-out')) element.disabled = state.cropping || !!state.gesture || !!state.nudge
  updateAlignmentControls()
  $('#insertion-target').disabled = !canMutate()
}


function updateHistory() {
  const unavailable = state.busy || state.conflict || state.cropping || !!state.gesture || !!state.nudge
  ui.undo.disabled = unavailable || !state.deck?.history?.canUndo
  ui.redo.disabled = unavailable || !state.deck?.history?.canRedo
}

async function request(path, body) {
  const response = await fetch(path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Token': token }, body: JSON.stringify(body)
  } : {})
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(data.error ?? 'The request failed.')
    error.code = data.code
    error.status = response.status
    throw error
  }
  return data
}

function showError(error) {
  if (error.code === 'CONFLICT' || error.code === 'UNCERTAIN') {
    state.conflict = true
    document.body.classList.add('conflicted')
    ui.reload.hidden = false
    status(error.code === 'UNCERTAIN' ? 'Save could not be confirmed. Reload source before editing.' : 'Source changed. Reload to continue; the pending edit was not saved.', 'conflict')
  } else status(error.message, 'error')
  setBusy(false)
}

async function recoverMutation(error, committed, id) {
  if (error.code === 'CONFLICT') { showError(error); return }
  if (error.status >= 400 && error.status < 500) {
    await render(committed, id)
    showError(error)
    return
  }
  // A lost response does not imply a failed write. Reconcile with a fresh read;
  // never repeat the POST, since the original gesture may already be committed.
  try {
    await render(await request('/api/deck'), id)
    if (!state.invalid) status('Connection interrupted. Source reloaded.')
  } catch {
    await render(committed, id)
    showError(Object.assign(new Error('Save could not be confirmed.'), { code: 'UNCERTAIN' }))
  }
}

async function mutate(path, body, id = multiple() ? selectedIds() : state.selected?.dataset.editId, message = 'Saved') {
  if (!canMutate()) return
  const committed = state.deck
  setBusy(true)
  status('Saving…')
  try {
    const result = await request(path, { hash: state.deck.hash, ...body })
    await render(result, result.selectedId ?? id)
    status(message)
    return result
  } catch (error) {
    await recoverMutation(error, committed, id)
  } finally { setBusy(false) }
}

function save(patch, id = state.selected?.dataset.editId) {
  if (id && Object.keys(patch).length) return mutate('/api/edit', { id, patch }, id)
}

async function history(direction) {
  if (state.busy || state.conflict || state.cropping || state.gesture || state.nudge || !state.deck?.history?.[direction === 'undo' ? 'canUndo' : 'canRedo']) return
  if (notesPanel.hasDrafts()) { status('Save or discard your notes draft before undo or redo.', 'conflict'); return }
  const committed = state.deck
  const id = selectedIds()
  setBusy(true)
  try {
    await render(await request(`/api/${direction}`, { hash: state.deck.hash }), id)
    status(direction === 'undo' ? 'Undone' : 'Redone')
  } catch (error) { await recoverMutation(error, committed, id) } finally { setBusy(false) }
}

async function render(data, selectedId) {
  state.generation++
  moveable.target = null
  state.selected = null
  state.selection = []
  state.deck = data
  if (data.selectedSlide) insertionPage = -1
  // Successful content saves retire their drafts; other mutations preserve them.
  for (const source of data.objects ?? []) {
    const draft = textDrafts.get(source.id)
    if (draft && canonicalText(draft.value) === source.content) textDrafts.delete(source.id)
  }
  state.invalid = !!data.editingError
  $('#deck-style').textContent = data.css
  ui.deck.innerHTML = data.html
  const images = [...ui.deck.querySelectorAll('img')]
  await Promise.all(images.map(image => image.decode?.().catch(() => {})))
  await document.fonts.ready
  const count = slides().length
  state.page = Math.max(0, Math.min(data.selectedSlide ? data.selectedSlide - 1 : state.page, count - 1))
  const ids = (Array.isArray(selectedId) ? selectedId : [selectedId]).filter(Boolean)
  const first = objectById(ids[0])
  if (first && !data.selectedSlide) state.page = slides().indexOf(first.closest('.marpit > svg'))
  refreshNavigator()
  sourcePane.render()
  showPage(state.page)
  setSelection(ids.map(objectById).filter(object => object?.closest('.current-slide')))
  $('#deck-title').textContent = data.title ?? data.slides?.[0]?.title ?? slides()[0]?.querySelector('h1')?.textContent ?? 'Presentation'
  document.title = `${$('#deck-title').textContent} · Marpres`
  const notes = data.diagnostics ?? []
  $('#diagnostics').hidden = notes.length === 0
  $('#diagnostics ul').replaceChildren(...notes.map(note => {
    const item = document.createElement('li')
    item.textContent = typeof note === 'string' ? note : note.message ?? JSON.stringify(note)
    return item
  }))
  updateHistory()
  if (data.editingError) status(data.editingError, 'error')
}

function showPage(index) {
  if (state.cropping || state.gesture || state.nudge || state.busy && !state.deck) return
  const page = Math.max(0, Math.min(index, slides().length - 1))
  if (page !== state.page) state.stage = 'all'
  state.page = page
  slides().forEach((slide, position) => slide.classList.toggle('current-slide', position === state.page))
  refreshInsertionTargets()
  select(null)
  ui.page.textContent = `${state.page + 1} / ${slides().length}`
  ui.previous.disabled = state.page <= 0
  ui.next.disabled = state.page >= slides().length - 1
  refreshStages()
  const url = new URL(location.href)
  url.searchParams.set('slide', String(state.page + 1))
  window.history.replaceState(null, '', url)
  fitSlide()
  drawGuides()
  refreshNavigatorSelection()
  themePanel.sync(state.page)
  notesPanel.sync()
}

function refreshStages() {
  const stages = [...new Set([0, ...[...currentSlide()?.querySelectorAll('[data-stage]') ?? []].map(object => Number(object.dataset.stage)).filter(Number.isFinite)])].sort((a, b) => a - b)
  if (state.stage !== 'all' && !stages.includes(Number(state.stage))) state.stage = 'all'
  ui.stages.replaceChildren(...['all', ...stages.map(String)].map(value => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value === 'all' ? 'All' : `Stage ${value}`
    return option
  }))
  ui.stages.value = state.stage
  applyStage()
}

function applyStage() {
  for (const object of currentSlide()?.querySelectorAll('[data-stage]') ?? []) object.classList.toggle('stage-hidden', state.stage !== 'all' && Number(object.dataset.stage) > Number(state.stage))
  if (state.selection.some(object => object.closest('.stage-hidden'))) setSelection(state.selection.filter(object => !object.closest('.stage-hidden')))
  updateControls()
  moveable.updateRect()
}

function fitSlide() {
  const padding = parseFloat(getComputedStyle(ui.workspace).paddingLeft) * 2
  const fit = Math.max(0.05, Math.min((ui.workspace.clientWidth - padding) / 1280, (ui.workspace.clientHeight - padding) / 720))
  state.scale = state.presenting || state.zoom === 'fit' ? fit : Number(state.zoom) / 100
  $('#zoom-level').value = String(state.zoom)
  $('#zoom-level option[value="fit"]').textContent = state.zoom === 'fit' ? `Fit · ${Math.round(state.scale * 100)}%` : 'Fit'
  $('#zoom-fit').classList.toggle('is-active', state.zoom === 'fit')
  ui.shell.style.width = `${1280 * state.scale}px`
  ui.shell.style.height = `${720 * state.scale}px`
  ui.stage.style.transform = `scale(${state.scale})`
  moveable.zoom = 1 / state.scale
  moveable.updateRect()
  cropEditor.refresh()
}

function stageRect(element) {
  const rect = element.getBoundingClientRect()
  const stage = ui.stage.getBoundingClientRect()
  return { left: (rect.left - stage.left) / state.scale, top: (rect.top - stage.top) / state.scale, width: rect.width / state.scale, height: rect.height / state.scale }
}

function drawGuides() {
  ui.guides.dataset.mode = ui.grid.value
  ui.guides.replaceChildren()
  const canvas = document.createElement('div')
  canvas.className = 'canvas-guide'
  ui.guides.append(canvas)
  for (const element of currentSlide()?.querySelectorAll('.deck-content, .panel, .panel-body') ?? []) {
    const rect = stageRect(element)
    const guide = document.createElement('div')
    guide.className = `guide-box${element.matches('.deck-content') ? ' content-guide' : ''}`
    Object.assign(guide.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    ui.guides.append(guide)
  }
}

function updateSnapping() {
  moveable.snappable = ui.snap.checked && !state.alt
  const selected = state.selected
  const panel = selected?.closest('.panel-body, .panel') ?? currentSlide()?.querySelector('.deck-content')
  const candidates = [...currentSlide()?.querySelectorAll('.editable-object') ?? []].filter(object => !object.closest('.stage-hidden') && !state.selection.includes(object) && !state.selection.some(selected => object.contains(selected) || selected.contains(object))).map(frameOf)
  const bounds = selected ? stageRect(frameOf(selected)) : null
  const nearby = candidates.filter(object => {
    if (!bounds) return false
    const rect = stageRect(object)
    return Math.abs(rect.left + rect.width / 2 - bounds.left - bounds.width / 2) < 450 && Math.abs(rect.top + rect.height / 2 - bounds.top - bounds.height / 2) < 300
  })
  moveable.elementGuidelines = [...(panel ? [panel] : []), ...nearby]
  moveable.verticalGuidelines = [0, 640, 1280]
  moveable.horizontalGuidelines = [0, 360, 720]
}

function setSelection(objects) {
  const clean = [...new Set(objects)].filter(object => object && !object.closest('.stage-hidden') && object.closest('.current-slide'))
  // A selected container already moves its children; never move a child twice.
  const selected = clean.filter(object => !clean.some(parent => parent !== object && parent.contains(object)))
  for (const object of state.selection) object.classList.remove('is-selected')
  state.selection = selected
  state.selected = selected.at(-1) ?? null
  for (const object of selected) object.classList.add('is-selected')
  const object = state.selected
  const figure = object?.dataset.editKind === 'figure'
  moveable.setState({
    target: state.invalid || state.presenting ? null : selected.length > 1 ? selected.map(frameOf) : frameOf(object) ?? null,
    keepRatio: figure,
    resizable: selected.length < 2,
    rotatable: selected.length === 1 && object?.dataset.editKind === 'shape',
    renderDirections: figure ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']
  })
  ui.empty.hidden = !!object
  ui.controls.hidden = !object
  ui.styles.hidden = true
  ui.shape.hidden = true
  $('#figure-toolbar').hidden = true
  $('#format-hint').hidden = !!object && !multiple()
  $('#format-hint').textContent = multiple() ? `${selected.length} objects selected · align, distribute, or drag together` : 'Select an object to format it'
  if (object) refreshInspector()
  if (multiple()) {
    $('#object-label').textContent = `${selected.length} objects selected`
    $('#object-kind').textContent = 'Drag together · Shift-click to adjust selection'
    ui.styles.hidden = ui.shape.hidden = ui.content.hidden = ui.crop.hidden = true
    $('#geometry-form').hidden = $('#stage-form').hidden = true
    $('#figure-toolbar').hidden = true
  } else {
    $('#geometry-form').hidden = $('#stage-form').hidden = false
    $('#figure-toolbar').hidden = !figure
  }
  updateControls()
  updateSnapping()
  moveable.updateRect()
  sourcePane.sync()
}

function select(object, extend = false) {
  if (!extend) return setSelection(object ? [object] : [])
  const selected = [...state.selection]
  if (selected.includes(object)) selected.splice(selected.indexOf(object), 1)
  else if (object) selected.push(object)
  setSelection(selected)
}

function refreshInspector() {
  const object = state.selected
  if (!object) return
  const options = optionsOf(object)
  const frame = frameOf(object)
  const rect = stageRect(frame)
  const figure = object.dataset.editKind === 'figure'
  const shape = object.dataset.editKind === 'shape'
  const text = isText(object)
  const computed = getComputedStyle(object)
  const font = options.font ?? parseFloat(computed.fontSize)
  $('#object-label').textContent = object.dataset.editId
  $('#object-kind').textContent = figure ? 'Figure · aspect ratio preserved' : object.dataset.editKind[0].toUpperCase() + object.dataset.editKind.slice(1)
  const free = isFree(object), panel = owningPanel(object)
  const parent = object.offsetParent, nestedOrigin = free && parent && parent !== currentSection() && currentSection()?.contains(parent)
  $('#position-mode').textContent = free ? `Free position · ${nestedOrigin ? 'parent box' : 'slide'}` : `Layout · ${panel ? `panel ${panel.dataset.panelIndex}` : 'content area'}`
  $('#position-note').textContent = free ? `${shape ? 'Unrotated frame' : 'Frame'} coordinates from the ${nestedOrigin ? 'parent box’s' : 'slide’s'} top-left corner.` : 'Offsets from automatic placement. Moving keeps its place in the layout.'
  $('#position-x-label').textContent = free ? 'X' : 'Offset X'
  $('#position-y-label').textContent = free ? 'Y' : 'Offset Y'
  $('#reset-position').textContent = free ? `Move to ${nestedOrigin ? 'parent' : 'slide'} origin` : 'Reset layout offsets'
  for (const [key, value] of Object.entries({ dx: options.dx ?? 0, dy: options.dy ?? 0, width: options.width ?? (shape ? frame.offsetWidth : rect.width), height: options.height ?? (shape ? frame.offsetHeight : rect.height), font })) {
    ui.geometry.elements[key].value = typeof value === 'number' ? Math.round(value * 100) / 100 : value
  }
  $('#height-field').hidden = figure
  $('#font-field').hidden = !text
  $('#font-origin').textContent = options.font === undefined ? 'Inherited · px' : 'Override · px'
  $('#family-origin').textContent = options.font_family === undefined ? 'Inherited' : 'Override'
  state.inspector = { font: ui.geometry.elements.font.value, styles: {}, geometry: Object.fromEntries(['dx', 'dy', 'width', 'height'].map(key => [key, ui.geometry.elements[key].value])) }
  ui.styles.hidden = !text
  ui.content.hidden = !text
  if (text) {
    const colour = computed.color.match(/[\d.]+/g)?.slice(0, 3).map(value => Math.round(Number(value)).toString(16).padStart(2, '0')).join('')
    const values = {
      font_family: options.font_family ?? computed.fontFamily.replace(/["']/g, ''),
      bold: options.bold ?? (Number(computed.fontWeight) >= 600 || computed.fontWeight === 'bold'),
      italic: options.italic ?? computed.fontStyle === 'italic',
      underline: options.underline ?? computed.textDecorationLine.includes('underline'),
      strike: options.strike ?? computed.textDecorationLine.includes('line-through'),
      color: options.color ?? (colour ? `#${colour}` : '#000000'),
      align: options.align ?? ({ start: 'left', end: 'right' }[computed.textAlign] ?? computed.textAlign)
    }
    for (const [key, value] of Object.entries(values)) {
      const field = ui.styles.elements[key]
      if (field.type === 'checkbox') field.checked = value
      else field.value = value
      state.inspector.styles[key] = field.type === 'checkbox' ? field.checked : field.value
    }
    const source = sourceObject(object)
    ui.text.value = textDrafts.get(source?.id)?.value ?? source?.content ?? ''
    refreshDraftNotice()
  }
  $('#object-stage').value = options.stage ?? 0
  ui.shape.hidden = !shape
  if (shape) for (const [key, value] of Object.entries({ rotate: options.rotate ?? 0, stroke: options.stroke ?? '#7a005f', stroke_width: options.stroke_width ?? 3, fill: options.fill ?? 'none' })) ui.shape.elements[key].value = value
  ui.crop.hidden = !figure
  if (figure) ['left', 'top', 'width', 'height'].forEach((key, index) => { ui.crop.elements[key].value = (options.crop ?? [0, 0, 100, 100])[index] })
}

function startGesture(event, resizing) {
  if (!editable() || state.nudge || multiple() || state.space || state.panning) return false
  const object = state.selected
  const options = optionsOf(object)
  const frame = frameOf(object)
  const rect = stageRect(frame)
  const shape = object.dataset.editKind === 'shape'
  state.gesture = { object, id: object.dataset.editId, dx: options.dx ?? 0, dy: options.dy ?? 0, rotate: options.rotate ?? 0, left: rect.left, top: rect.top, width: shape ? frame.offsetWidth : rect.width, height: shape ? frame.offsetHeight : rect.height, patch: null }
  state.alt = !!event.inputEvent?.altKey
  updateSnapping()
  updateHistory()
  updateControls()
  if (resizing) {
    event.set([state.gesture.width, state.gesture.height])
    event.setOrigin(shape ? ['50%', '50%'] : ['0%', '0%'])
    event.dragStart?.set([0, 0])
  } else event.set([0, 0])
}

function preview(patch, object = state.selected) {
  if (!object) return
  const options = optionsOf(object)
  if (patch.dx !== undefined || patch.dy !== undefined || patch.rotate !== undefined) {
    object.style.transform = `translate(${patch.dx ?? options.dx ?? 0}px, ${patch.dy ?? options.dy ?? 0}px)${object.dataset.editKind === 'shape' ? ` rotate(${patch.rotate ?? options.rotate ?? 0}deg)` : ''}`
  }
  if (patch.width !== undefined) {
    object.style.width = `${patch.width}px`
    object.style.maxWidth = 'none'
    if (object.dataset.editKind === 'figure' && frameOf(object) !== object) frameOf(object).style.width = '100%'
  }
  if (patch.height !== undefined && patch.height !== null) object.style.height = `${patch.height}px`
}

async function finishGesture() {
  const gesture = state.gesture
  state.gesture = null
  if (!gesture?.patch) { updateHistory(); updateControls(); return }
  if (gesture.group) await mutate('/api/batch', { edits: gesture.group.map(item => ({ id: item.id, patch: item.patch })) }, gesture.group.map(item => item.id))
  else await save(gesture.patch, gesture.id)
}

const moveable = new Moveable(ui.stage, {
  target: null, draggable: true, resizable: true, origin: false, throttleDrag: 0,
  throttleResize: 0, keepRatio: false, snappable: false, snapThreshold: 4,
  snapDirections: { left: true, right: true, top: true, bottom: true, center: true, middle: true },
  elementSnapDirections: { left: true, right: true, top: true, bottom: true, center: true, middle: true },
  isDisplaySnapDigit: false, isDisplayInnerSnapDigit: false
})
const cropEditor = createCropEditor({
  stage: ui.stage,
  getScale: () => state.scale,
  rectOf: stageRect,
  onActiveChange(active) {
    state.cropping = active
    $('#crop-session').hidden = !active
    moveable.target = active ? null : frameOf(state.selected)
    updateControls()
    updateHistory()
    if (active) {
      status('Cropping · drag image or crop handles, then Apply')
      $('#crop-session').scrollIntoView({ block: 'nearest' })
    }
  },
  async onApply({ object, crop, width, rect, imageRatio }) {
    const options = optionsOf(object)
    const frame = frameOf(object)
    // Cropping changes the aspect ratio and can move a centred flex anchor.
    // Measure that new anchor before writing offsets to keep the chosen window.
    frame.style.setProperty('--crop-ratio', String(imageRatio * crop[2] / crop[3]))
    frame.style.height = 'auto'
    preview({ width }, object)
    const image = frame.querySelector('img')
    Object.assign(image.style, { width: `${10000 / crop[2]}%`, height: `${10000 / crop[3]}%`, left: `${-100 * crop[0] / crop[2]}%`, top: `${-100 * crop[1] / crop[3]}%` })
    const current = stageRect(frame)
    await save({ crop, width, height: null, dx: round((options.dx ?? 0) + rect.left - current.left), dy: round((options.dy ?? 0) + rect.top - current.top) }, object.dataset.editId)
  },
  onCancel(message = 'Crop cancelled') {
    refreshInspector()
    moveable.updateRect()
    status(message)
  }
})

function startDirectCrop() {
  if (!canMutate() || state.selected?.dataset.editKind !== 'figure') return
  if (!cropEditor.begin(state.selected, frameOf(state.selected))) status('The image must finish loading before it can be cropped.', 'error')
}
$('#start-direct-crop').addEventListener('click', startDirectCrop)
$('#apply-direct-crop').addEventListener('click', () => cropEditor.apply())
$('#cancel-direct-crop').addEventListener('click', () => cropEditor.cancel())
moveable.on('dragStart', event => startGesture(event, false))
moveable.on('drag', event => {
  const gesture = state.gesture
  if (!gesture) return
  const [x, y] = event.beforeTranslate
  gesture.patch = { dx: round(gesture.dx + x), dy: round(gesture.dy + y) }
  preview(gesture.patch, gesture.object)
})
moveable.on('dragEnd', finishGesture)
moveable.on('resizeStart', event => startGesture(event, true))
moveable.on('resize', event => {
  const gesture = state.gesture
  if (!gesture) return
  gesture.patch = { dx: gesture.dx, dy: gesture.dy, width: round(Math.max(1, event.width)), height: gesture.object.dataset.editKind === 'figure' ? null : round(Math.max(1, event.height)) }
  if (gesture.object.dataset.editKind === 'shape') {
    gesture.patch.dx = round(gesture.dx + event.drag.beforeTranslate[0])
    gesture.patch.dy = round(gesture.dy + event.drag.beforeTranslate[1])
    preview(gesture.patch, gesture.object)
    return
  }
  // A width change can recenter the authored flex/grid anchor. Measure the new
  // anchor before deriving offsets so the handle's opposite corner stays fixed.
  preview(gesture.patch, gesture.object)
  const current = stageRect(frameOf(gesture.object))
  const left = gesture.left + (event.direction[0] < 0 ? gesture.width - current.width : 0)
  const top = gesture.top + (event.direction[1] < 0 ? gesture.height - current.height : 0)
  gesture.patch.dx = round(gesture.dx + left - current.left)
  gesture.patch.dy = round(gesture.dy + top - current.top)
  preview(gesture.patch, gesture.object)
})
moveable.on('resizeEnd', finishGesture)
moveable.on('rotateStart', event => {
  if (!editable() || state.nudge || state.selected.dataset.editKind !== 'shape') return false
  const object = state.selected
  const options = optionsOf(object)
  state.gesture = { object, id: object.dataset.editId, patch: null }
  event.set(options.rotate ?? 0)
  updateHistory()
  updateControls()
})
moveable.on('rotate', event => {
  if (!state.gesture) return
  const rotate = round(((event.beforeRotate + 180) % 360 + 360) % 360 - 180)
  state.gesture.patch = { rotate }
  preview(state.gesture.patch, state.gesture.object)
})
moveable.on('rotateEnd', finishGesture)

ui.deck.addEventListener('pointerdown', event => {
  if (state.presenting || state.space || state.panning || state.busy || state.conflict || state.cropping || state.gesture || state.nudge || event.button !== 0) return
  const object = event.target.closest('.editable-object[data-edit-id]')
  if (!object) return
  if (event.shiftKey) select(object, true)
  else if (!state.selection.includes(object)) select(object)
})
ui.deck.addEventListener('mousedown', event => {
  if (editable() && !event.shiftKey && !state.space && !state.panning && state.selection.includes(event.target.closest('.editable-object')) && !moveable.isMoveableElement(event.target)) moveable.dragStart(event)
})
ui.deck.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault() })
ui.deck.addEventListener('dblclick', event => {
  const object = event.target.closest('.editable-object[data-edit-id]')
  if (object && canMutate() && !multiple()) {
    select(object)
    if (object.dataset.editKind === 'figure') startDirectCrop()
    if (isText(object) && sourceObject(object)?.contentEditable) {
      ui.text.focus()
      ui.text.select()
      ui.text.scrollIntoView({ block: 'nearest' })
    }
  }
})

ui.geometry.addEventListener('submit', event => {
  event.preventDefault()
  if (!editable()) return
  const patch = {}
  for (const key of ['dx', 'dy', 'width', 'height']) {
    if (state.selected.dataset.editKind === 'figure' && key === 'height') continue
    const value = ui.geometry.elements[key].value
    if (value !== state.inspector.geometry[key]) patch[key] = value === '' ? null : Number(value)
  }
  if (isText(state.selected) && ui.geometry.elements.font.value !== state.inspector.font) patch.font = ui.geometry.elements.font.value === '' ? null : Number(ui.geometry.elements.font.value)
  if (state.selected.dataset.editKind === 'figure' && patch.width !== undefined) patch.height = null
  save(patch)
})
ui.styles.addEventListener('submit', event => {
  event.preventDefault()
  if (!editable()) return
  const patch = {}
  for (const key of textStyleKeys) {
    const field = ui.styles.elements[key]
    const value = field.type === 'checkbox' ? field.checked : field.value.trim()
    if (value !== state.inspector.styles[key]) patch[key] = value === '' ? null : value
  }
  if (Object.keys(patch).length) save(patch)
  else status('Text style is unchanged')
})
$('#reset-text-style').addEventListener('click', () => { if (editable()) save(Object.fromEntries(['font', ...textStyleKeys].map(key => [key, null]))) })
ui.content.addEventListener('submit', event => {
  event.preventDefault()
  if (!editable() || !sourceObject(state.selected)?.contentEditable || $('#save-content').disabled) return
  mutate('/api/content', { id: state.selected.dataset.editId, content: ui.text.value })
})
ui.text.addEventListener('input', rememberTextDraft)
$('#discard-content').addEventListener('click', () => {
  if (!editable()) return
  const source = sourceObject(state.selected)
  textDrafts.delete(source.id)
  ui.text.value = source.content
  refreshDraftNotice()
  updateControls()
})
$('#keep-content').addEventListener('click', () => {
  if (!editable()) return
  const source = sourceObject(state.selected)
  const draft = textDrafts.get(source.id)
  if (draft) draft.base = source.content
  refreshDraftNotice()
  updateControls()
})
const formats = { bold: ['**', '**'], italic: ['*', '*'], underline: ['<u>', '</u>'], strike: ['~~', '~~'], code: ['`', '`'] }
for (const button of document.querySelectorAll('[data-format]')) {
  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', () => {
    if (!editable() || ui.text.disabled) return
    const [open, close] = formats[button.dataset.format]
    const start = ui.text.selectionStart
    const end = ui.text.selectionEnd
    const selected = ui.text.value.slice(start, end)
    ui.text.setRangeText(`${open}${selected}${close}`, start, end, 'select')
    ui.text.focus()
    ui.text.setSelectionRange(start + open.length, start + open.length + selected.length)
    rememberTextDraft()
  })
}
$('#stage-form').addEventListener('submit', event => {
  event.preventDefault()
  if (editable()) save({ stage: $('#object-stage').value === '' ? null : Number($('#object-stage').value) })
})
ui.stages.addEventListener('change', () => { if (!state.busy && !state.gesture && !state.nudge) { state.stage = ui.stages.value; applyStage() } })
function stepStage(direction) {
  if (ui.stages.disabled) return
  const values = [...ui.stages.options].map(option => option.value).filter(value => value !== 'all')
  state.stage = values[Math.max(0, Math.min(values.length - 1, values.indexOf(state.stage) + direction))]
  ui.stages.value = state.stage
  applyStage()
}
ui.stagePrevious.addEventListener('click', () => stepStage(-1))
ui.stageNext.addEventListener('click', () => stepStage(1))
$('#insert-form').addEventListener('submit', event => {
  event.preventDefault()
  mutate('/api/insert', { slide: Number(currentSection()?.dataset.sourceSlide ?? state.page + 1), shape: $('#shape-type').value }, null, 'Shape inserted')
})
$('#insert-text').addEventListener('click', async () => {
  const result = await mutate('/api/insert', { slide: Number(currentSection()?.dataset.sourceSlide ?? state.page + 1), ...insertionPanel(), kind: 'box', content: 'New text' }, null, 'Text inserted · start typing')
  if (result && sourceObject(state.selected)?.contentEditable) {
    ui.text.focus()
    ui.text.select()
    ui.text.scrollIntoView({ block: 'nearest' })
  }
})
ui.shape.addEventListener('submit', event => {
  event.preventDefault()
  if (editable()) save({ rotate: Number(ui.shape.elements.rotate.value), stroke: ui.shape.elements.stroke.value, stroke_width: Number(ui.shape.elements.stroke_width.value), fill: ui.shape.elements.fill.value.trim() || 'none' })
})
async function deleteObject() {
  if (multiple()) { status('Select one object to delete it.'); return }
  if (editable() && (['shape', 'figure'].includes(state.selected.dataset.editKind) || sourceObject(state.selected)?.contentEditable)) {
    const id = state.selected.dataset.editId
    if (await mutate('/api/delete', { id }, null, 'Object deleted')) textDrafts.delete(id)
  }
}
$('#delete-shape').addEventListener('click', deleteObject)
$('#delete-text').addEventListener('click', deleteObject)
$('#delete-image').addEventListener('click', deleteObject)
ui.crop.addEventListener('submit', event => {
  event.preventDefault()
  if (editable()) save({ crop: ['left', 'top', 'width', 'height'].map(key => Number(ui.crop.elements[key].value)), height: null })
})
$('#reset-crop').addEventListener('click', () => { if (editable()) save({ crop: null, height: null }) })
$('#reset-position').addEventListener('click', () => { if (editable()) save({ dx: null, dy: null }) })
for (const button of document.querySelectorAll('[data-align]')) button.addEventListener('click', () => alignSelection(button.dataset.align))
$('#align-target').addEventListener('change', updateAlignmentControls)
$('#distribution-mode').addEventListener('change', () => {
  const mode = $('#distribution-mode').value === 'centers' ? 'centres' : 'gaps'
  for (const button of document.querySelectorAll('[data-distribute]')) {
    button.title = `Distribute ${button.dataset.distribute} ${mode}`
    button.setAttribute('aria-label', button.title)
  }
})
for (const button of document.querySelectorAll('[data-distribute]')) button.addEventListener('click', () => distributeSelection(button.dataset.distribute))
ui.previous.addEventListener('click', () => { if (!state.busy) showPage(state.page - 1) })
ui.next.addEventListener('click', () => { if (!state.busy) showPage(state.page + 1) })
ui.grid.addEventListener('change', drawGuides)
ui.snap.addEventListener('change', updateSnapping)
ui.undo.addEventListener('click', () => history('undo'))
ui.redo.addEventListener('click', () => history('redo'))
ui.reload.addEventListener('click', async () => {
  setBusy(true)
  try {
    const id = state.selected?.dataset.editId
    notesPanel.invalidate()
    await render(await request('/api/deck'), id)
    state.conflict = false
    document.body.classList.remove('conflicted')
    ui.reload.hidden = true
    status('Source reloaded')
  } catch (error) { showError(error) } finally { setBusy(false) }
})

function flushNudge() {
  if (!state.nudge) return
  const { patch, id, timer } = state.nudge
  clearTimeout(timer)
  state.nudge = null
  save(patch, id)
}

document.addEventListener('keydown', event => {
  if (state.cropping || state.presenting) return
  state.alt = event.altKey
  updateSnapping()
  if (event.target.matches('input, textarea, select') || event.target.isContentEditable || event.target.closest('dialog[open], #source-pane')) return
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    history(event.shiftKey ? 'redo' : 'undo')
    return
  }
  if (event.key.toLowerCase() === 'g' && !event.metaKey && !event.ctrlKey) {
    const modes = ['off', 'layout', 'fine']
    ui.grid.value = modes[(modes.indexOf(ui.grid.value) + 1) % modes.length]
    drawGuides()
  }
  if (event.key === 'Escape' && !state.gesture && !state.nudge) select(null)
  if (['Delete', 'Backspace'].includes(event.key) && (['shape', 'figure'].includes(state.selected?.dataset.editKind) || sourceObject(state.selected)?.contentEditable) && !state.gesture && !state.nudge) { event.preventDefault(); deleteObject(); return }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !editable() || state.gesture || multiple()) return
  event.preventDefault()
  const options = optionsOf(state.selected)
  if (!state.nudge) state.nudge = { id: state.selected.dataset.editId, patch: { dx: options.dx ?? 0, dy: options.dy ?? 0 } }
  const nudge = state.nudge
  const distance = event.shiftKey ? 10 : 1
  if (event.key === 'ArrowLeft') nudge.patch.dx -= distance
  if (event.key === 'ArrowRight') nudge.patch.dx += distance
  if (event.key === 'ArrowUp') nudge.patch.dy -= distance
  if (event.key === 'ArrowDown') nudge.patch.dy += distance
  preview(nudge.patch)
  moveable.updateRect()
  clearTimeout(nudge.timer)
  nudge.timer = setTimeout(flushNudge, 250)
  updateHistory()
  updateControls()
})
document.addEventListener('keyup', event => {
  state.alt = event.altKey
  updateSnapping()
  if (event.key.startsWith('Arrow')) flushNudge()
})
window.addEventListener('blur', () => { state.alt = false; updateSnapping(); flushNudge() })
window.addEventListener('beforeunload', event => {
  if (textDrafts.size || notesPanel.hasDrafts()) { event.preventDefault(); event.returnValue = '' }
})
new ResizeObserver(() => { fitSlide(); drawGuides(); fitThumbnails() }).observe(ui.workspace)

setInterval(async () => {
  if (!state.deck || state.presenting || state.busy || state.conflict || state.cropping || state.gesture || state.nudge) return
  const generation = state.generation
  const hash = state.deck.hash
  try {
    const current = await request('/api/status')
    if (generation !== state.generation || hash !== state.deck.hash || state.busy || state.conflict || state.cropping || state.gesture || state.nudge) return
    if (current.hash !== hash) showError(Object.assign(new Error('Source changed'), { code: 'CONFLICT' }))
  } catch { /* Keep the current slide if the server is temporarily unavailable. */ }
}, 2500)

function slideTitle(index) {
  return state.deck?.slides?.find(item => item.slide === index + 1)?.title || slides()[index]?.querySelector('h1')?.textContent || `Slide ${index + 1}`
}
function refreshNavigator() {
  $('#slide-list').replaceChildren(...slides().map((slide, index) => {
    const button = document.createElement('button')
    button.className = 'slide-item'
    button.type = 'button'
    button.dataset.slide = String(index + 1)
    button.setAttribute('role', 'option')
    button.setAttribute('aria-label', `Slide ${index + 1}: ${slideTitle(index)}`)
    const preview = document.createElement('span')
    preview.className = 'slide-thumbnail'
    preview.setAttribute('aria-hidden', 'true')
    const art = document.createElement('div')
    art.className = 'thumbnail-art'
    const container = document.createElement('div')
    container.className = 'marpit'
    const clone = slide.cloneNode(true)
    clone.classList.remove('current-slide')
    const ids = new Map()
    for (const element of clone.querySelectorAll('[id]')) { const old = element.id; element.id = `thumbnail-${index}-${old}`; ids.set(old, element.id) }
    for (const element of clone.querySelectorAll('*')) for (const attr of [...element.attributes]) {
      let value = attr.value
      if (['href', 'xlink:href'].includes(attr.name) && value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`
      value = value.replace(/url\(#([^)]+)\)/g, (whole, id) => ids.has(id) ? `url(#${ids.get(id)})` : whole)
      if (value !== attr.value) element.setAttribute(attr.name, value)
    }
    for (const object of clone.querySelectorAll('[data-edit-id]')) {
      object.removeAttribute('data-edit-id')
      object.classList.remove('editable-object', 'is-selected')
    }
    for (const object of clone.querySelectorAll('.stage-hidden')) object.classList.remove('stage-hidden')
    for (const link of clone.querySelectorAll('a')) link.setAttribute('tabindex', '-1')
    container.append(clone)
    art.append(container)
    preview.append(art)
    const caption = document.createElement('span')
    caption.className = 'slide-caption'
    const number = document.createElement('span'), title = document.createElement('span')
    number.textContent = String(index + 1)
    title.textContent = slideTitle(index)
    caption.append(number, title)
    button.append(preview, caption)
    button.addEventListener('click', () => { if (canMutate()) showPage(index) })
    return button
  }))
  fitThumbnails()
}
function fitThumbnails() {
  for (const preview of document.querySelectorAll('.slide-thumbnail')) preview.querySelector('.thumbnail-art').style.transform = `scale(${preview.clientWidth / 1280})`
}
function refreshNavigatorSelection() {
  for (const button of document.querySelectorAll('.slide-item')) button.setAttribute('aria-selected', String(Number(button.dataset.slide) === state.page + 1))
  $('#slide-title').value = slideTitle(state.page)
}
for (const button of document.querySelectorAll('[data-slide-action]')) button.addEventListener('click', async () => {
  if (!canMutate() || !await notesPanel.savePending()) return
  closeShapes()
  const result = await mutate('/api/slide', { action: button.dataset.slideAction, slide: state.page + 1 }, null, 'Slide updated')
  if (result && button.dataset.slideAction === 'delete') for (const id of textDrafts.keys()) if (!result.objects.some(object => object.id === id)) textDrafts.delete(id)
})
$('#slide-title').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); event.target.blur() }
  if (event.key === 'Escape') { event.target.value = slideTitle(state.page); event.target.blur() }
})
$('#slide-title').addEventListener('change', () => {
  if ($('#slide-title').value.trim() !== slideTitle(state.page)) mutate('/api/slide', { action: 'rename', slide: state.page + 1, title: $('#slide-title').value.trim() }, null, 'Slide renamed')
})

function closeShapes() { $('#shape-gallery').hidden = true; $('#shape-menu-toggle').setAttribute('aria-expanded', 'false') }
$('#shape-menu-toggle').addEventListener('click', () => {
  const open = $('#shape-gallery').hidden
  $('#shape-gallery').hidden = !open
  $('#shape-menu-toggle').setAttribute('aria-expanded', String(open))
  if (open) $('#shape-gallery button[data-shape]')?.focus()
})
$('#close-shapes').addEventListener('click', closeShapes)
document.addEventListener('pointerdown', event => { if (!event.target.closest('#shape-gallery, #shape-menu-toggle')) closeShapes() })
async function loadShapes() {
  try {
    const { groups } = await request('/api/shapes')
    $('#shape-type').replaceChildren()
    $('#shape-groups').replaceChildren(...groups.map(group => {
      const section = document.createElement('section'), title = document.createElement('h3'), grid = document.createElement('div')
      section.className = 'shape-group'
      title.textContent = group.name
      grid.className = 'shape-grid'
      for (const shape of group.shapes) {
        const option = document.createElement('option')
        option.value = shape.type
        option.textContent = shape.label
        $('#shape-type').append(option)
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'shape-choice'
        button.dataset.shape = shape.type
        button.title = shape.label
        button.setAttribute('aria-label', `Insert ${shape.label.toLowerCase()}`)
        button.innerHTML = shape.svg
        button.querySelector('svg')?.setAttribute('aria-hidden', 'true')
        button.addEventListener('click', async () => {
          closeShapes()
          await mutate('/api/insert', { slide: state.page + 1, shape: shape.type }, null, `${shape.label} inserted`)
        })
        grid.append(button)
      }
      section.append(title, grid)
      return section
    }))
  } catch (error) { status(`Shapes could not be loaded: ${error.message}`, 'error') }
}

// The upper bar applies box styles immediately. Selected words in the text editor
// use the same familiar controls without replacing or parsing authored math.
let editingWords = false
ui.text.addEventListener('focus', () => { editingWords = true })
document.addEventListener('focusin', event => {
  if (!event.target.closest('#content-form, #style-form')) editingWords = false
})
for (const toggle of ui.styles.querySelectorAll('.format-toggle')) toggle.addEventListener('mousedown', event => event.preventDefault())
ui.styles.addEventListener('change', event => {
  if (!editable() || multiple()) return
  const field = event.target
  if (editingWords && formats[field.name] && ui.text.selectionEnd > ui.text.selectionStart) {
    const button = document.querySelector(`[data-format="${field.name}"]`)
    button.click()
    field.checked = state.inspector.styles[field.name]
  } else ui.styles.requestSubmit()
})
ui.geometry.elements.font.addEventListener('change', () => {
  if (!editable() || multiple()) return
  const value = ui.geometry.elements.font.value
  if (value !== state.inspector.font) save({ font: value === '' ? null : Number(value) })
})
$('#toolbar-crop').addEventListener('click', startDirectCrop)
for (const id of ['#toggle-inspector', '#inspector-toggle']) $(id).addEventListener('click', () => document.body.classList.toggle('inspector-collapsed'))

function selectionBounds(items) {
  const rects = items.map(item => stageRect(frameOf(item)))
  const left = Math.min(...rects.map(rect => rect.left)), top = Math.min(...rects.map(rect => rect.top))
  return { left, top, width: Math.max(...rects.map(rect => rect.left + rect.width)) - left, height: Math.max(...rects.map(rect => rect.top + rect.height)) - top }
}
function batchPositions(edits, message = 'Selection arranged') {
  if (!canMutate() || !edits.length) return
  return mutate('/api/batch', { edits }, selectedIds(), message)
}
function alignSelection(direction) {
  if (!editable()) return
  const selected = state.selection
  let bounds
  const target = $('#align-target').value
  if (target === 'slide') bounds = { left: 0, top: 0, width: 1280, height: 720 }
  else if (target === 'selection' && multiple()) bounds = selectionBounds(selected)
  else if (target === 'panel' && commonPanel()) bounds = stageRect(commonPanel())
  else if (target === 'content') bounds = stageRect(currentSlide().querySelector('.deck-content') ?? currentSection())
  else return
  const vertical = ['top', 'middle', 'bottom'].includes(direction)
  const edits = selected.map(object => {
    const frame = stageRect(frameOf(object)), options = optionsOf(object)
    const target = direction === 'left' ? bounds.left : direction === 'center' ? bounds.left + (bounds.width - frame.width) / 2 : direction === 'right' ? bounds.left + bounds.width - frame.width : direction === 'top' ? bounds.top : direction === 'middle' ? bounds.top + (bounds.height - frame.height) / 2 : bounds.top + bounds.height - frame.height
    return { id: object.dataset.editId, patch: vertical ? { dy: round((options.dy ?? 0) + target - frame.top) } : { dx: round((options.dx ?? 0) + target - frame.left) } }
  })
  batchPositions(edits)
}
function distributeSelection(direction) {
  if (!editable() || state.selection.length < 3) return
  const vertical = direction === 'vertical', position = vertical ? 'top' : 'left', size = vertical ? 'height' : 'width', offset = vertical ? 'dy' : 'dx'
  const centers = $('#distribution-mode').value === 'centers'
  const anchor = rect => rect[position] + (centers ? rect[size] / 2 : 0)
  const items = state.selection.map(object => ({ object, rect: stageRect(frameOf(object)) })).sort((a, b) => anchor(a.rect) - anchor(b.rect))
  if (centers) {
    const first = anchor(items[0].rect), step = (anchor(items.at(-1).rect) - first) / (items.length - 1)
    const edits = items.map(({ object, rect }, index) => ({ id: object.dataset.editId, patch: { [offset]: round((optionsOf(object)[offset] ?? 0) + first + index * step - anchor(rect)) } }))
    batchPositions(edits, 'Centres evenly spaced')
    return
  }
  const first = items[0].rect[position], last = items.at(-1).rect
  const gap = (last[position] + last[size] - first - items.reduce((sum, item) => sum + item.rect[size], 0)) / (items.length - 1)
  let cursor = first
  const edits = items.map(({ object, rect }) => {
    const patch = { [offset]: round((optionsOf(object)[offset] ?? 0) + cursor - rect[position]) }
    cursor += rect[size] + gap
    return { id: object.dataset.editId, patch }
  })
  batchPositions(edits, 'Spacing distributed')
}
async function arrangeLayer(front) {
  if (!editable()) return
  const all = [...currentSlide().querySelectorAll('.editable-object')]
  const layers = all.map(object => optionsOf(object).layer ?? (isText(object) && optionsOf(object).position === 'absolute' ? 1 : 0))
  const edge = front ? Math.max(...layers) + 1 : Math.min(...layers) - 1
  if (edge < -99 || edge > 99) { status('This selection has reached the available layer limit.', 'error'); return }
  await batchPositions(state.selection.map(object => ({ id: object.dataset.editId, patch: { layer: edge } })), front ? 'Brought to front' : 'Sent to back')
}
$('#bring-front').addEventListener('click', () => arrangeLayer(true))
$('#send-back').addEventListener('click', () => arrangeLayer(false))
moveable.on('dragGroupStart', event => {
  if (!editable() || state.nudge || state.space || state.panning) return false
  state.gesture = { group: state.selection.map(object => ({ object, id: object.dataset.editId, dx: optionsOf(object).dx ?? 0, dy: optionsOf(object).dy ?? 0 })), patch: null }
  for (const item of event.events) item.set([0, 0])
  updateControls(); updateHistory()
})
moveable.on('dragGroup', event => {
  if (!state.gesture?.group) return
  for (const item of event.events) {
    const member = state.gesture.group.find(member => frameOf(member.object) === item.target)
    if (!member) continue
    member.patch = { dx: round(member.dx + item.beforeTranslate[0]), dy: round(member.dy + item.beforeTranslate[1]) }
    preview(member.patch, member.object)
  }
  state.gesture.patch = true
})
moveable.on('dragGroupEnd', finishGesture)

let marquee = null
ui.workspace.addEventListener('pointerdown', event => {
  if (state.presenting || state.cropping || state.busy || state.gesture || state.nudge) return
  if (event.button === 1 || state.space && event.button === 0) {
    event.preventDefault(); event.stopImmediatePropagation()
    state.panning = { x: event.clientX, y: event.clientY, left: ui.workspace.scrollLeft, top: ui.workspace.scrollTop, pointer: event.pointerId }
    ui.workspace.setPointerCapture(event.pointerId)
    ui.workspace.classList.add('is-panning')
    return
  }
  if (event.button !== 0 || event.target.closest('.editable-object, .moveable-control-box, .crop-layer')) return
  if (!canMutate()) return
  event.preventDefault(); event.stopImmediatePropagation()
  marquee = { x: event.clientX, y: event.clientY, pointer: event.pointerId, original: event.shiftKey ? [...state.selection] : [], moved: false }
  ui.workspace.setPointerCapture(event.pointerId)
}, true)
ui.workspace.addEventListener('pointermove', event => {
  if (state.panning?.pointer === event.pointerId) {
    ui.workspace.scrollLeft = state.panning.left - event.clientX + state.panning.x
    ui.workspace.scrollTop = state.panning.top - event.clientY + state.panning.y
    moveable.updateRect()
    return
  }
  if (marquee?.pointer !== event.pointerId) return
  const left = Math.min(marquee.x, event.clientX), top = Math.min(marquee.y, event.clientY), width = Math.abs(event.clientX - marquee.x), height = Math.abs(event.clientY - marquee.y)
  if (!marquee.moved && width + height < 5) return
  marquee.moved = true
  const box = $('#selection-marquee')
  box.hidden = false
  Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
  const objects = [...currentSlide().querySelectorAll('.editable-object')].filter(object => {
    if (object.closest('.stage-hidden')) return false
    const rect = frameOf(object).getBoundingClientRect()
    return rect.right > left && rect.left < left + width && rect.bottom > top && rect.top < top + height
  })
  setSelection([...marquee.original, ...objects])
})
function stopWorkspaceGesture(event) {
  if (state.panning?.pointer === event.pointerId) { state.panning = null; ui.workspace.classList.remove('is-panning') }
  if (marquee?.pointer === event.pointerId) {
    if (!marquee.moved) setSelection(marquee.original)
    marquee = null
    $('#selection-marquee').hidden = true
  }
  if (ui.workspace.hasPointerCapture(event.pointerId)) ui.workspace.releasePointerCapture(event.pointerId)
}
ui.workspace.addEventListener('pointerup', stopWorkspaceGesture)
ui.workspace.addEventListener('pointercancel', stopWorkspaceGesture)
ui.workspace.addEventListener('scroll', () => moveable.updateRect(), { passive: true })
function setZoom(value) {
  if (state.cropping || state.gesture || state.nudge) return
  const oldScale = state.scale
  const center = { x: (ui.workspace.scrollLeft + ui.workspace.clientWidth / 2) / oldScale, y: (ui.workspace.scrollTop + ui.workspace.clientHeight / 2) / oldScale }
  state.zoom = value === 'fit' ? 'fit' : Math.min(200, Math.max(25, Number(value)))
  fitSlide(); drawGuides()
  if (state.zoom === 'fit') { ui.workspace.scrollLeft = 0; ui.workspace.scrollTop = 0 }
  else { ui.workspace.scrollLeft = center.x * state.scale - ui.workspace.clientWidth / 2; ui.workspace.scrollTop = center.y * state.scale - ui.workspace.clientHeight / 2 }
  moveable.updateRect()
}
$('#zoom-level').addEventListener('change', event => setZoom(event.target.value))
$('#zoom-fit').addEventListener('click', () => setZoom('fit'))
$('#zoom-in').addEventListener('click', () => setZoom(Math.floor(state.scale * 4 + .001) * 25 + 25))
$('#zoom-out').addEventListener('click', () => setZoom(Math.ceil(state.scale * 4 - .001) * 25 - 25))

$('#insert-image').addEventListener('click', () => { if (canMutate()) $('#image-file').click() })
$('#image-file').addEventListener('change', async event => {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file || !canMutate()) return
  if (file.size > 10 * 1024 * 1024) { status('Choose an image smaller than 10 MB.', 'error'); return }
  const destination = { slide: state.page + 1, ...insertionPanel() }
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(new Error('The image could not be read.'))
      reader.readAsDataURL(file)
    })
    await mutate('/api/image', { ...destination, name: file.name, data }, null, 'Image inserted · double-click to crop')
  } catch (error) { showError(error) }
})

function editorPosition() { return { page: state.page, stage: state.stage, ids: selectedIds(), zoom: state.zoom, left: ui.workspace.scrollLeft, top: ui.workspace.scrollTop } }
function restorePosition(saved) {
  state.zoom = saved.zoom
  showPage(saved.page)
  state.stage = saved.stage
  refreshStages()
  setSelection(saved.ids.map(objectById).filter(Boolean))
  ui.workspace.scrollLeft = saved.left
  ui.workspace.scrollTop = saved.top
  moveable.updateRect()
}
async function savePendingDrafts() {
  if (!canMutate()) return false
  for (const [id, draft] of [...textDrafts]) {
    const source = state.deck.objects.find(object => object.id === id)
    if (!source || source.content !== draft.base) {
      if (source) { showPage(source.slide - 1); select(objectById(id)); ui.text.focus() }
      status(source ? 'Resolve this text draft with Keep my draft or Discard draft before continuing.' : 'A text draft belongs to a removed object. Undo the deletion before continuing.', 'conflict')
      return false
    }
    const result = await mutate('/api/content', { id, content: draft.value }, id, 'Text saved')
    if (!result) return false
  }
  return notesPanel.savePending()
}
let openingPresenter = false
async function openPresenter() {
  if (!canMutate() || openingPresenter) return
  // A user gesture owns exactly one popup; asynchronous saves happen afterwards.
  const popup = window.open('about:blank', '_blank')
  if (popup) popup.opener = null
  openingPresenter = true
  const position = editorPosition()
  $('#presenter-fallback').hidden = true
  try {
    if (!await savePendingDrafts()) { popup?.close(); return }
    restorePosition(position)
    setBusy(true); status('Preparing presenter…')
    const session = await request('/api/presentation', { hash: state.deck.hash, slide: position.page + 1 })
    if (popup && !popup.closed) {
      popup.location.replace(session.presenterUrl)
      status('Presenter console opened')
    } else {
      $('#presenter-fallback a').href = session.presenterUrl
      $('#presenter-fallback').hidden = false
      status('Use the presenter link to open the console')
    }
  } catch (error) { popup?.close(); showError(error) }
  finally { openingPresenter = false; setBusy(false) }
}
async function startPresentation() {
  if (!canMutate()) return
  const position = editorPosition()
  if (!await savePendingDrafts()) return
  state.presentation = position
  state.presenting = true
  closeShapes()
  select(null)
  document.body.classList.add('presenting', 'presentation-controls-visible')
  $('#presentation-controls').hidden = false
  showPage(position.page)
  state.stage = '0'; refreshStages(); fitSlide()
  refreshPresentationControls()
  ui.workspace.focus()
  revealPresentationControls()
}
function exitPresentation() {
  if (!state.presenting) return
  state.presenting = false
  document.body.classList.remove('presenting', 'presentation-controls-visible')
  $('#presentation-controls').hidden = true
  restorePosition(state.presentation)
  state.presentation = null
  status('Select an object to edit')
  updateControls()
  ui.workspace.focus()
}
function stageValues() { return [...ui.stages.options].map(option => option.value).filter(value => value !== 'all') }
function advancePresentation(direction) {
  if (!state.presenting) return
  const values = stageValues(), index = values.indexOf(state.stage)
  if (direction > 0) {
    if (index < values.length - 1) state.stage = values[index + 1]
    else if (state.page < slides().length - 1) { showPage(state.page + 1); state.stage = '0' }
  } else if (index > 0) state.stage = values[index - 1]
  else if (state.page > 0) { showPage(state.page - 1); state.stage = stageValues().at(-1) }
  ui.stages.value = state.stage
  applyStage()
  refreshPresentationControls()
}
function refreshPresentationControls() {
  $('#presentation-position').textContent = `${state.page + 1} / ${slides().length} · Reveal ${state.stage}`
  $('#presentation-previous').disabled = state.page === 0 && state.stage === '0'
  $('#presentation-next').disabled = state.page === slides().length - 1 && state.stage === stageValues().at(-1)
}
let presentationControlsTimer
function revealPresentationControls() {
  if (!state.presenting) return
  document.body.classList.add('presentation-controls-visible')
  clearTimeout(presentationControlsTimer)
  presentationControlsTimer = setTimeout(() => document.body.classList.remove('presentation-controls-visible'), 1600)
}
$('#play').addEventListener('click', startPresentation)
$('#present').addEventListener('click', openPresenter)
$('#presentation-exit').addEventListener('click', exitPresentation)
$('#presentation-previous').addEventListener('click', () => advancePresentation(-1))
$('#presentation-next').addEventListener('click', () => advancePresentation(1))
ui.workspace.addEventListener('pointermove', revealPresentationControls)
ui.workspace.addEventListener('click', event => { if (state.presenting && event.button === 0) advancePresentation(1) })
document.addEventListener('keydown', event => {
  if (state.presenting) {
    if (['Escape', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', ' ', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.key === 'Escape') exitPresentation()
      else if (event.key === 'Home') { showPage(0); state.stage = '0'; refreshStages(); refreshPresentationControls() }
      else if (event.key === 'End') { showPage(slides().length - 1); state.stage = stageValues().at(-1); refreshStages(); refreshPresentationControls() }
      else advancePresentation(['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? -1 : 1)
    }
    return
  }
  if (event.target.matches('input,textarea,select') || event.target.isContentEditable || event.target.closest('dialog[open], #source-pane')) return
  if (event.key === ' ' && !state.cropping) { event.preventDefault(); state.space = true; document.body.classList.add('space-pan') }
  if (event.key === 'Escape') closeShapes()
}, true)
document.addEventListener('keyup', event => { if (event.key === ' ') { state.space = false; document.body.classList.remove('space-pan') } })
window.addEventListener('blur', () => { state.space = false; document.body.classList.remove('space-pan') })
$('#export-pdf').addEventListener('click', async () => {
  if (!canMutate()) return
  const position = editorPosition()
  if (!await savePendingDrafts()) return
  restorePosition(position)
  setBusy(true)
  status('Preparing PDF…')
  try {
    const response = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Token': token }, body: JSON.stringify({ hash: state.deck.hash }) })
    if (!response.ok) { const data = await response.json(); throw Object.assign(new Error(data.error ?? 'PDF export failed.'), { code: data.code, status: response.status }) }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'presentation.pdf'
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    status('PDF downloaded')
  } catch (error) { showError(error) } finally { setBusy(false) }
})

const sourcePane = createSourcePane({ getDeck: () => state.deck, getSelection: selectedIds, navigate: (slide, id) => { if (canMutate()) { showPage(slide - 1); if (id) select(objectById(id)) } } })
const themePanel = createThemePanel({ getDeck: () => state.deck, canMutate, mutate, report: status })
const notesPanel = createNotesPanel({ getDeck: () => state.deck, getPage: () => state.page, canMutate, mutate, navigate: showPage, report: status })

await loadShapes()

try {
  await render(await request('/api/deck'))
  if (!state.invalid) status('Select an object to edit')
} catch (error) { showError(error) }
