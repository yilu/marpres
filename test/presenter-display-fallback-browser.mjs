import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const directory = await mkdtemp(join(tmpdir(), 'marpres-display-fallback-'))
const file = join(directory, 'deck.md'), source = '# Two displays\n\n<!-- notes\nPrivate notes\n-->\n\n::: box id=content\nAudience content\n:::\n'
await writeFile(file, source)
let app, browser
const errors = []
try {
  app = await createDraftServer({ file, port: 0 })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ignoreDefaultArgs: ['--disable-popup-blocking'], args: ['--screen-info={0,0 1440x900}{1440,0 1920x1080}'] })
  for (const scenario of ['unsupported', 'denied', 'failed']) {
    const context = await browser.newContext({ viewport: null })
    context.setDefaultTimeout(15000)
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
    if (scenario === 'unsupported') await context.addInitScript(() => {
      window.getScreenDetails = undefined
      Object.defineProperty(screen, 'isExtended', { configurable: true, value: undefined })
    })
    if (scenario === 'failed') await context.addInitScript(() => { window.getScreenDetails = async () => { throw new Error('Display service unavailable') } })
    const editor = await context.newPage(), cdp = await context.newCDPSession(editor)
    const { targetInfo } = await cdp.send('Target.getTargetInfo')
    await cdp.send('Browser.setPermission', { permission: { name: 'window-management' }, setting: scenario === 'denied' ? 'denied' : 'granted', origin: app.url, browserContextId: targetInfo.browserContextId })
    await editor.goto(app.url)
    await editor.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
    const popup = editor.waitForEvent('popup'); await editor.click('#present'); const presenter = await popup
    await presenter.waitForFunction(() => document.querySelector('#current-view .slide-viewport')?.dataset.page === '0')
    await presenter.click('#start-presenting')
    await presenter.waitForFunction(() => !document.querySelector('#start-presenting').disabled)
    assert.equal(await presenter.evaluate(() => !!document.fullscreenElement), false, `${scenario}: unknown detection must not silently fullscreen the current screen`)
    assert.equal(context.pages().length, 2, 'No unexpected audience or fullscreen window')
    assert.doesNotMatch(await presenter.locator('#display-status').textContent(), /single screen|1 display/i)
    assert.equal(await presenter.locator('#present-here').isVisible(), true)
    assert.equal(await presenter.locator('#swap-displays').isDisabled(), true)
    await presenter.click('#present-here')
    await presenter.waitForFunction(() => document.fullscreenElement?.id === 'current-view')
    assert.equal(await presenter.evaluate(() => document.fullscreenElement.contains(document.querySelector('#notes'))), false)
    await presenter.evaluate(() => document.exitFullscreen())
    const manualPopup = presenter.waitForEvent('popup'); await presenter.click('#open-audience'); const audience = await manualPopup
    await audience.waitForFunction(() => document.querySelector('#audience-view .slide-viewport')?.dataset.page === '0')
    assert.equal(await audience.locator('#notes').textContent(), '')
    await presenter.click('#end'); await context.close()
  }
  assert.equal(await readFile(file, 'utf8'), source)
  assert.deepEqual(errors, [])
  console.log('Display fallback checks passed: two monitors with unsupported, denied, or failed detection stay in the console; explicit Present here and manual audience remain usable; notes/source preserved.')
} finally {
  await browser?.close(); await app?.close(); await rm(directory, { recursive: true, force: true })
}
