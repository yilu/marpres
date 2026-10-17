import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const directory = await mkdtemp(join(tmpdir(), 'marpres-presenter-layout-'))
const file = join(directory, 'deck.md')
const secret = 'PRIVATE-LAYOUT-NOTE'
await writeFile(file, `# First\n\n<!-- notes\n${secret}\n\n${'Readable speaker notes. '.repeat(80)}\n-->\n\n::: box id=first\nFirst slide\n:::\n\n---\n# Second\n\n::: box id=second\nSecond slide\n:::\n`)
const preferencesKey = 'marpres:presenter-layout:v1'
const screenshots = process.env.PRESENTER_LAYOUT_SCREENSHOTS
let app, browser
const errors = []
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const bounds = (page, selector) => page.locator(selector).boundingBox()
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#current-view .slide-viewport')?.dataset.page === '0'
    && document.querySelector('#next-view .slide-viewport')?.dataset.page === '1')
  await settle(page)
}
async function geometry(page) {
  for (const selector of ['#current-view', '#next-view']) {
    if (!await page.locator(selector).isVisible()) continue
    const host = await bounds(page, selector), slide = await bounds(page, `${selector} .slide-viewport`)
    assert.ok(slide.width > 0 && slide.height > 0)
    assert.ok(Math.abs(slide.width / slide.height - 16 / 9) < .01, `${selector} stays proportional`)
    assert.ok(slide.width <= host.width + 1 && slide.height <= host.height + 1, `${selector} fits its available space`)
  }
}

try {
  if (screenshots) await mkdir(screenshots, { recursive: true })
  app = await createDraftServer({ file, port: 0 })
  const initial = await app.store.read()
  const editorHTML = await (await fetch(app.url)).text()
  const token = /<meta name="editor-token" content="([^"]+)"/.exec(editorHTML)[1]
  const sessionResponse = await fetch(`${app.url}/api/presentation`, {
    method: 'POST', headers: { Origin: app.url, 'Content-Type': 'application/json', 'X-Editor-Token': token },
    body: JSON.stringify({ hash: initial.hash, slide: 1 }),
  })
  assert.equal(sessionResponse.status, 200)
  const session = await sessionResponse.json(), url = app.url + session.presenterUrl
  const chrome = process.env.CHROME_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) })
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1024, height: 768 }, { width: 1024, height: 600 }, { width: 768, height: 900 }]) {
    const context = await browser.newContext({ viewport })
    context.setDefaultTimeout(10000)
    const page = await context.newPage()
    const capture = async name => { if (screenshots && viewport.width === 1440) await page.screenshot({ path: join(screenshots, `${name}.png`) }) }
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url); await ready(page)
    const initialReset = await bounds(page, '#layout-reset')
    assert.ok(initialReset.y >= 0 && initialReset.y + initialReset.height <= viewport.height, 'Layout controls are visible even in a short window')
    const defaultSidebar = await bounds(page, '.side-column')
    assert.ok(defaultSidebar.width >= 380, `Notes have a useful default width at ${viewport.width}px`)
    const notesHeight = (await bounds(page, '#notes')).height
    assert.ok(notesHeight >= (viewport.height < 700 ? 140 : 160), `Notes retain useful height at ${viewport.width}×${viewport.height} (${notesHeight}px)`)
    assert.ok(await page.locator('#notes').evaluate(element => parseFloat(getComputedStyle(element).fontSize)) >= 20)
    await geometry(page)
    await capture('default')
    await page.waitForFunction(id => localStorage.getItem(`marpres:session:${id}`), session.id)
    const originalState = await page.evaluate(id => JSON.parse(localStorage.getItem(`marpres:session:${id}`)).state, session.id)
    const initialNext = await bounds(page, '.next-card')
    await page.click('#notes-toggle'); await settle(page)
    assert.equal(await page.locator('.notes-card').isVisible(), false, 'Hide removes the whole notes card')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'layout-notes', 'Hiding the focused card moves focus to its visible restore control')
    assert.ok((await bounds(page, '.next-card')).height > initialNext.height + 100, 'The next preview uses the released notes height')
    assert.equal(await page.locator('#layout-notes').getAttribute('aria-pressed'), 'false')
    await capture('notes-hidden')
    await page.click('#layout-notes'); await settle(page)
    assert.equal(await page.locator('.notes-card').isVisible(), true)
    const initialNotes = await bounds(page, '.notes-card')
    await page.click('#next-toggle'); await settle(page)
    assert.equal(await page.locator('.next-card').isVisible(), false)
    assert.equal(await page.evaluate(() => document.activeElement.id), 'layout-next')
    assert.ok((await bounds(page, '.notes-card')).height > initialNotes.height + 100, 'Hiding next preview gives notes more room')
    await capture('next-hidden')
    await page.click('#layout-next'); await settle(page)
    const splitter = page.locator('#sidebar-resizer')
    if (viewport.width > 850) {
      const grip = await splitter.boundingBox()
      await page.mouse.move(grip.x + grip.width / 2, grip.y + 60)
      await page.mouse.down(); await page.mouse.move(grip.x - 80, grip.y + 60, { steps: 5 }); await page.mouse.up()
      await settle(page)
      const dragged = (await bounds(page, '.side-column')).width
      assert.ok(dragged > defaultSidebar.width + 70, 'Dragging left expands notes')
      await splitter.focus(); await page.keyboard.press('ArrowRight'); await settle(page)
      assert.ok(Math.abs((await bounds(page, '.side-column')).width - (dragged - 20)) < 1)
      await page.keyboard.press('End'); await settle(page)
      assert.ok((await bounds(page, '.current-column')).width >= 379, 'Resize bounds preserve the current slide column')
      await page.keyboard.press('Home'); await settle(page)
      assert.equal(Math.round((await bounds(page, '.side-column')).width), 280)
      await page.keyboard.press('ArrowLeft'); await settle(page)
      assert.equal(Math.round((await bounds(page, '.side-column')).width), 300)
      assert.equal(await page.locator('#current-view .slide-viewport').getAttribute('data-page'), '0', 'Separator keys never navigate slides')
    } else {
      assert.equal(await splitter.isVisible(), false, 'The splitter is hidden in the stacked layout')
      assert.ok((await bounds(page, '.side-column')).y > (await bounds(page, '.current-column')).y)
    }
    await page.click('#notes-larger')
    const fontSize = await page.locator('#notes').evaluate(element => getComputedStyle(element).fontSize)
    const sidebarWidth = (await bounds(page, '.side-column')).width
    await page.click('#layout-next')
    await page.reload(); await ready(page)
    assert.equal(await page.locator('.next-card').isVisible(), false, 'Preview visibility survives reopening')
    assert.equal(await page.locator('#notes').evaluate(element => getComputedStyle(element).fontSize), fontSize)
    assert.equal(Math.round((await bounds(page, '.side-column')).width), Math.round(sidebarWidth))
    const preferences = await page.evaluate(key => localStorage.getItem(key), preferencesKey)
    assert.ok(preferences)
    assert.doesNotMatch(preferences, new RegExp(`${secret}|notesText|timer|ink`), 'Preferences contain only UI settings')
    assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem(`marpres:session:${id}`)).state, session.id), originalState, 'Layout controls leave presentation state untouched')
    await page.locator('#layout-notes').focus(); await page.keyboard.press('Space'); await settle(page)
    assert.equal(await page.locator('.notes-card').isVisible(), false, 'Space activates a focused layout button')
    assert.equal(await page.locator('#current-view .slide-viewport').getAttribute('data-page'), '0')
    await page.reload(); await ready(page)
    assert.equal(await page.locator('.notes-card').isVisible(), false, 'Notes visibility survives reopening')
    await page.click('#layout-reset'); await settle(page)
    assert.equal(await page.locator('.notes-card').isVisible(), true)
    assert.equal(await page.locator('.next-card').isVisible(), true)
    assert.equal(await page.locator('#notes').evaluate(element => getComputedStyle(element).fontSize), '20px')
    assert.ok(Math.abs((await bounds(page, '.side-column')).width - defaultSidebar.width) < 1)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), preferencesKey), null)
    const reset = await bounds(page, '#layout-reset')
    assert.ok(reset.y >= 0 && reset.y + reset.height <= viewport.height, 'Layout controls remain reachable')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Controls do not cause horizontal overflow')
    await geometry(page)
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  await context.addInitScript(key => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem
    Storage.prototype.getItem = function(name) { if (name === key) throw new Error('Storage blocked'); return get.call(this, name) }
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new Error('Storage blocked'); return set.call(this, name, value) }
    Storage.prototype.removeItem = function(name) { if (name === key) throw new Error('Storage blocked'); return remove.call(this, name) }
  }, preferencesKey)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url); await ready(page)
  await page.click('#notes-toggle'); await page.click('#layout-reset')
  assert.equal(await page.locator('.notes-card').isVisible(), true, 'Storage failures leave layout controls usable')
  await context.close()
  const corruptContext = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  await corruptContext.addInitScript(key => localStorage.setItem(key, '{bad JSON'), preferencesKey)
  const corruptPage = await corruptContext.newPage()
  corruptPage.on('pageerror', error => errors.push(error.message))
  await corruptPage.goto(url); await ready(corruptPage)
  assert.equal(Math.round((await bounds(corruptPage, '.side-column')).width), 400)
  assert.equal(await corruptPage.locator('.notes-card').isVisible(), true, 'Corrupt preferences fall back to the default layout')
  await corruptPage.click('#notes-toggle'); await corruptPage.keyboard.press('Space')
  assert.equal(await corruptPage.locator('.notes-card').isVisible(), true, 'The restore control remains usable from the keyboard')
  await corruptContext.close()
  assert.deepEqual(errors, [])
  console.log('Presenter layout browser checks passed: desktop/laptop/stacked geometry, readable notes, card collapse and restoration, pointer/keyboard resize bounds, persisted preferences, reset, storage failure, and unchanged presentation state.')
} finally {
  await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true })
}
