// A crop session keeps its image scale fixed while the window or image moves.
// All coordinates are slide pixels; the caller owns the single source mutation.
export function createCropEditor({ stage, getScale, rectOf, onActiveChange, onApply, onCancel }) {
  let session = null
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
  const rounded = value => Math.round(value * 10000) / 10000
  const directions = { nw: [-1, -1], n: [0, -1], ne: [1, -1], w: [-1, 0], e: [1, 0], sw: [-1, 1], s: [0, 1], se: [1, 1] }

  function draw() {
    if (!session) return
    const { window, image, ghost, viewport, visibleImage, handles } = session
    Object.assign(ghost.style, { left: `${image.left}px`, top: `${image.top}px`, width: `${image.width}px`, height: `${image.height}px` })
    Object.assign(viewport.style, { left: `${window.left}px`, top: `${window.top}px`, width: `${window.width}px`, height: `${window.height}px` })
    Object.assign(visibleImage.style, { left: `${image.left - window.left}px`, top: `${image.top - window.top}px`, width: `${image.width}px`, height: `${image.height}px` })
    for (const [direction, handle] of handles) {
      const [x, y] = directions[direction]
      Object.assign(handle.style, { left: `${window.left + window.width * (x + 1) / 2}px`, top: `${window.top + window.height * (y + 1) / 2}px`, '--crop-handle-size': `${10 / getScale()}px` })
    }
  }

  function close() {
    if (!session) return null
    const current = session
    session = null
    current.frame.style.visibility = current.visibility
    current.layer.remove()
    document.body.classList.remove('cropping')
    onActiveChange(false)
    return current
  }

  function cancel() {
    if (close()) onCancel?.()
  }

  async function apply() {
    if (!session || session.drag) return
    const current = close()
    const { window, image, object } = current
    const left = rounded(clamp((window.left - image.left) / image.width * 100, 0, 100))
    const top = rounded(clamp((window.top - image.top) / image.height * 100, 0, 100))
    const width = Math.min(rounded(window.width / image.width * 100), rounded(100 - left))
    const height = Math.min(rounded(window.height / image.height * 100), rounded(100 - top))
    const crop = [left, top, width, height]
    const changed = crop.some((value, index) => Math.abs(value - current.crop[index]) > .0001) || Math.abs(window.width - current.initialWindow.width) > .0001
    if (!changed) { onCancel?.('Crop is unchanged'); return }
    await onApply({ object, crop, width: rounded(window.width), rect: { ...window }, imageRatio: image.width / image.height })
  }

  function begin(object, frame = object) {
    if (session) return false
    const imageElement = frame.querySelector('img')
    if (!imageElement?.naturalWidth || !imageElement.naturalHeight) return false
    const crop = JSON.parse(object.dataset.editOptions ?? '{}').crop ?? [0, 0, 100, 100]
    const bounds = rectOf(frame)
    const width = bounds.width * 100 / crop[2]
    const height = width * imageElement.naturalHeight / imageElement.naturalWidth
    const fullImage = { left: bounds.left - width * crop[0] / 100, top: bounds.top - height * crop[1] / 100, width, height }
    const layer = document.createElement('div')
    layer.className = 'crop-layer'
    layer.setAttribute('aria-label', 'Image crop editor')
    const ghost = document.createElement('img')
    ghost.className = 'crop-ghost crop-image'
    ghost.src = imageElement.currentSrc || imageElement.src
    ghost.alt = ''
    ghost.draggable = false
    const viewport = document.createElement('div')
    viewport.className = 'crop-window'
    viewport.setAttribute('aria-label', 'Drag image inside crop window')
    const visibleImage = ghost.cloneNode()
    visibleImage.className = 'crop-visible-image crop-image'
    viewport.append(visibleImage)
    layer.append(ghost, viewport)
    const handles = Object.entries(directions).map(([direction]) => {
      const handle = document.createElement('div')
      handle.className = `crop-handle crop-handle-${direction}`
      handle.dataset.cropHandle = direction
      handle.setAttribute('aria-label', `Resize crop ${direction}`)
      layer.append(handle)
      return [direction, handle]
    })
    session = { object, frame, crop, layer, ghost, viewport, visibleImage, handles, window: { ...bounds }, initialWindow: { ...bounds }, image: fullImage, visibility: frame.style.visibility, drag: null }
    frame.style.visibility = 'hidden'
    stage.append(layer)
    document.body.classList.add('cropping')
    draw()
    onActiveChange(true)
    layer.addEventListener('pointerdown', event => {
      if (event.button !== 0 || session?.drag) return
      const handle = event.target.closest('[data-crop-handle]')
      if (!handle && !event.target.closest('.crop-window')) return
      event.preventDefault()
      event.stopPropagation()
      session.drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, direction: handle?.dataset.cropHandle, window: { ...session.window }, image: { ...session.image } }
      layer.setPointerCapture(event.pointerId)
      layer.classList.add('crop-dragging')
    })
    layer.addEventListener('pointermove', event => {
      const drag = session?.drag
      if (!drag || event.pointerId !== drag.pointer) return
      const dx = (event.clientX - drag.x) / getScale()
      const dy = (event.clientY - drag.y) / getScale()
      if (!drag.direction) {
        session.image.left = clamp(drag.image.left + dx, drag.window.left + drag.window.width - drag.image.width, drag.window.left)
        session.image.top = clamp(drag.image.top + dy, drag.window.top + drag.window.height - drag.image.height, drag.window.top)
      } else {
        const [x, y] = directions[drag.direction]
        let { left, top } = drag.window
        let right = left + drag.window.width
        let bottom = top + drag.window.height
        if (x < 0) left = clamp(left + dx, drag.image.left, right - 1)
        if (x > 0) right = clamp(right + dx, left + 1, drag.image.left + drag.image.width)
        if (y < 0) top = clamp(top + dy, drag.image.top, bottom - 1)
        if (y > 0) bottom = clamp(bottom + dy, top + 1, drag.image.top + drag.image.height)
        session.window = { left, top, width: right - left, height: bottom - top }
      }
      draw()
    })
    const stopDrag = event => {
      if (event.pointerId !== session?.drag?.pointer) return
      session.drag = null
      layer.classList.remove('crop-dragging')
      if (layer.hasPointerCapture(event.pointerId)) layer.releasePointerCapture(event.pointerId)
    }
    layer.addEventListener('pointerup', stopDrag)
    layer.addEventListener('pointercancel', stopDrag)
    return true
  }

  document.addEventListener('keydown', event => {
    if (!session) return
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') cancel()
      else apply()
    }
  }, true)
  return { begin, cancel, apply, refresh: draw, get active() { return !!session } }
}
