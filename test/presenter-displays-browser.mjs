import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const directory = await mkdtemp(join(tmpdir(), 'marpres-displays-'))
const file = join(directory, 'deck.md')
const source = '# Display test\n\n<!-- notes\nPRIVATE DISPLAY NOTES\n-->\n\n::: box id=first\nFirst\n:::\n\n::: box id=reveal stage=2\nReveal\n:::\n\n---\n# Second\n\n::: box id=second\nSecond\n:::\n'
await writeFile(file, source)
let app, browser
const errors = []
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
async function permission(page, setting) {
  const cdp = await page.context().newCDPSession(page)
  const { targetInfo } = await cdp.send('Target.getTargetInfo')
  await cdp.send('Browser.setPermission', { permission: { name: 'window-management' }, setting, origin: app.url, browserContextId: targetInfo.browserContextId })
  // Keep this protocol session alive: Chrome clears permission overrides when
  // the session that installed them detaches. Context teardown releases it.
}
async function consoleWindow(context, setting = 'granted') {
  const editor = await context.newPage()
  if (setting) await permission(editor, setting)
  await editor.goto(app.url)
  await editor.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
  const opened = editor.waitForEvent('popup')
  await editor.click('#present')
  const consolePage = await opened
  await consolePage.waitForFunction(() => document.querySelector('#current-view .slide-viewport')?.dataset.page === '0')
  assert.equal(await consolePage.locator('#start-presenting').count(), 1, 'Console offers a display-aware Start presenting control')
  return { editor, consolePage }
}
async function launch(screens) {
  browser = await chromium.launch({ headless: true, executablePath: chrome,
    ignoreDefaultArgs: ['--disable-popup-blocking'], args: [`--screen-info=${screens}`] })
  const context = await browser.newContext({ viewport: null })
  await context.addInitScript(() => {
    window.displayTrace = []
    addEventListener('message', event => {
      if (event.data?.type !== 'marpres-display' || event.data.kind === 'state') return
      window.displayTrace.push({ ...event.data, time: Date.now() })
      window.displayTrace = window.displayTrace.slice(-15)
    })
  })
  context.setDefaultTimeout(15000)
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  return context
}
async function fullscreenAudience(consolePage, audience) {
  await audience.waitForLoadState('networkidle')
  const cdp = await audience.context().newCDPSession(audience)
  // Playwright evaluate() grants a synthetic user gesture. Inspect through CDP
  // without one so a load-time fullscreen rejection is genuinely exercised.
  const state = await cdp.send('Runtime.evaluate', { expression: '!!document.fullscreenElement', returnByValue: true, userGesture: false })
  if (!state.result.value) {
    await consolePage.waitForFunction(() => document.querySelector('#start-presenting').textContent.includes('fullscreen'))
    await consolePage.click('#start-presenting')
    await consolePage.waitForFunction(() => !document.querySelector('#start-presenting').disabled)
  }
  assert.equal((await cdp.send('Runtime.evaluate', { expression: '!!document.fullscreenElement', returnByValue: true, userGesture: false })).result.value, true)
}
async function pendingFullscreenEnds(page, role) {
  const result = await page.evaluate(async role => {
    const module = await import('/presenter/displays.js')
    const host = role === 'console' ? document.querySelector('#current-view') : document.documentElement
    const oldURL = location.href, oldRequest = host.requestFullscreen, oldExit = document.exitFullscreen
    const oldDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    let fullscreen = null, resolveRequest, exits = 0, api
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    host.requestFullscreen = () => new Promise(resolve => { resolveRequest = () => { fullscreen = host; resolve() } })
    document.exitFullscreen = async () => { exits++; fullscreen = null }
    try {
      let pending
      if (role === 'console') {
        api = module.setupConsoleDisplays({ id: 'lifecycle-check', slideHost: host, onResize() {} })
        pending = api.singleScreen()
      } else {
        history.replaceState(null, '', oldURL + '&fullscreen=1')
        api = module.setupAudienceDisplays({ id: 'lifecycle-check' })
      }
      api.destroy(); resolveRequest(); await pending
      await new Promise(resolve => setTimeout(resolve, 0))
      return { fullscreen: !!fullscreen, exits }
    } finally {
      api?.destroy(); host.requestFullscreen = oldRequest; document.exitFullscreen = oldExit
      if (oldDescriptor) Object.defineProperty(document, 'fullscreenElement', oldDescriptor)
      else delete document.fullscreenElement
      history.replaceState(null, '', oldURL)
    }
  }, role)
  assert.deepEqual(result, { fullscreen: false, exits: 1 }, `${role}: ending cancels a pending fullscreen result`)
}
async function cancelledAudienceRequest(page, reason) {
  const result = await page.evaluate(async reason => {
    const { setupAudienceDisplays } = await import('/presenter/displays.js')
    const host = document.documentElement
    const saved = { request: host.requestFullscreen, exit: document.exitFullscreen, query: navigator.permissions.query,
      details: window.getScreenDetails, move: window.moveTo, resize: window.resizeTo,
      fullscreen: Object.getOwnPropertyDescriptor(document, 'fullscreenElement') }
    const target = { left: screenX, top: screenY, width: outerWidth, height: outerHeight, availLeft: screenX, availTop: screenY, availWidth: outerWidth, availHeight: outerHeight }
    const details = Object.assign(new EventTarget(), { screens: [target] })
    const permission = Object.assign(new EventTarget(), { state: 'granted' })
    let fullscreen = null, resolveRequest, exits = 0, api
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    host.requestFullscreen = () => new Promise(resolve => { resolveRequest = () => { fullscreen = host; resolve() } })
    document.exitFullscreen = async () => { exits++; fullscreen = null }
    navigator.permissions.query = async () => permission
    window.getScreenDetails = async () => details
    window.moveTo = window.resizeTo = () => {}
    try {
      api = setupAudienceDisplays({ id: 'cancelled-request-check' })
      dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window.opener,
        data: { type: 'marpres-display', session: 'cancelled-request-check', kind: 'fullscreen', request: reason, screen: target } }))
      await new Promise(resolve => setTimeout(resolve, 0))
      if (typeof resolveRequest !== 'function') throw new Error('Deferred request was not reached')
      if (reason === 'topology') details.dispatchEvent(new Event('screenschange'))
      else if (reason === 'permission') { permission.state = 'denied'; permission.dispatchEvent(new Event('change')) }
      else await new Promise(resolve => setTimeout(resolve, 3100))
      await new Promise(resolve => setTimeout(resolve, 0))
      resolveRequest(); await new Promise(resolve => setTimeout(resolve, 0))
      return { fullscreen: !!fullscreen, exits }
    } finally {
      api?.destroy(); host.requestFullscreen = saved.request; document.exitFullscreen = saved.exit
      navigator.permissions.query = saved.query; window.getScreenDetails = saved.details
      window.moveTo = saved.move; window.resizeTo = saved.resize
      if (saved.fullscreen) Object.defineProperty(document, 'fullscreenElement', saved.fullscreen)
      else delete document.fullscreenElement
    }
  }, reason)
  assert.deepEqual(result, { fullscreen: false, exits: 1 }, `${reason}: cancelled native fullscreen cannot enter later`)
}
try {
  app = await createDraftServer({ file, port: 0 })
  let context = await launch('{0,0 1440x900}{1440,0 1920x1080}')
  const { consolePage } = await consoleWindow(context)
  await consolePage.waitForFunction(() => document.querySelector('#display-status').textContent.includes('2 displays'))
  const opened = consolePage.waitForEvent('popup')
  await consolePage.click('#start-presenting')
  const audience = await opened
  await fullscreenAudience(consolePage, audience)
  assert.ok(await audience.evaluate(() => screenX >= 1440), 'Audience opens on the other screen')
  assert.equal(await audience.locator('#notes').textContent(), '', 'No private notes are rendered in audience document')
  await consolePage.click('#next')
  await audience.waitForFunction(() => document.querySelector('.slide-viewport').dataset.stage === '2')
  await consolePage.click('#timer-toggle')
  await consolePage.click('[data-tool="pen"]')
  const canvas = await consolePage.locator('#current-view .slide-viewport').boundingBox()
  await consolePage.mouse.move(canvas.x + 60, canvas.y + 60)
  await consolePage.mouse.down(); await consolePage.mouse.move(canvas.x + 130, canvas.y + 100, { steps: 5 }); await consolePage.mouse.up()
  const session = new URL(consolePage.url()).searchParams.get('session')
  await consolePage.waitForFunction(id => Object.values(JSON.parse(localStorage.getItem(`marpres:session:${id}`)).state.ink).some(strokes => strokes.length), session)
  const savedState = await consolePage.evaluate(id => JSON.parse(localStorage.getItem(`marpres:session:${id}`)).state, session)
  const position = await consolePage.locator('#position').textContent()
  await consolePage.click('#swap-displays')
  await audience.waitForFunction(() => document.fullscreenElement && screenX < 1440)
  await consolePage.waitForFunction(() => screenX >= 1440)
  assert.equal(await consolePage.locator('#position').textContent(), position, 'Swap preserves slide/reveal')
  assert.equal(await consolePage.locator('#timer-toggle').textContent(), 'Pause timer', 'Swap preserves running timer')
  assert.match(await consolePage.locator('#notes').textContent(), /PRIVATE DISPLAY NOTES/)
  assert.deepEqual(await consolePage.evaluate(id => JSON.parse(localStorage.getItem(`marpres:session:${id}`)).state, session), savedState, 'Swap preserves ink and all saved presentation state')
  await consolePage.click('#swap-displays')
  await audience.waitForFunction(() => document.fullscreenElement && screenX >= 1440)
  await consolePage.waitForFunction(() => screenX < 1440)
  await audience.evaluate(id => {
    window.untrustedFullscreenCalls = 0
    const real = Element.prototype.requestFullscreen
    Element.prototype.requestFullscreen = function(...args) { window.untrustedFullscreenCalls++; return real.apply(this, args) }
    window.postMessage({ type: 'marpres-display', session: id, kind: 'fullscreen', request: 'untrusted', screen: null }, location.origin)
  }, session)
  await audience.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
  assert.equal(await audience.evaluate(() => window.untrustedFullscreenCalls), 0, 'Messages from a window other than the console are ignored')
  // A console refresh must recover its existing audience, without duplicating it.
  await consolePage.reload()
  await consolePage.waitForFunction(() => !document.querySelector('#swap-displays').disabled)
  await consolePage.click('#swap-displays')
  await audience.waitForFunction(() => document.fullscreenElement && screenX < 1440)
  assert.equal(context.pages().length, 3)
  const cdp = await context.newCDPSession(consolePage)
  const { screenInfos } = await cdp.send('Emulation.getScreenInfos')
  await cdp.send('Emulation.removeScreen', { screenId: screenInfos.find(screen => !screen.isPrimary).id })
  await consolePage.waitForFunction(() => document.querySelector('#swap-displays').disabled)
  await consolePage.waitForFunction(() => /1 display|single screen|disconnected/i.test(document.querySelector('#display-status').textContent))
  await cdp.send('Emulation.addScreen', { left: 1440, top: 0, width: 1920, height: 1080 })
  await consolePage.waitForFunction(() => document.querySelector('#display-status').textContent.includes('2 displays'))
  await consolePage.click('#start-presenting')
  await consolePage.waitForFunction(() => !document.querySelector('#start-presenting').disabled)
  if (await audience.evaluate(() => screenX < 1440)) {
    // A hotplug while Chrome is still completing its previous fullscreen
    // transition may require a fresh gesture, which the UI must explain.
    assert.match(await consolePage.locator('#display-status').textContent(), /not confirmed|Click Start/i)
    await consolePage.click('#start-presenting')
  }
  await audience.waitForFunction(() => document.fullscreenElement && screenX >= 1440)
  await consolePage.waitForFunction(() => !document.querySelector('#swap-displays').disabled)
  assert.equal(context.pages().length, 3, 'Reconnected projector reuses the existing audience window')
  await consolePage.click('#end')
  await browser.close(); browser = null

  // Negative desktop coordinates and unequal DPI use CSS pixels, not device pixels.
  context = await launch('{0,0 1440x900}{-1920,0 3840x2160}')
  const settingsPage = await context.newPage(), settingsCDP = await context.newCDPSession(settingsPage)
  const configured = await settingsCDP.send('Emulation.getScreenInfos')
  await settingsCDP.send('Emulation.updateScreen', { screenId: configured.screenInfos.find(screen => !screen.isPrimary).id, devicePixelRatio: 2 })
  const negative = (await consoleWindow(context)).consolePage
  const negativePopup = negative.waitForEvent('popup')
  await negative.click('#start-presenting')
  const negativeAudience = await negativePopup
  await fullscreenAudience(negative, negativeAudience)
  await negativeAudience.waitForFunction(() => screenX < 0 && devicePixelRatio === 2)
  await negative.click('#swap-displays')
  await negativeAudience.waitForFunction(() => document.fullscreenElement && screenX >= 0)
  await negative.waitForFunction(() => screenX < 0)
  // Moving can be asynchronous even when fullscreen is rejected afterwards.
  await negativeAudience.evaluate(() => {
    const move = window.moveTo.bind(window)
    window.moveTo = (...args) => setTimeout(() => move(...args), 200)
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'))
  })
  await negative.click('#swap-displays')
  await negativeAudience.waitForFunction(() => screenX < 0)
  await negative.waitForFunction(() => screenX >= 0)
  await negative.waitForFunction(() => !document.querySelector('#start-presenting').disabled)
  assert.equal(await negativeAudience.evaluate(() => !!document.fullscreenElement), false)
  assert.match(await negative.locator('#display-status').textContent(), /swapped.*fullscreen/i)
  await negative.click('#end')
  await context.close()

  // Delay the real discovery response beyond Chrome's activation timeout.
  // Headless Chrome dismisses a native permission prompt automatically, so the
  // human's prompt latency is modeled here while discovery still uses real APIs.
  context = await browser.newContext({ viewport: null })
  context.setDefaultTimeout(15000)
  const delayed = (await consoleWindow(context)).consolePage
  await delayed.waitForFunction(() => document.querySelector('#display-status').textContent.includes('2 displays'))
  await delayed.evaluate(() => {
    const real = window.getScreenDetails.bind(window)
    let first = true
    window.getScreenDetails = async () => { if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 6000)) } return real() }
  })
  await delayed.click('#start-presenting')
  await delayed.waitForFunction(() => !document.querySelector('#start-presenting').disabled && /Click Start/i.test(document.querySelector('#display-status').textContent))
  assert.equal(context.pages().length, 2, 'An expired permission gesture asks for a fresh click without a stray popup')
  const delayedPopup = delayed.waitForEvent('popup')
  await delayed.click('#start-presenting')
  const delayedAudience = await delayedPopup
  await fullscreenAudience(delayed, delayedAudience)
  await delayed.click('#end')
  await browser.close(); browser = null

  context = await launch('{0,0 1440x900}')
  await context.addInitScript(() => {
    window.screenRequestCount = 0
    if (!window.getScreenDetails) return
    const real = window.getScreenDetails.bind(window)
    window.getScreenDetails = () => { window.screenRequestCount++; return real() }
  })
  const single = (await consoleWindow(context, 'prompt')).consolePage
  await single.click('#start-presenting')
  await single.waitForFunction(() => document.fullscreenElement?.id === 'current-view')
  assert.equal(context.pages().length, 2, 'Single-screen presentation creates no audience popup')
  assert.equal(await single.evaluate(() => window.screenRequestCount), 0, 'Known single screen starts without a display permission prompt')
  assert.equal(await single.evaluate(() => document.fullscreenElement.contains(document.querySelector('#notes'))), false)
  await single.keyboard.press('ArrowRight')
  assert.match(await single.locator('#position').textContent(), /Reveal 2/)
  await single.evaluate(() => document.exitFullscreen())
  assert.equal(await single.locator('#console').isVisible(), true)
  assert.equal(await single.locator('#swap-displays').isDisabled(), true)
  await pendingFullscreenEnds(single, 'console')
  await single.click('#end')
  await context.close()

  context = await browser.newContext({ viewport: null })
  context.setDefaultTimeout(15000)
  const denied = (await consoleWindow(context, 'denied')).consolePage
  await denied.click('#start-presenting')
  assert.equal(await denied.evaluate(() => !!document.fullscreenElement), false)
  await denied.click('#present-here')
  await denied.waitForFunction(() => document.fullscreenElement?.id === 'current-view')
  await denied.evaluate(() => document.exitFullscreen())
  assert.match(await denied.locator('#display-status').textContent(), /denied|unavailable|Present here/i)
  const manualPopup = denied.waitForEvent('popup')
  await denied.click('#open-audience')
  const manual = await manualPopup
  await manual.waitForFunction(() => document.querySelector('#audience-view .slide-viewport')?.dataset.page === '0')
  assert.equal(await denied.locator('#swap-displays').isDisabled(), true)
  await pendingFullscreenEnds(manual, 'audience')
  for (const reason of ['topology', 'permission', 'timeout']) await cancelledAudienceRequest(manual, reason)
  await manual.close()
  await denied.evaluate(() => { window.open = () => null })
  await denied.click('#open-audience')
  assert.match(await denied.locator('#display-status').textContent(), /blocked/i)
  await denied.evaluate(() => new Promise(resolve => setTimeout(resolve, 1200)))
  assert.equal(await denied.locator('#display-status a').count(), 1, 'Popup recovery link remains available')
  await denied.click('#end')
  await context.close()

  context = await browser.newContext({ viewport: null })
  context.setDefaultTimeout(15000)
  await context.addInitScript(() => { window.getScreenDetails = undefined })
  const unsupported = (await consoleWindow(context, null)).consolePage
  await unsupported.click('#start-presenting')
  assert.equal(await unsupported.evaluate(() => !!document.fullscreenElement), false)
  await unsupported.click('#present-here')
  await unsupported.waitForFunction(() => document.fullscreenElement?.id === 'current-view')
  await unsupported.evaluate(() => document.exitFullscreen())
  assert.match(await unsupported.locator('#display-status').textContent(), /unavailable/i)
  const fallbackPopup = unsupported.waitForEvent('popup')
  await unsupported.click('#open-audience')
  const fallback = await fallbackPopup
  await fallback.waitForFunction(() => document.querySelector('#audience-view .slide-viewport')?.dataset.page === '0')
  await fallback.evaluate(() => { Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) })
  await unsupported.waitForFunction(() => document.querySelector('#start-presenting').textContent.includes('fullscreen'))
  await unsupported.click('#start-presenting')
  await unsupported.waitForFunction(() => !document.querySelector('#start-presenting').disabled)
  assert.equal(await fallback.evaluate(() => !!document.fullscreenElement), false)
  assert.match(await unsupported.locator('#display-status').textContent(), /fullscreen click|fullscreen.*audience/i)
  await unsupported.click('#end')
  assert.equal(await readFile(file, 'utf8'), source, 'Display controls never write the deck')
  assert.deepEqual(errors, [])
  console.log('Presenter display browser checks passed: real virtual displays, automatic placement, fullscreen delegation/fallback, swap/state preservation, reload/hotplug, negative coordinates and mixed DPI, delayed discovery, refused fullscreen/async placement, pending End, first-use single screen, unsupported/denied APIs, untrusted messages and popup recovery.')
} catch (error) {
  console.error('Browser errors:', errors)
  for (const context of browser?.contexts() || []) for (const page of context.pages()) {
    console.error(await page.evaluate(() => ({ path: location.pathname, status: document.querySelector('#display-status')?.textContent,
      failure: document.querySelector('#failure-message')?.textContent, extended: screen.isExtended,
      x: screenX, y: screenY, width: innerWidth, dpr: devicePixelRatio, fullscreen: !!document.fullscreenElement })))
    console.error(await page.evaluate(() => window.displayTrace))
  }
  throw error
} finally {
  await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true })
}
