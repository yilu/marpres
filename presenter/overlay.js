import { boundPoint, SLIDE_WIDTH, SLIDE_HEIGHT } from './geometry.mjs'

const SVG_NS = 'http://www.w3.org/2000/svg'
const TOOLS = new Set(['arrow', 'hand', 'laser', 'spotlight', 'pen', 'highlighter', 'eraser'])
const INK_TOOLS = new Set(['pen', 'highlighter'])
const MAX_STROKE_POINTS = 4096
let sequence = 0

/** An SVG interaction layer in slide coordinates. The host supplies the 16:9 layout. */
export function createOverlay({ host, onAction = () => {} }) {
  if (!host?.ownerDocument) throw new TypeError('createOverlay requires a DOM host')
  const doc = host.ownerDocument
  const uid = `presenter-overlay-${++sequence}`
  const svgElement = (tag, attrs = {}) => {
    const element = doc.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
    return element
  }
  const svg = svgElement('svg', {
    'data-presenter-overlay': '', viewBox: `0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`,
    preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false',
  })
  // All overlay styles are scoped here so it can be mounted in either window.
  Object.assign(svg.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
    overflow: 'hidden', touchAction: 'none', userSelect: 'none', cursor: 'none', zIndex: '10',
  })
  const defs = svgElement('defs')
  const mask = svgElement('mask', { id: `${uid}-spotlight`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT })
  mask.append(svgElement('rect', { width: SLIDE_WIDTH, height: SLIDE_HEIGHT, fill: 'white' }))
  const hole = svgElement('circle', { r: 104, fill: 'black' })
  mask.append(hole)
  defs.append(mask)
  const inkLayer = svgElement('g', { 'data-layer': 'strokes', 'pointer-events': 'none' })
  const drawingLayer = svgElement('g', { 'data-layer': 'drawing', 'pointer-events': 'none' })
  const shade = svgElement('rect', { 'data-layer': 'spotlight', width: SLIDE_WIDTH, height: SLIDE_HEIGHT, fill: '#050911', 'fill-opacity': '.64', mask: `url(#${uid}-spotlight)`, 'pointer-events': 'none', visibility: 'hidden' })
  const pointerLayer = svgElement('g', { 'data-layer': 'pointer', 'pointer-events': 'none' })
  svg.append(defs, inkLayer, drawingLayer, shade, pointerLayer)
  host.append(svg)

  let state = { tool: 'arrow', color: '#ef4444', width: 4, pointer: null, strokes: [], drawing: null, blank: false, context: null }
  let gesture = null
  let destroyed = false
  let drawingPath = null
  let renderedStrokes = null
  let renderedPointerTool = null
  const strokeNodes = new Map()
  const listeners = []
  const listen = (type, handler) => { svg.addEventListener(type, handler); listeners.push([type, handler]) }
  const emit = action => { if (!destroyed) onAction(action) }
  const colorValue = color => typeof color === 'string' && color.length <= 80 && doc.defaultView.CSS.supports('color', color) ? color : '#ef4444'
  const widthValue = width => Number.isFinite(width) ? Math.max(.5, Math.min(80, width)) : 4
  const pathData = points => {
    if (!Array.isArray(points)) return ''
    const bounded = points.map(p => boundPoint({ x: p?.[0], y: p?.[1] })).filter(Boolean)
    if (!bounded.length) return ''
    const first = bounded[0]
    // A tiny segment gives a tap the same round cap as an ordinary stroke.
    return `M${first.x} ${first.y}` + (bounded.length === 1 ? `l.001 0` : bounded.slice(1).map(p => `L${p.x} ${p.y}`).join(''))
  }
  const paintStroke = (path, stroke) => {
    const attrs = {
      d: pathData(stroke.points), fill: 'none', stroke: colorValue(stroke.color),
      'stroke-width': widthValue(stroke.width), 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-opacity': stroke.tool === 'highlighter' ? '0.3' : '1', 'data-stroke-id': String(stroke.id ?? ''),
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (path.getAttribute(key) !== String(value)) path.setAttribute(key, String(value))
    }
  }
  function renderStrokes() {
    if (renderedStrokes === state.strokes) return
    renderedStrokes = state.strokes
    const keep = new Set()
    state.strokes.forEach((stroke, index) => {
      if (!stroke || !INK_TOOLS.has(stroke.tool)) return
      const key = `${stroke.id ?? index}:${index}`
      keep.add(key)
      let path = strokeNodes.get(key)
      if (!path) { path = svgElement('path'); strokeNodes.set(key, path) }
      paintStroke(path, stroke)
      inkLayer.append(path)
    })
    for (const [key, path] of strokeNodes) {
      if (!keep.has(key)) { path.remove(); strokeNodes.delete(key) }
    }
  }
  function renderDrawing() {
    const stroke = gesture?.stroke || state.drawing
    if (stroke && INK_TOOLS.has(stroke.tool)) {
      if (!drawingPath) { drawingPath = svgElement('path'); drawingLayer.append(drawingPath) }
      paintStroke(drawingPath, stroke)
    } else if (drawingPath) { drawingPath.remove(); drawingPath = null }
  }
  function renderPointer() {
    const point = state.pointer
    const visible = Boolean(point) && !state.blank
    pointerLayer.setAttribute('visibility', visible ? 'visible' : 'hidden')
    shade.setAttribute('visibility', visible && state.tool === 'spotlight' ? 'visible' : 'hidden')
    if (point) {
      pointerLayer.setAttribute('transform', `translate(${point.x} ${point.y})`)
      hole.setAttribute('cx', point.x); hole.setAttribute('cy', point.y)
    }
    const pointerKey = `${state.tool}:${state.color}:${state.width}`
    if (renderedPointerTool === pointerKey) return
    renderedPointerTool = pointerKey
    pointerLayer.replaceChildren()
    pointerLayer.setAttribute('data-tool', state.tool)
    const circle = attrs => pointerLayer.append(svgElement('circle', attrs))
    if (state.tool === 'arrow') {
      pointerLayer.append(svgElement('path', { d: 'M1 1L1 31L9 24L15 38L21 35L15 22L26 22Z', fill: '#fff', stroke: '#172033', 'stroke-width': 2, 'stroke-linejoin': 'round' }))
    } else if (state.tool === 'hand') {
      pointerLayer.append(svgElement('path', { d: 'M10 20V3C10-1 16-1 16 3V16V7C16 3 22 3 22 7V18V10C22 6 28 6 28 10V21V15C28 11 34 12 34 16V28C34 39 29 44 21 44H17C12 44 8 41 5 35L-1 24C-3 20 1 17 4 20L10 26Z', transform: 'translate(-14 -4)', fill: '#fff', stroke: '#172033', 'stroke-width': 1.8, 'stroke-linejoin': 'round' }))
    } else if (state.tool === 'laser') {
      circle({ r: 22, fill: state.color, 'fill-opacity': '.08' })
      circle({ r: 14, fill: state.color, 'fill-opacity': '.18' })
      circle({ r: 6, fill: state.color, stroke: '#fff', 'stroke-width': 1.5 })
      circle({ r: 2, fill: '#fff', 'fill-opacity': '.9' })
    } else if (state.tool === 'spotlight') {
      circle({ r: 104, fill: 'none', stroke: '#fff', 'stroke-opacity': '.25', 'stroke-width': 1.5 })
    } else {
      circle({ r: state.tool === 'eraser' ? 18 : Math.max(3, state.width / 2), fill: state.tool === 'eraser' ? '#fff' : state.color, 'fill-opacity': '.14', stroke: state.tool === 'eraser' ? '#475569' : state.color, 'stroke-width': 1.5 })
    }
  }
  function render() {
    svg.style.opacity = state.blank ? '0' : '1'
    renderStrokes(); renderDrawing(); renderPointer()
  }
  function eventPoint(event) {
    const rect = svg.getBoundingClientRect()
    if (!(rect.width > 0) || !(rect.height > 0)) return null
    return boundPoint({ x: (event.clientX - rect.left) * SLIDE_WIDTH / rect.width, y: (event.clientY - rect.top) * SLIDE_HEIGHT / rect.height })
  }
  function publishPointer(point) {
    state.pointer = point
    renderPointer()
    emit({ type: 'pointer', point })
  }
  function release(pointerId) {
    try { if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId) } catch { /* Already released by the browser. */ }
  }
  function cancelGesture({ clearPointer = false, notify = true } = {}) {
    const old = gesture
    gesture = null
    if (old) release(old.pointerId)
    if (old?.stroke) {
      state.drawing = null
      renderDrawing()
      if (notify) emit({ type: 'drawing', stroke: null })
    }
    if (clearPointer) publishPointer(null)
  }
  function publishDrawing() {
    if (!gesture?.stroke) return
    // Send a separate value: a later drag must not mutate the controller's state.
    const stroke = { ...gesture.stroke, points: gesture.stroke.points.map(point => [...point]) }
    renderDrawing()
    emit({ type: 'drawing', stroke })
  }
  function appendPoint(point) {
    if (!gesture?.stroke) return
    const points = gesture.stroke.points
    const last = points.at(-1)
    if (last[0] === point.x && last[1] === point.y) return
    points.push([point.x, point.y])
    if (points.length > MAX_STROKE_POINTS) {
      // Keep the first and newest endpoint while freeing room for the gesture
      // to continue within the controller's live and committed stroke limit.
      gesture.stroke.points = points.filter((_, index) => index % 2 === 0 || index === points.length - 1)
    }
  }
  listen('pointerdown', event => {
    if (state.blank || gesture || event.button !== 0 || event.isPrimary === false) return
    const point = eventPoint(event)
    if (!point) return
    event.preventDefault()
    gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, tool: state.tool }
    if (INK_TOOLS.has(state.tool)) gesture.stroke = { id: `${uid}-${Date.now().toString(36)}-${++sequence}`, tool: state.tool, color: state.color, width: state.width, points: [[point.x, point.y]] }
    try { svg.setPointerCapture(event.pointerId) } catch { /* Synthetic events have no active pointer. */ }
    publishPointer(point)
    if (gesture?.stroke) publishDrawing()
    else if (gesture?.tool === 'eraser') emit({ type: 'erase', point, radius: 18 })
  })
  listen('pointermove', event => {
    if (state.blank || event.isPrimary === false || (gesture && gesture.pointerId !== event.pointerId)) return
    const point = eventPoint(event)
    if (!point) return
    publishPointer(point)
    if (!gesture) return
    event.preventDefault()
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 4) gesture.moved = true
    if (gesture.stroke) {
      for (const sample of event.getCoalescedEvents?.() || []) {
        const sampled = eventPoint(sample)
        if (sampled) appendPoint(sampled)
      }
      appendPoint(point); publishDrawing()
    } else if (gesture.tool === 'eraser') emit({ type: 'erase', point, radius: 18 })
  })
  listen('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    event.preventDefault()
    const point = eventPoint(event)
    if (point) appendPoint(point)
    const completed = gesture
    gesture = null
    release(event.pointerId)
    if (completed.stroke) {
      state.drawing = null
      renderDrawing()
      emit({ type: 'stroke', stroke: completed.stroke })
      emit({ type: 'drawing', stroke: null })
    } else if (!completed.moved && completed.tool !== 'eraser' && !state.blank) emit({ type: 'advance' })
    const rect = svg.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) publishPointer(null)
  })
  listen('pointerleave', () => { if (!gesture && !state.blank) publishPointer(null) })
  listen('pointercancel', event => { if (gesture?.pointerId === event.pointerId) cancelGesture({ clearPointer: true }) })
  listen('lostpointercapture', event => { if (gesture?.pointerId === event.pointerId) cancelGesture({ clearPointer: true }) })

  function update(patch = {}) {
    if (destroyed) return
    const tool = TOOLS.has(patch.tool) ? patch.tool : state.tool
    const blank = 'blank' in patch ? Boolean(patch.blank) : state.blank
    // Controller generations identify slide/board transitions before an
    // audience-local gesture has received its first asynchronous drawing echo.
    const context = Number.isFinite(patch.context) ? patch.context : state.context
    const contextChanged = context !== state.context
    // An echoed local drawing followed by null marks navigation/clear. Routine
    // state updates, including a not-yet-echoed drawing, never interrupt a drag.
    const clearedDrawing = gesture?.stroke && state.drawing?.id === gesture.stroke.id && 'drawing' in patch && !patch.drawing
    const modeChanged = tool !== state.tool
    const cancel = contextChanged || modeChanged || blank || clearedDrawing
    state = {
      ...state, tool, blank, context,
      ...('color' in patch ? { color: colorValue(patch.color) } : {}),
      ...('width' in patch ? { width: widthValue(patch.width) } : {}),
      ...('pointer' in patch ? { pointer: boundPoint(patch.pointer) } : {}),
      ...('strokes' in patch ? { strokes: Array.isArray(patch.strokes) ? patch.strokes : [] } : {}),
      drawing: blank ? null : 'drawing' in patch ? patch.drawing : modeChanged || contextChanged ? null : state.drawing,
    }
    if (cancel) cancelGesture()
    render()
  }
  function destroy() {
    if (destroyed) return
    cancelGesture({ notify: false })
    destroyed = true
    for (const [type, handler] of listeners) svg.removeEventListener(type, handler)
    svg.remove()
    strokeNodes.clear()
  }
  render()
  return { update, destroy }
}
