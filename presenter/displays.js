// Display operations are UI state, separate from the presentation reducer.
// Only the console's own public audience popup receives these messages.
const messageType = 'marpres-display'
const origin = location.origin
const $ = selector => document.querySelector(selector)
const bounds = () => ({ left: screenX, top: screenY, width: outerWidth, height: outerHeight })
const screenKey = screen => screen && `${screen.left},${screen.top},${screen.width},${screen.height}`
const validBounds = value => value && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) < 1e7) && value.width > 0 && value.height > 0
function containingScreen(details, rect) {
  if (!details || !validBounds(rect)) return null
  let best = null, area = 0
  for (const screen of details.screens) {
    const overlap = Math.max(0, Math.min(rect.left + rect.width, screen.left + screen.width) - Math.max(rect.left, screen.left))
      * Math.max(0, Math.min(rect.top + rect.height, screen.top + screen.height) - Math.max(rect.top, screen.top))
    if (overlap > area) { best = screen; area = overlap }
  }
  return best
}
function screenBounds(screen) {
  return { left: screen.left, top: screen.top, width: screen.width, height: screen.height }
}
function windowFeatures(screen) {
  if (!screen) return 'popup,width=1280,height=720'
  return `popup,left=${Math.round(screen.availLeft)},top=${Math.round(screen.availTop)},width=${Math.round(screen.availWidth)},height=${Math.round(screen.availHeight)}`
}
function placeWindow(target, screen, consoleWindow = false) {
  const width = Math.min(screen.availWidth, consoleWindow ? 1440 : screen.availWidth)
  const height = Math.min(screen.availHeight, consoleWindow ? 960 : screen.availHeight)
  target.moveTo(Math.round(screen.availLeft + (screen.availWidth - width) / 2), Math.round(screen.availTop + (screen.availHeight - height) / 2))
  target.resizeTo(Math.round(width), Math.round(height))
}
function displayOperation(promise, controller) {
  const signal = controller.signal
  return new Promise((resolve, reject) => {
    const finish = callback => value => { clearTimeout(timer); signal.removeEventListener('abort', abort); callback(value) }
    const abort = () => finish(reject)(new Error('Display operation cancelled'))
    const timer = setTimeout(() => controller.abort(), 3000)
    promise.then(finish(resolve), finish(reject))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

export function setupConsoleDisplays({ id, slideHost, onResize }) {
  const start = $('#start-presenting'), swap = $('#swap-displays'), detect = $('#detect-displays'), manual = $('#open-audience'), output = $('#display-status')
  const listeners = new AbortController(), signal = listeners.signal
  let details, permission, popup, audienceState, blockedURL, notice = '', disposed = false, busy = false, generation = 0, pending, timeout
  const alive = () => popup && !popup.closed
  const current = () => containingScreen(details, bounds()) || details?.currentScreen
  const audienceScreen = () => containingScreen(details, audienceState?.bounds)
  function otherScreen() {
    const here = current()
    const others = details?.screens.filter(screen => screenKey(screen) !== screenKey(here)) || []
    return others.find(screen => !screen.isInternal) || others[0]
  }
  function render() {
    if (disposed) return
    if (popup?.closed) { popup = null; audienceState = null; cancel(); notice = 'Audience window closed. Start to reopen it.' }
    const count = details?.screens.length ?? (window.screen.isExtended === false ? 1 : undefined)
    const description = count ? `${count} display${count === 1 ? '' : 's'}${count === 1 ? ' · single screen' : ''}` : 'Manual display control'
    output.textContent = `${description}${notice ? ' · ' + notice : ''}`
    if (blockedURL) {
      const link = document.createElement('a'); link.href = blockedURL; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open audience manually'
      output.append(' ', link)
    }
    const needsPlacement = otherScreen() && screenKey(audienceScreen()) === screenKey(current())
    start.textContent = alive() && audienceState && !needsPlacement ? audienceState.fullscreen ? 'Show audience' : 'Enter audience fullscreen' : 'Start presenting'
    start.disabled = busy
    manual.disabled = busy
    detect.disabled = busy
    swap.disabled = busy || !alive() || !audienceState || !(count > 1) || !audienceScreen() || screenKey(current()) === screenKey(audienceScreen())
    swap.title = swap.disabled ? 'Start the audience on a separate display and allow display access to swap.' : 'Exchange the console and audience displays without changing the slide.'
  }
  function cancel() {
    generation++; pending = null; busy = false; clearTimeout(timeout)
  }
  function attachDetails(next) {
    if (details === next) return
    details = next
    details.addEventListener('screenschange', () => {
      cancel(); notice = 'Display configuration changed. Choose Start or arrange windows manually.'; render()
    }, { signal })
    details.addEventListener('currentscreenchange', render, { signal })
  }
  async function discover(prompt = false) {
    if (!window.getScreenDetails) { notice = 'Screen detection unavailable. Use this screen or the audience window.'; return }
    try {
      if (!permission) {
        permission = await navigator.permissions.query({ name: 'window-management' })
        if (disposed) return
        permission.addEventListener('change', () => {
          const wasWaiting = busy
          cancel(); details = null; notice = 'Display permission changed.'
          void discover(false).then(() => {
            if (wasWaiting && permission.state === 'granted') notice = 'Displays checked. Click Start presenting to continue.'
            render()
          })
        }, { signal })
      }
      if (permission.state === 'denied') { details = null; notice = 'Display access denied. Manual audience placement is available.'; return }
      if (!prompt && permission.state !== 'granted') {
        notice = window.screen.isExtended === false ? 'Start shows the slide fullscreen. Escape returns to the console.' : 'Start or Detect displays to allow automatic placement.'
        return
      }
      const found = await window.getScreenDetails()
      if (disposed || permission.state !== 'granted') return
      attachDetails(found); notice = ''
    } catch {
      details = null; notice = 'Display access unavailable. Manual audience placement is available.'
    }
  }
  function isAudience(source) {
    try {
      return source && !source.closed && source.opener === window && source.location.origin === origin
        && source.location.pathname === '/audience' && new URLSearchParams(source.location.search).get('session') === id
    } catch { return false }
  }
  function openAudience(automatic = false) {
    if (disposed) return
    if (alive()) { popup.focus(); render(); return }
    const url = `/audience?session=${encodeURIComponent(id)}${automatic ? '&fullscreen=1' : ''}`
    blockedURL = null
    popup = window.open(url, `marpres-audience-${id}`, windowFeatures(otherScreen()))
    audienceState = null
    if (!popup) {
      blockedURL = url; notice = 'Audience popup blocked. Allow popups, then click Audience window.'; render()
    } else {
      popup.focus(); notice = 'Audience window opening…'; render()
    }
  }
  function requestAudienceFullscreen(target, swapTo = null) {
    if (!alive() || !audienceState) { notice = 'Open the audience window and wait for it to load.'; render(); return }
    cancel()
    const request = crypto.randomUUID()
    pending = { request, generation, swapTo, target }
    busy = true; notice = swapTo ? 'Swapping displays…' : 'Requesting audience fullscreen…'; render()
    const message = { type: messageType, session: id, kind: 'fullscreen', request, screen: target ? screenBounds(target) : null }
    try {
      popup.postMessage(message, { targetOrigin: origin, delegate: 'fullscreen' })
    } catch {
      cancel(); notice = 'Click Enter fullscreen in the audience window; this browser could not delegate fullscreen.'; render(); return
    }
    timeout = setTimeout(() => {
      if (pending?.request !== request) return
      cancel(); notice = 'Fullscreen was not confirmed. Use Enter fullscreen in the audience window.'; render()
    }, 6000)
  }
  async function singleScreen() {
    if (disposed) return
    const turn = generation
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await slideHost.requestFullscreen()
      if ((disposed || turn !== generation) && document.fullscreenElement === slideHost) await document.exitFullscreen()
    } catch { notice = 'Click Start again, or use the browser’s fullscreen command.'; render() }
  }
  async function startPresentation() {
    if (busy || disposed) return
    if (alive() && audienceState) {
      const alternative = otherScreen()
      if (alternative && screenKey(audienceScreen()) === screenKey(current())) {
        requestAudienceFullscreen(alternative); return
      }
      if (audienceState.fullscreen) { popup.focus(); return }
      requestAudienceFullscreen(audienceScreen()); return
    }
    // A known single screen needs no permission prompt or delayed activation.
    if (details?.screens.length === 1 || window.screen.isExtended === false || permission?.state === 'denied' || !window.getScreenDetails) { await singleScreen(); return }
    busy = true; const turn = generation; render()
    await discover(true)
    if (disposed || turn !== generation) {
      busy = false
      if (!disposed && details) notice = 'Displays checked. Click Start presenting to continue.'
      render(); return
    }
    busy = false
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      notice = 'Displays checked. Click Start presenting to continue.'; render(); return
    }
    if ((details?.screens.length || 1) > 1) openAudience(true)
    else { render(); await singleScreen() }
  }
  async function receive(event) {
    const data = event.data
    if (disposed || event.origin !== origin || data?.type !== messageType || data.session !== id || !isAudience(event.source)) return
    if (alive() && event.source !== popup) return
    if (data.kind !== 'state' && data.kind !== 'result') return
    if (data.kind === 'result' && pending?.request !== data.request) return
    if (!validBounds(data.bounds) || typeof data.fullscreen !== 'boolean') return
    popup = event.source; audienceState = data
    if (data.kind === 'result' && pending?.request === data.request) {
      const operation = pending; clearTimeout(timeout); pending = null
      const placed = !operation.target || screenKey(audienceScreen()) === screenKey(operation.target)
      if (!placed) {
        notice = 'Display placement was not confirmed. Click Start again or move the audience window manually.'
      } else if (operation.swapTo) {
        try { placeWindow(window, operation.swapTo, true) } catch {}
        await new Promise(resolve => setTimeout(resolve, 300))
        if (disposed || operation.generation !== generation) return
        notice = screenKey(current()) === screenKey(operation.swapTo)
          ? data.fullscreen ? 'Displays swapped.' : 'Displays swapped. Click Enter audience fullscreen to finish.'
          : 'Audience moved. Move this console manually; the browser did not move its window.'
      } else {
        notice = data.fullscreen ? 'Audience fullscreen.' : 'Browser requires another fullscreen click. Use Enter audience fullscreen or the audience’s own button.'
      }
      busy = false
    } else if (!busy && notice === 'Audience window opening…') {
      notice = data.fullscreen ? 'Audience fullscreen.' : 'Window placed. Click Enter audience fullscreen to finish.'
    }
    render()
  }
  window.addEventListener('message', receive, { signal })
  document.addEventListener('fullscreenchange', () => { onResize(); render() }, { signal })
  start.addEventListener('click', startPresentation, { signal })
  manual.addEventListener('click', () => openAudience(false), { signal })
  swap.addEventListener('click', () => requestAudienceFullscreen(current(), audienceScreen()), { signal })
  detect.addEventListener('click', async () => { busy = true; render(); await discover(true); busy = false; render() }, { signal })
  const timer = setInterval(render, 1000)
  void discover(false).then(render)
  render()
  return {
    singleScreen,
    destroy() {
      disposed = true; cancel(); listeners.abort(); clearInterval(timer)
      if (document.fullscreenElement === slideHost) void document.exitFullscreen().catch(() => {})
    },
  }
}

export function setupAudienceDisplays({ id }) {
  const listeners = new AbortController(), signal = listeners.signal
  let disposed = false, working = false
  function send(kind = 'state', request) {
    if (disposed || !window.opener) return
    try { window.opener.postMessage({ type: messageType, session: id, kind, request, bounds: bounds(), fullscreen: !!document.fullscreenElement }, origin) } catch {}
  }
  window.addEventListener('message', async event => {
    const data = event.data
    if (disposed || event.origin !== origin || event.source !== window.opener || data?.type !== messageType || data.session !== id
      || data.kind !== 'fullscreen' || typeof data.request !== 'string' || data.request.length > 100 || (data.screen !== null && !validBounds(data.screen))) return
    if (working) { send('result', data.request); return }
    working = true
    let invalidated = false, permission, details, target
    const operation = new AbortController()
    const invalidate = () => { invalidated = true; operation.abort() }
    signal.addEventListener('abort', invalidate, { once: true })
    const check = () => { if (disposed || invalidated) throw new Error('Display operation cancelled') }
    try {
      if (data.screen && window.getScreenDetails) {
        permission = await navigator.permissions.query({ name: 'window-management' })
        if (permission.state !== 'granted') throw new Error('Display permission unavailable')
        permission.addEventListener('change', invalidate)
        details = await displayOperation(window.getScreenDetails(), operation)
        details.addEventListener('screenschange', invalidate)
        target = details.screens.find(screen => screenKey(screen) === screenKey(data.screen))
        if (!target) throw new Error('Display disconnected')
      }
      check()
      if (document.fullscreenElement) await displayOperation(document.exitFullscreen(), operation)
      check()
      if (target) placeWindow(window, target)
      const fullscreen = document.documentElement.requestFullscreen(target ? { screen: target } : undefined)
      void fullscreen.then(() => {
        if ((disposed || invalidated || operation.signal.aborted) && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      }, () => {})
      await displayOperation(fullscreen, operation)
    } catch {} finally {
      // Fullscreen can resolve before the platform has moved the window. Ack
      // measured bounds even if fullscreen was rejected after a valid move.
      const deadline = performance.now() + 1800
      while (!disposed && !invalidated && !operation.signal.aborted && target && screenKey(containingScreen(details, bounds())) !== screenKey(target) && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      permission?.removeEventListener('change', invalidate)
      details?.removeEventListener('screenschange', invalidate)
      signal.removeEventListener('abort', invalidate)
      if (disposed && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      working = false
      send('result', data.request)
    }
  }, { signal })
  for (const event of ['resize', 'pageshow']) window.addEventListener(event, () => send(), { signal })
  document.addEventListener('fullscreenchange', () => send(), { signal })
  const timer = setInterval(() => send(), 1000)
  send()
  const query = new URLSearchParams(location.search)
  if (query.has('fullscreen')) {
    query.delete('fullscreen'); history.replaceState(null, '', `${location.pathname}?${query}`)
    // This can succeed under an automatic-fullscreen permission. Normal browser
    // policy may reject it; the console then offers a fresh delegated click.
    document.documentElement.requestFullscreen().catch(() => {}).finally(() => {
      if (disposed && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      send()
    })
  }
  return { destroy() {
    disposed = true; listeners.abort(); clearInterval(timer)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  } }
}
