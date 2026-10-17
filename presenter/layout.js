// Console preferences are separate from presentation state and contain no deck
// content. Keeping them here also keeps audience windows out of this UI setup.
const storageKey = 'marpres:presenter-layout:v1'
const defaults = { sidebarWidth: 400, notesVisible: true, nextVisible: true, notesSize: 20 }
const minimumSidebar = 280, maximumSidebar = 680, minimumSlide = 380
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function loadPreferences() {
  const preferences = { ...defaults }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey))
    if (Number.isFinite(saved?.sidebarWidth)) preferences.sidebarWidth = clamp(saved.sidebarWidth, minimumSidebar, maximumSidebar)
    if (Number.isFinite(saved?.notesSize)) preferences.notesSize = clamp(saved.notesSize, 14, 32)
    for (const name of ['notesVisible', 'nextVisible']) if (typeof saved?.[name] === 'boolean') preferences[name] = saved[name]
  } catch {}
  return preferences
}

export function setupPresenterLayout() {
  const $ = selector => document.querySelector(selector)
  const workspace = $('.console-workspace'), sidebar = $('#presenter-sidebar'), separator = $('#sidebar-resizer')
  const stacked = matchMedia('(max-width: 850px)')
  let preferences = loadPreferences(), drag = null

  function limits() {
    const style = getComputedStyle(workspace)
    const available = workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      - 2 * parseFloat(style.columnGap) - separator.getBoundingClientRect().width - minimumSlide
    return { min: minimumSidebar, max: Math.max(minimumSidebar, Math.min(maximumSidebar, Math.floor(available))) }
  }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)) } catch {}
  }
  function render() {
    const { min, max } = limits()
    const width = clamp(preferences.sidebarWidth, min, max)
    workspace.style.setProperty('--sidebar-width', `${width}px`)
    separator.setAttribute('aria-valuemin', String(min))
    separator.setAttribute('aria-valuemax', String(max))
    separator.setAttribute('aria-valuenow', String(width))
    separator.setAttribute('aria-valuetext', `${width} pixels`)
    separator.tabIndex = stacked.matches ? -1 : 0
    $('#notes-card').hidden = !preferences.notesVisible
    $('#next-card').hidden = !preferences.nextVisible
    sidebar.classList.toggle('notes-hidden', !preferences.notesVisible)
    sidebar.classList.toggle('next-hidden', !preferences.nextVisible)
    $('#layout-notes').setAttribute('aria-pressed', String(preferences.notesVisible))
    $('#layout-next').setAttribute('aria-pressed', String(preferences.nextVisible))
    $('#notes').style.setProperty('--notes-size', `${preferences.notesSize}px`)
    $('#notes-smaller').disabled = preferences.notesSize <= 14
    $('#notes-larger').disabled = preferences.notesSize >= 32
  }
  function change(name, value) {
    preferences[name] = value
    render(); save()
  }
  function toggle(name, card, restoreButton) {
    const hidingFocusedCard = preferences[name] && $(card).contains(document.activeElement)
    change(name, !preferences[name])
    if (hidingFocusedCard) $(restoreButton).focus()
  }
  for (const button of ['#notes-toggle', '#layout-notes']) $(button).addEventListener('click', () => toggle('notesVisible', '#notes-card', '#layout-notes'))
  for (const button of ['#next-toggle', '#layout-next']) $(button).addEventListener('click', () => toggle('nextVisible', '#next-card', '#layout-next'))
  for (const [button, delta] of [['#notes-smaller', -1], ['#notes-larger', 1]]) {
    $(button).addEventListener('click', () => change('notesSize', clamp(preferences.notesSize + delta, 14, 32)))
  }
  $('#layout-reset').addEventListener('click', () => {
    preferences = { ...defaults }; render()
    try { localStorage.removeItem(storageKey) } catch {}
  })

  separator.addEventListener('pointerdown', event => {
    if (stacked.matches || event.button !== 0) return
    event.preventDefault(); separator.focus()
    drag = { pointer: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width }
    separator.setPointerCapture(event.pointerId)
    workspace.classList.add('resizing')
  })
  separator.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return
    const { min, max } = limits()
    preferences.sidebarWidth = Math.round(clamp(drag.width + drag.x - event.clientX, min, max))
    render()
  })
  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointer) return
    drag = null; workspace.classList.remove('resizing'); save()
    if (separator.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId)
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) separator.addEventListener(event, finishDrag)
  separator.addEventListener('keydown', event => {
    if (stacked.matches || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const { min, max } = limits(), width = sidebar.getBoundingClientRect().width
    const step = event.shiftKey ? 40 : 20
    const value = event.key === 'Home' ? min : event.key === 'End' ? max : width + (event.key === 'ArrowLeft' ? step : -step)
    change('sidebarWidth', Math.round(clamp(value, min, max)))
  })
  new ResizeObserver(render).observe(workspace)
  stacked.addEventListener('change', render)
  render()
}
