import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'
import { applyDeckDesign, getDeckDesign } from '../editor/theme-store.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-colours-')), file = join(dir, 'deck.md')
const source = '# Palette test\n\n::: box id=body position=absolute dx=200 dy=180 width=400\nChoose consistent colours.\n:::\n\n::: shape id=shape shape=rect dx=200 dy=300 width=250 height=140 fill=none\n:::\n'
const design = getDeckDesign(source)
design.theme.palettes.light.accent = '#127b65'
await writeFile(file, applyDeckDesign(source, design))
await mkdir('dist/validation', { recursive: true })
let app, browser
try {
  app = await createDraftServer({ file, port: 0 })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(app.url)
  await page.waitForSelector('#deck .current-slide')
  const object = id => page.locator(`#deck .current-slide [data-edit-id="${id}"]`)
  const picker = page.locator('#colour-picker')
  const saved = async (path, action) => {
    const pending = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(path))
    await action(); const result = await pending
    assert.equal(result.status(), 200, await result.text())
    await page.waitForFunction(() => !document.body.classList.contains('saving'))
  }
  await object('body').click()
  const before = await readFile(file, 'utf8')
  await page.locator('#style-form [name="color"]').click()
  assert.equal(await picker.isVisible(), true, 'Text colour opens fixed swatches before the native colour spectrum')
  assert.equal(await picker.locator('[data-colour="#127b65"]').count(), 1, 'The deck accent is reusable without entering its RGB value')
  assert.ok(await picker.locator('.colour-swatch').count() >= 24)
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.evaluate(() => document.activeElement.matches('.colour-swatch')), true)
  await page.keyboard.press('Escape')
  assert.equal(await picker.isVisible(), false)
  assert.equal(await readFile(file, 'utf8'), before, 'Opening, navigating and cancelling changes no source')
  assert.equal(await object('body').evaluate(e => e.classList.contains('is-selected')), true, 'Palette shortcuts do not deselect or nudge the object')
  await page.locator('#style-form [name="color"]').click()
  await saved('/api/edit', () => picker.locator('[data-colour="#127b65"]').click())
  assert.match(await readFile(file, 'utf8'), /id=body[^\n]*color=#127b65/)
  await saved('/api/undo', () => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), before)
  await page.reload(); await page.waitForSelector('#deck .current-slide')
  await object('body').click(); await page.locator('#style-form [name="color"]').click()
  await saved('/api/edit', () => picker.locator('[data-colour="#b8361f"]').click())
  assert.match(await readFile(file, 'utf8'), /id=body[^\n]*color=#b8361f/, 'Fixed colours survive reload')

  await object('shape').click()
  await page.locator('#shape-form [name="stroke"]').click()
  await picker.locator('[data-colour="#1f4e9c"]').click()
  await page.getByRole('button', { name: 'Choose fill colour', exact: true }).click()
  await picker.locator('[data-colour="#7a005f"]').first().click()
  await saved('/api/edit', () => page.locator('#shape-form button[type="submit"]').click())
  const options = JSON.parse(await object('shape').getAttribute('data-edit-options'))
  assert.equal(options.stroke, '#1f4e9c')
  assert.equal(options.fill, '#7a005f')
  await page.getByRole('button', { name: 'Choose fill colour', exact: true }).click()
  await picker.getByRole('button', { name: 'No fill', exact: true }).click()
  await saved('/api/edit', () => page.locator('#shape-form button[type="submit"]').click())
  assert.match(await readFile(file, 'utf8'), /id=shape[^\n]*fill=none/)

  await page.click('#theme-toggle'); await page.click('[data-theme-tab="colours"]')
  const beforeTheme = await readFile(file, 'utf8')
  await page.locator('#theme-editor [name="light.title"]').click()
  assert.equal(await picker.isVisible(), true, 'The same palette works inside the modal theme editor')
  await picker.locator('[data-colour="#1f4e9c"]').click()
  assert.equal(await page.locator('#theme-editor [name="light.title"]').inputValue(), '#1f4e9c')
  assert.equal(await readFile(file, 'utf8'), beforeTheme, 'Theme colours still require Apply to deck')
  await page.locator('#theme-editor [name="light.accent"]').click()
  assert.equal(await picker.locator('[data-colour="#1f4e9c"]').count(), 2, 'An unsaved theme choice is immediately reusable from the deck-colour row')
  await picker.getByLabel('Custom colour', { exact: true }).fill('#234567')
  assert.equal(await page.locator('#theme-editor [name="light.accent"]').inputValue(), '#234567', 'Custom colours remain available')
  await page.click('#theme-close')
  assert.equal(await readFile(file, 'utf8'), beforeTheme)

  await page.setViewportSize({ width: 760, height: 700 })
  await object('body').click(); await page.locator('#style-form [name="color"]').click()
  const rect = await picker.boundingBox()
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 760 && rect.y + rect.height <= 700, 'Palette stays inside a narrow viewport')
  await page.screenshot({ path: 'dist/validation/colour-picker-narrow.png' })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.locator('#style-form [name="color"]').click()
  await page.screenshot({ path: 'dist/validation/colour-picker.png' })
  assert.deepEqual(errors, [])
  console.log('Colour palette browser checks passed: deck and fixed swatches, keyboard/cancel, persistence/undo, line/fill, theme preview, custom colours and narrow layout.')
} finally {
  await browser?.close(); await app?.close(); await rm(dir, { recursive: true, force: true })
}
