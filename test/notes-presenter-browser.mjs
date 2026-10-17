import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-notes-browser-')), file = join(dir, 'deck.md')
await writeFile(file, '# First\n\n<!-- notes\nExisting private note\n-->\n\n::: box id=first\nFirst text\n:::\n\n---\n# Second\n\n::: box id=second stage=3\nSecond text\n:::\n')
let app, browser
try {
  app = await createDraftServer({ file, port: 0 })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(app.url)
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
  await page.click('#toggle-notes')
  assert.equal(await page.inputValue('#notes-editor'), 'Existing private note')
  await page.fill('#notes-editor', 'Private first draft **saved**')
  await page.click('.slide-item[data-slide="2"]')
  await page.fill('#notes-editor', 'Private second draft')
  await page.click('.slide-item[data-slide="1"]')
  assert.equal(await page.inputValue('#notes-editor'), 'Private first draft **saved**')
  await page.click('.slide-item[data-slide="2"]')
  await page.click('#play')
  await page.waitForFunction(() => document.body.classList.contains('presenting'))
  assert.equal(context.pages().length, 1, 'Quick Play stays in the editor window')
  assert.match(await readFile(file, 'utf8'), /Private first draft \*\*saved\*\*/)
  assert.match(await readFile(file, 'utf8'), /Private second draft/)
  assert.equal(await page.locator('#notes-pane').isVisible(), false)
  await page.keyboard.press('Escape')
  await page.fill('#notes-editor', 'Invalid --> note')
  const invalidPopup = page.waitForEvent('popup')
  await page.click('#present')
  const abandoned = await invalidPopup
  if (!abandoned.isClosed()) await abandoned.waitForEvent('close')
  assert.equal(context.pages().length, 1, 'Failed draft save closes the synchronously opened blank window')
  assert.match(await page.locator('#notes-status').innerText(), /terminator/i)
  await page.fill('#notes-editor', 'Private presenter snapshot')
  const pending = page.waitForEvent('popup')
  await page.click('#present')
  const presenter = await pending
  await presenter.waitForURL(/\/presenter\?session=/)
  const createdURL = new URL(presenter.url()), id = createdURL.searchParams.get('session'), key = createdURL.hash.slice(5)
  const snapshot = await (await fetch(`${app.url}/api/presentation/${id}?role=presenter`, { headers: { 'X-Presenter-Key': key } })).json()
  assert.equal(snapshot.startSlide, 2)
  assert.equal(snapshot.notes[1].text, 'Private presenter snapshot')
  assert.doesNotMatch(JSON.stringify(await (await fetch(`${app.url}/api/presentation/${id}?role=audience`)).json()), /Private presenter snapshot|Private first draft/)
  await presenter.close()
  await page.evaluate(() => { window.open = () => null })
  await page.click('#present')
  await page.locator('#presenter-fallback a').waitFor()
  assert.match(await page.locator('#presenter-fallback a').getAttribute('href'), /^\/presenter\?session=.*#key=/)
  assert.equal(context.pages().length, 1, 'Blocked popup offers a link without retrying window.open')
  await page.fill('#notes-editor', 'Private PDF draft')
  await page.route('**/api/export', async route => {
    assert.match(await readFile(file, 'utf8'), /Private PDF draft/)
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF', headers: { 'Content-Disposition': 'attachment; filename="deck.pdf"' } })
  })
  const downloaded = page.waitForEvent('download')
  await page.click('#export-pdf'); await downloaded
  assert.match(await readFile(file, 'utf8'), /Private PDF draft/)
  await page.waitForFunction(() => !document.body.classList.contains('saving'))
  await page.fill('#notes-editor', 'A retained conflict draft')
  await writeFile(file, (await readFile(file, 'utf8')).replace('Private PDF draft', 'External notes change'))
  await page.locator('#reload').waitFor()
  await page.click('#reload')
  await page.waitForFunction(() => !document.body.classList.contains('saving'))
  assert.equal(await page.inputValue('#notes-editor'), 'A retained conflict draft')
  assert.equal(await page.locator('#keep-notes').isVisible(), true)
  assert.equal(await page.locator('#save-notes').isDisabled(), true)
  await page.click('#keep-notes')
  await page.click('[data-slide-action="move-up"]')
  await page.waitForFunction(() => !document.body.classList.contains('saving') && document.querySelector('#slide-title').value === 'Second')
  const moved = await (await fetch(app.url + '/api/deck')).json()
  assert.equal(moved.slides[0].title, 'Second')
  assert.equal(moved.slides[0].notes, 'A retained conflict draft', 'Draft saves before slide reordering and stays on its slide')
  assert.deepEqual(errors, [])
  console.log('Notes and presenter entry browser checks passed: retained drafts, Play/Present/PDF save order, selected-slide snapshot, note privacy, synchronous popup cleanup and blocked-popup recovery.')
} finally {
  await browser?.close(); await app?.close(); await rm(dir, { recursive: true, force: true })
}
