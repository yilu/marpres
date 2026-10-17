import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

// Exercise the real server, controller and popup in one browser profile, without
// exposing controller internals or replacing BroadcastChannel / Web Locks.
const secret = 'PRIVATE-PRESENTER-INTEGRATION-NOTE'
const source = `# First slide

::: box id=first
Opening content
:::

---
# Sparse reveals

<!-- notes
${secret} **only in the console**
-->

::: box id=base
Always visible
:::

::: box id=reveal-three stage=3
Third reveal
:::

::: box id=reveal-eight stage=8
Eighth reveal
:::

---
# Last slide

::: box id=last stage=5
Final reveal
:::
`
const dir = await mkdtemp(join(tmpdir(), 'marpres-presenter-browser-'))
const file = join(dir, 'deck.md')
await writeFile(file, source)
let app, browser
const errors = []
const hostFor = page => new URL(page.url()).pathname === '/audience' ? '#audience-view' : '#current-view'
const inkSelector = '[data-presenter-overlay] [data-layer="strokes"] path'

async function position(page, expectedPage, stage) {
  const host = hostFor(page)
  await page.waitForFunction(({ host, expectedPage, stage }) => {
    const viewport = document.querySelector(`${host} .slide-viewport`)
    const roots = [...(viewport?.querySelector('iframe')?.contentDocument?.querySelectorAll('.marpit>svg[data-marpit-svg]') || [])]
    return viewport?.dataset.page === String(expectedPage) && viewport.dataset.stage === String(stage)
      && roots.length === 3 && roots.findIndex(root => root.classList.contains('presenter-current')) === expectedPage
  }, { host, expectedPage, stage })
  await page.evaluate(() => {
    if (window.presentationAudit) return
    const id = new URLSearchParams(location.search).get('session')
    window.presentationPackets = []
    window.presentationAuditStarted = performance.now()
    window.presentationAudit = new BroadcastChannel(`marpres:${id}`)
    window.presentationAudit.onmessage = event => window.presentationPackets.push(event.data)
  })
}
async function bothPosition(presenter, audience, page, stage) {
  await Promise.all([position(presenter, page, stage), position(audience, page, stage)])
}
async function countInk(page, count, layer = 'strokes') {
  await page.waitForFunction(({ host, count, layer }) => document.querySelectorAll(`${host} [data-layer="${layer}"] path`).length === count,
    { host: hostFor(page), count, layer })
}
async function bothInk(presenter, audience, count, layer) {
  await Promise.all([countInk(presenter, count, layer), countInk(audience, count, layer)])
}
async function tool(presenter, audience, name) {
  await presenter.click(`#tools [data-tool="${name}"]`)
  await audience.waitForFunction(name => document.querySelector('#audience-view [data-layer="pointer"]')?.getAttribute('data-tool') === name, name)
}
async function normalizedMove(page, x, y) {
  const box = await page.locator(`${hostFor(page)} [data-presenter-overlay]`).boundingBox()
  assert.ok(box && box.width > 0 && box.height > 0, 'The annotation viewport has visible bounds')
  await page.mouse.move(box.x + x * box.width / 1280, box.y + y * box.height / 720)
}
async function draw(page, from, to) {
  await normalizedMove(page, ...from)
  await page.mouse.down()
  await normalizedMove(page, ...to)
  await page.mouse.up()
}
async function key(page, value) {
  await page.locator('body').evaluate(body => { document.activeElement?.blur(); body.focus() })
  await page.keyboard.press(value)
}
async function saved(page, id, expected) {
  await page.waitForFunction(({ id, expected }) => {
    const value = JSON.parse(localStorage.getItem(`marpres:session:${id}`) || 'null')
    return value && Object.entries(expected).every(([path, wanted]) => {
      const actual = path.split('.').reduce((object, key) => object?.[key], value)
      return wanted && typeof wanted === 'object' ? actual >= wanted.minimum : actual === wanted
    })
  }, { id, expected })
}
async function latestState(page) {
  return page.evaluate(() => presentationPackets.filter(packet => packet.kind === 'state').at(-1))
}
async function rejectQueuedInk(presenter, audience, staleContext, label) {
  const current = await latestState(audience)
  assert.ok(Number.isSafeInteger(staleContext) && current.view.context > staleContext, `${label}: the gesture context advanced`)
  const ink = current.view.ink[current.view.board ? 'board' : `slide:${current.view.page}`] || []
  const [x, y] = ink[0]?.points[0] || [100, 100]
  const stroke = { id: `queued-${label}`, tool: 'pen', color: '#ff0000', width: 4, points: [[80, 80], [120, 80]] }
  for (const action of [{ type: 'stroke', stroke }, { type: 'drawing', stroke }, { type: 'erase', point: { x, y }, radius: 18 }]) {
    const marker = `queued-${label}-${action.type}`
    await audience.evaluate(({ current, staleContext, action, marker }) => {
      presentationAudit.postMessage({ session: current.session, client: marker, kind: 'command', epoch: current.epoch, context: staleContext, action })
      // FIFO delivery from this channel gives us a real controller response
      // after the queued command, without sleeps or controller internals.
      presentationAudit.postMessage({ session: current.session, client: marker, kind: 'hello', epoch: current.epoch })
    }, { current, staleContext, action, marker })
    await presenter.waitForFunction(marker => {
      const barrier = presentationPackets.findLastIndex(packet => packet.client === marker && packet.kind === 'hello')
      return barrier >= 0 && presentationPackets.slice(barrier + 1).some(packet => packet.kind === 'state')
    }, marker)
    const after = await latestState(presenter)
    await audience.waitForFunction(revision => presentationPackets.some(packet => packet.kind === 'state' && packet.revision >= revision), after.revision)
    assert.deepEqual(after.view, current.view, `${label}: queued ${action.type} cannot affect the new gesture context`)
    await bothInk(presenter, audience, ink.length)
    await bothInk(presenter, audience, 0, 'drawing')
  }
}

try {
  app = await createDraftServer({ file, port: 0 })
  const initial = await app.store.read()
  const chrome = process.env.CHROME_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  context.setDefaultTimeout(10000)
  context.on('page', page => page.on('pageerror', error => errors.push(`${new URL(page.url()).pathname}: ${error.message}`)))
  const editorHTML = await (await fetch(app.url)).text()
  const token = /<meta name="editor-token" content="([^"]+)"/.exec(editorHTML)?.[1]
  assert.ok(token, 'Snapshot creation uses the editor page capability')
  const createSession = async slide => {
    const response = await fetch(`${app.url}/api/presentation`, {
      method: 'POST', headers: { Origin: app.url, 'Content-Type': 'application/json', 'X-Editor-Token': token },
      body: JSON.stringify({ hash: initial.hash, slide }),
    })
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    assert.match(value.presenterUrl, /#key=[a-f\d]{64}$/)
    return value
  }
  const session = await createSession(2)
  const presenterURL = app.url + session.presenterUrl
  let presenter = await context.newPage()
  await presenter.goto(presenterURL)
  await position(presenter, 1, 0)
  assert.match(await presenter.locator('#notes').innerText(), new RegExp(secret))
  assert.equal(await presenter.locator('#next-label').innerText(), 'Slide 2 · Reveal 3')

  const audiencePending = presenter.waitForEvent('popup')
  await presenter.click('#open-audience')
  let audience = await audiencePending
  await audience.setViewportSize({ width: 1280, height: 800 })
  await audience.waitForURL(app.url + session.audienceUrl)
  await bothPosition(presenter, audience, 1, 0)
  await presenter.waitForFunction(() => document.querySelector('#connection').textContent.startsWith('Audience connected'))
  await audience.waitForFunction(() => document.querySelector('#audience-status').textContent.startsWith('Connected'))
  const audienceSnapshot = await (await fetch(`${app.url}/api/presentation/${session.id}?role=audience`)).json()
  assert.doesNotMatch(JSON.stringify(audienceSnapshot), new RegExp(`${secret}|sourcePath|editor-token|"notes"`))
  assert.doesNotMatch(await audience.content(), new RegExp(secret))
  assert.doesNotMatch(await audience.locator('#audience-view iframe').getAttribute('srcdoc'), new RegExp(secret))
  assert.equal(await audience.locator('#notes').innerText(), '')

  // Sparse stages are cumulative, and crossing a slide boundary returns to the
  // previous slide's last reveal rather than inventing intermediate stages.
  const visibility = async (page, expected) => {
    const actual = await page.locator(`${hostFor(page)} iframe`).evaluate(frame =>
      [...frame.contentDocument.querySelectorAll('.presenter-current [data-stage]')].map(item => [Number(item.dataset.stage), getComputedStyle(item).visibility]))
    assert.deepEqual(actual, expected)
  }
  await visibility(audience, [[0, 'visible'], [3, 'hidden'], [8, 'hidden']])
  await presenter.click('#next'); await bothPosition(presenter, audience, 1, 3)
  await visibility(audience, [[0, 'visible'], [3, 'visible'], [8, 'hidden']])
  await key(audience, 'PageDown'); await bothPosition(presenter, audience, 1, 8)
  await visibility(audience, [[0, 'visible'], [3, 'visible'], [8, 'visible']])
  await presenter.click('#next'); await bothPosition(presenter, audience, 2, 0)
  await key(presenter, 'ArrowLeft'); await bothPosition(presenter, audience, 1, 8)
  await presenter.click('#previous'); await bothPosition(presenter, audience, 1, 3)
  await key(presenter, 'Home'); await bothPosition(presenter, audience, 0, 0)
  assert.equal(await presenter.locator('#previous').isDisabled(), true)
  await key(presenter, 'End'); await bothPosition(presenter, audience, 2, 5)
  assert.equal(await presenter.locator('#next').isDisabled(), true)
  assert.equal(await presenter.locator('#finished').isVisible(), true)
  await presenter.selectOption('#slide-picker', '1'); await bothPosition(presenter, audience, 1, 0)
  await presenter.focus('#target'); await presenter.keyboard.press('ArrowRight')
  await presenter.focus('#slide-picker'); await presenter.keyboard.press('Home')
  await presenter.locator('#target').evaluate(input => input.blur())
  await bothPosition(presenter, audience, 1, 0)

  // The console and audience have different viewport sizes. Actual pointer
  // events must still yield the same 1280 x 720 slide coordinates in both.
  for (const name of ['arrow', 'hand', 'laser', 'spotlight']) {
    await tool(presenter, audience, name)
    await normalizedMove(presenter, 640, 360)
    await audience.waitForFunction(() => {
      const pointer = document.querySelector('#audience-view [data-layer="pointer"]')
      const values = pointer?.getAttribute('transform')?.match(/[\d.]+/g)?.map(Number)
      return pointer?.getAttribute('visibility') === 'visible' && values && Math.abs(values[0] - 640) < 2 && Math.abs(values[1] - 360) < 2
    })
    assert.equal(await audience.locator('[data-layer="spotlight"]').getAttribute('visibility'), name === 'spotlight' ? 'visible' : 'hidden')
    await presenter.mouse.move(1, 1)
    await audience.waitForFunction(() => document.querySelector('#audience-view [data-layer="pointer"]').getAttribute('visibility') === 'hidden')
  }
  await tool(presenter, audience, 'pen')
  await presenter.locator('#ink-color').evaluate(input => { input.value = '#3366ff'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  await presenter.locator('#ink-width').evaluate(input => { input.value = '8'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  await normalizedMove(presenter, 320, 180); await presenter.mouse.down()
  await normalizedMove(presenter, 640, 360)
  await bothInk(presenter, audience, 1, 'drawing')
  const livePath = await audience.locator('[data-layer="drawing"] path').getAttribute('d')
  assert.match(livePath, /^M/)
  assert.equal(await audience.locator('[data-layer="drawing"] path').getAttribute('stroke'), '#3366ff')
  await presenter.mouse.up(); await bothInk(presenter, audience, 1)
  await bothInk(presenter, audience, 0, 'drawing')
  const firstInk = await presenter.locator(`#current-view ${inkSelector}`).getAttribute('d')
  assert.equal(await audience.locator(`#audience-view ${inkSelector}`).getAttribute('d'), firstInk)
  const coordinates = firstInk.match(/-?[\d.]+/g).map(Number)
  for (const [actual, expected] of coordinates.slice(0, 2).map((n, index) => [n, [320, 180][index]])) assert.ok(Math.abs(actual - expected) < 2)
  for (const [actual, expected] of coordinates.slice(-2).map((n, index) => [n, [640, 360][index]])) assert.ok(Math.abs(actual - expected) < 2)

  await presenter.click('#next'); await bothPosition(presenter, audience, 1, 3); await bothInk(presenter, audience, 1)
  await presenter.selectOption('#slide-picker', '2'); await bothPosition(presenter, audience, 2, 0); await bothInk(presenter, audience, 0)
  await draw(presenter, [800, 180], [1000, 300]); await bothInk(presenter, audience, 1)
  const lastInk = await audience.locator(`#audience-view ${inkSelector}`).getAttribute('d')
  assert.notEqual(lastInk, firstInk)
  await presenter.selectOption('#slide-picker', '1'); await bothPosition(presenter, audience, 1, 0); await bothInk(presenter, audience, 1)
  assert.equal(await audience.locator(`#audience-view ${inkSelector}`).getAttribute('d'), firstInk)
  await key(presenter, 'w')
  await audience.waitForFunction(() => document.querySelector('#audience-view .slide-viewport').classList.contains('whiteboard'))
  await bothInk(presenter, audience, 0)
  await tool(presenter, audience, 'highlighter')
  await draw(presenter, [200, 500], [800, 500]); await bothInk(presenter, audience, 1)
  assert.equal(await audience.locator(`#audience-view ${inkSelector}`).getAttribute('stroke-opacity'), '0.3')
  await key(presenter, 'w'); await bothInk(presenter, audience, 1)
  assert.equal(await audience.locator(`#audience-view ${inkSelector}`).getAttribute('d'), firstInk)
  await key(presenter, 'w'); await bothInk(presenter, audience, 1)
  assert.equal(await audience.locator(`#audience-view ${inkSelector}`).getAttribute('stroke-opacity'), '0.3')
  await presenter.click('#ink-clear'); await bothInk(presenter, audience, 0)
  await key(presenter, 'Control+z'); await bothInk(presenter, audience, 1)
  await key(presenter, 'Control+Shift+z'); await bothInk(presenter, audience, 0)
  await key(presenter, 'w'); await bothInk(presenter, audience, 1)
  await tool(presenter, audience, 'eraser')
  await normalizedMove(presenter, 480, 270); await presenter.mouse.down(); await presenter.mouse.up()
  await bothInk(presenter, audience, 0)
  await presenter.click('#ink-undo'); await bothInk(presenter, audience, 1)
  await presenter.click('#ink-redo'); await bothInk(presenter, audience, 0)
  await presenter.click('#ink-undo'); await bothInk(presenter, audience, 1)

  await key(presenter, 'b')
  await audience.waitForFunction(() => document.querySelector('#audience-view .slide-viewport').classList.contains('blacked-out'))
  assert.equal(await audience.locator('#audience-view iframe').evaluate(frame => getComputedStyle(frame).visibility), 'hidden')
  assert.equal(await audience.locator('[data-presenter-overlay]').evaluate(svg => getComputedStyle(svg).opacity), '0')
  await tool(presenter, audience, 'pen')
  await draw(presenter, [100, 100], [200, 200]); await bothInk(presenter, audience, 1)
  await key(audience, 'Escape')
  await audience.waitForFunction(() => !document.querySelector('#audience-view .slide-viewport').classList.contains('blacked-out'))
  await bothPosition(presenter, audience, 1, 0)

  // Audience gestures cross an asynchronous channel. Replaying their queued
  // actions after navigation must neither draw on nor erase the new surface.
  const beforeNavigation = await latestState(audience)
  await presenter.selectOption('#slide-picker', '0'); await bothPosition(presenter, audience, 0, 0)
  await rejectQueuedInk(presenter, audience, beforeNavigation.view.context, 'new-slide')
  await normalizedMove(audience, 300, 450); await audience.mouse.down()
  await normalizedMove(audience, 600, 450); await bothInk(presenter, audience, 1, 'drawing')
  await audience.mouse.up(); await bothInk(presenter, audience, 1); await bothInk(presenter, audience, 0, 'drawing')
  assert.equal(await audience.locator(`#audience-view ${inkSelector}`).getAttribute('d'), await presenter.locator(`#current-view ${inkSelector}`).getAttribute('d'), 'A physical audience stroke commits with the matching context')
  const beforeReturn = await latestState(audience)
  await presenter.selectOption('#slide-picker', '2'); await bothPosition(presenter, audience, 2, 0)
  await presenter.selectOption('#slide-picker', '0'); await bothPosition(presenter, audience, 0, 0)
  await rejectQueuedInk(presenter, audience, beforeReturn.view.context, 'away-and-back')
  const beforeBoard = await latestState(audience)
  await presenter.click('#board')
  await audience.waitForFunction(() => document.querySelector('#audience-view .slide-viewport').classList.contains('whiteboard'))
  await bothInk(presenter, audience, 0)
  await rejectQueuedInk(presenter, audience, beforeBoard.view.context, 'slide-to-board')
  await draw(audience, [600, 200], [700, 300]); await bothInk(presenter, audience, 1)
  const beforeSlide = await latestState(audience)
  await presenter.click('#board')
  await audience.waitForFunction(() => !document.querySelector('#audience-view .slide-viewport').classList.contains('whiteboard'))
  await bothInk(presenter, audience, 1)
  await rejectQueuedInk(presenter, audience, beforeSlide.view.context, 'board-to-slide')
  await presenter.selectOption('#slide-picker', '1'); await bothPosition(presenter, audience, 1, 0); await bothInk(presenter, audience, 1)

  await presenter.click('#timer-toggle')
  await presenter.waitForFunction(() => document.querySelector('#timer').textContent !== '00:00')
  await presenter.click('#timer-toggle')
  await saved(presenter, session.id, { 'state.timer.startedAt': null, 'state.timer.elapsed': { minimum: 1000 } })
  const paused = await presenter.locator('#timer').innerText()
  const pingCount = await audience.evaluate(() => presentationPackets.filter(packet => packet.kind === 'ping').length)
  await audience.waitForFunction(count => presentationPackets.filter(packet => packet.kind === 'ping').length >= count + 2, pingCount)
  assert.equal(await presenter.locator('#timer').innerText(), paused, 'Pause freezes elapsed time while heartbeats continue')
  const heartbeat = await audience.evaluate(() => ({ pings: presentationPackets.filter(packet => packet.kind === 'ping').length, seconds: (performance.now() - presentationAuditStarted) / 1000 }))
  assert.ok(heartbeat.pings <= Math.ceil(heartbeat.seconds) + 2, 'Hello responses must not start a ping/hello feedback loop')
  await presenter.fill('#target', '20'); await presenter.locator('#target').dispatchEvent('change')
  await saved(presenter, session.id, { 'state.timer.target': 1200000 })
  await presenter.click('#timer-reset')
  await saved(presenter, session.id, { 'state.timer.elapsed': 0, 'state.timer.startedAt': null })
  assert.equal(await presenter.locator('#timer').innerText(), '00:00')

  await audience.click('#fullscreen')
  await audience.waitForFunction(() => document.fullscreenElement?.id === 'audience' || document.querySelector('#audience-status').textContent.includes('Fullscreen was unavailable'))
  assert.equal(await audience.evaluate(() => document.fullscreenElement?.id), 'audience', 'The audience button requests fullscreen during a user gesture')
  await audience.evaluate(() => document.exitFullscreen())

  // The private URL permits reopening, while a simultaneous console must lose
  // the Web Lock and leave the existing controller and audience untouched.
  const duplicate = await context.newPage(); await duplicate.goto(presenterURL)
  await duplicate.locator('#failure').waitFor()
  assert.match(await duplicate.locator('#failure-message').innerText(), /already has a presenter console/)
  await duplicate.close()
  await presenter.click('#next'); await bothPosition(presenter, audience, 1, 3)
  await saved(presenter, session.id, { 'state.page': 1, 'state.stage': 3, 'state.ink.slide:1.length': 1 })
  const oldPacket = await audience.evaluate(() => presentationPackets.filter(packet => packet.kind === 'state').at(-1))
  await presenter.reload(); await bothPosition(presenter, audience, 1, 3); await bothInk(presenter, audience, 1)
  assert.equal(await presenter.inputValue('#target'), '20')
  assert.match(await presenter.locator('#notes').innerText(), new RegExp(secret))
  await audience.waitForFunction(epoch => presentationPackets.some(packet => packet.kind === 'state' && packet.epoch > epoch), oldPacket.epoch)
  const currentPacket = await audience.evaluate(() => presentationPackets.filter(packet => packet.kind === 'state').at(-1))
  await audience.evaluate(() => {
    window.unexpectedPositions = []
    const viewport = document.querySelector('#audience-view .slide-viewport')
    window.positionObserver = new MutationObserver(() => {
      if (viewport.dataset.page !== '1' || viewport.dataset.stage !== '3') unexpectedPositions.push({ ...viewport.dataset })
    })
    positionObserver.observe(viewport, { attributes: true, attributeFilter: ['data-page', 'data-stage'] })
  })
  await presenter.evaluate(({ oldPacket, currentPacket }) => {
    for (const [packet, client, revision] of [[oldPacket, 'integration-stale-epoch', 999999], [currentPacket, 'integration-stale-revision', 0]]) {
      presentationAudit.postMessage({ ...packet, client, revision, view: { ...packet.view, page: 0, stage: 0 } })
    }
  }, { oldPacket, currentPacket })
  await audience.waitForFunction(() => presentationPackets.some(packet => packet.client === 'integration-stale-revision'))
  await bothPosition(presenter, audience, 1, 3)
  assert.deepEqual(await audience.evaluate(() => { positionObserver.disconnect(); return unexpectedPositions }), [], 'Delayed state from an old controller or revision never flashes a stale slide')
  await audience.reload(); await bothPosition(presenter, audience, 1, 3); await bothInk(presenter, audience, 1)
  await presenter.close()
  await audience.waitForFunction(() => document.querySelector('#audience-status').textContent.includes('Presenter disconnected'))
  presenter = await context.newPage(); await presenter.goto(presenterURL)
  await bothPosition(presenter, audience, 1, 3); await bothInk(presenter, audience, 1)
  await audience.waitForFunction(() => document.querySelector('#audience-status').textContent.startsWith('Connected'))
  await audience.close()
  const reopened = presenter.waitForEvent('popup'); await presenter.click('#open-audience'); audience = await reopened
  await bothPosition(presenter, audience, 1, 3); await bothInk(presenter, audience, 1)

  const second = await createSession(1)
  const secondPresenter = await context.newPage(); await secondPresenter.goto(app.url + second.presenterUrl)
  await position(secondPresenter, 0, 0)
  const secondPending = secondPresenter.waitForEvent('popup'); await secondPresenter.click('#open-audience')
  const secondAudience = await secondPending; await bothPosition(secondPresenter, secondAudience, 0, 0)
  await presenter.click('#next'); await bothPosition(presenter, audience, 1, 8)
  await bothPosition(secondPresenter, secondAudience, 0, 0); await bothInk(secondPresenter, secondAudience, 0)
  await key(secondAudience, 'End'); await bothPosition(secondPresenter, secondAudience, 2, 5)
  await bothPosition(presenter, audience, 1, 8)
  // Even a wrong-session message injected onto the right channel is ignored.
  await audience.evaluate(other => presentationAudit.postMessage({ session: other, kind: 'command', client: 'integration-foreign', epoch: presentationPackets.filter(p => p.kind === 'state').at(-1).epoch, action: { type: 'first' } }), second.id)
  await presenter.click('#previous'); await bothPosition(presenter, audience, 1, 3)
  await bothPosition(secondPresenter, secondAudience, 2, 5)
  for (const page of [presenter, audience, secondPresenter, secondAudience]) {
    assert.doesNotMatch(await page.evaluate(() => JSON.stringify(presentationPackets)), new RegExp(`${secret}|sourcePath|editor-token|"notes"|"timer"`))
  }

  await presenter.click('#end')
  await audience.locator('#ended').waitFor()
  await presenter.waitForFunction(() => document.querySelector('#failure h1').textContent === 'Presentation ended')
  assert.equal((await fetch(`${app.url}/api/presentation/${session.id}?role=audience`)).status, 410)
  assert.equal((await fetch(`${app.url}/api/presentation/${second.id}?role=audience`)).status, 200)
  await bothPosition(secondPresenter, secondAudience, 2, 5)
  await audience.reload(); await audience.locator('#failure').waitFor()
  assert.match(await audience.locator('#failure-message').innerText(), /ended/)
  await secondPresenter.click('#end'); await secondAudience.locator('#ended').waitFor()
  assert.equal(await readFile(file, 'utf8'), source)
  assert.deepEqual((await app.store.read()).history, initial.history)
  assert.deepEqual(await readdir(dir), ['deck.md'], 'Presenting creates no source history or generated files')
  assert.deepEqual(errors, [])
  console.log('Presenter multi-window browser checks passed: guarded snapshots, selected slide, sparse cumulative reveals, keyboard/input handling, private notes, normalized pointers/live ink, per-slide/board ink, erase/undo/redo/clear, blank, audience drawing and stale-context rejection across navigation/board/return, timer, fullscreen, single controller, reload/reopen/resync, stale epoch/revision rejection, session isolation, ending and unchanged source/history.')
} finally {
  await browser?.close()
  await app?.close()
  await rm(dir, { recursive: true, force: true })
}
