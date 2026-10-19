import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-title-style-')), file = join(dir, 'deck.md')
const source = '---\nmarp: true\ntheme: marpres\n---\n<!-- _class: title-slide -->\n# A cover with $x^2$\n\n::: box id=author align=center\nAuthor name\n:::\n\n::: box id=affiliation align=center\nUniversity\n:::\n\n---\n# Ordinary title\n'
await writeFile(file, source)
let browser, app
try {
  app = await createDraftServer({ file, port: 0 })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(app.url)
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
  const styles = element => { const s = getComputedStyle(element); return { size: s.fontSize, weight: s.fontWeight, family: s.fontFamily } }
  const saved = async action => {
    const response = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/(theme|edit|undo)$/.test(new URL(r.url()).pathname))
    await action(); assert.equal((await response).status(), 200)
    await page.waitForFunction(() => !document.body.classList.contains('saving'))
  }
  await page.click('#theme-toggle')
  const field = name => page.locator(`#theme-editor [name="${name}"]`)
  assert.equal(await field('cover_title_size').count(), 1, 'Theme exposes a separate cover title size')
  assert.equal(await field('cover_title_size').inputValue(), '49')
  assert.equal(await field('cover_title_weight').inputValue(), '400')
  assert.match(await field('cover_title_font_family').inputValue(), /PingFang SC/)
  await field('cover_title_size').fill('64')
  await field('cover_title_weight').selectOption('700')
  await field('cover_title_font_family').fill('Georgia, serif')
  await page.locator('label[for="theme-cover_title_size"]').click()
  assert.equal(await field('cover_title_size').inputValue(), '64', 'Clicking a field label must not reset its override')
  assert.equal(await field('cover_title_size').evaluate(element => document.activeElement === element), true)
  const preview = page.frameLocator('#theme-preview-frame')
  await page.waitForFunction(() => document.querySelector('#theme-preview-status').textContent === 'Preview up to date')
  const cover = preview.locator('section.title-slide .deck-heading h1')
  assert.deepEqual(await cover.evaluate(styles), { size: '64px', weight: '700', family: 'Georgia, serif' })
  assert.equal(await readFile(file, 'utf8'), source, 'Preview does not change the deck')
  await saved(() => page.click('#theme-apply'))
  assert.deepEqual(await page.locator('#deck section.title-slide h1').evaluate(styles), { size: '64px', weight: '700', family: 'Georgia, serif' })
  assert.equal((await page.locator('#deck section:not(.title-slide) h1').evaluate(styles)).size, '47.84px', 'Cover size does not change ordinary titles')
  assert.equal((await page.locator('#deck [data-edit-id="author"]').evaluate(styles)).size, '26px')

  // Name/affiliation continue using the normal per-object toolbar.
  await page.locator('#deck [data-edit-id="author"]').click()
  await page.locator('#font-field input').fill('34')
  await saved(() => page.locator('#font-field input').press('Enter'))
  await saved(() => page.locator('#style-form [name="bold"]').check())
  await page.locator('#font-family').fill('Arial, sans-serif')
  await saved(() => page.locator('#font-family').press('Tab'))
  assert.deepEqual(await page.locator('#deck [data-edit-id="author"]').evaluate(styles), { size: '34px', weight: '700', family: 'Arial, sans-serif' })
  assert.equal((await page.locator('#deck [data-edit-id="affiliation"]').evaluate(styles)).size, '26px')
  for (let n = 0; n < 3; n++) await saved(() => page.click('#undo'))

  await page.click('#theme-toggle')
  assert.equal(await field('cover_title_size').inputValue(), '64', 'Saved override survives reopening')
  await page.locator('[data-reset-type="cover_title_size"]').click()
  await page.locator('[data-reset-type="cover_title_font_family"]').click()
  await page.locator('[data-reset-type="cover_title_weight"]').click()
  await field('title_size').fill('55')
  await field('title_font_family').fill('Arial, sans-serif')
  await field('title_weight').selectOption('600')
  assert.equal(await field('cover_title_size').inputValue(), '56.3336', 'Reset cover sizing follows shared title size')
  assert.equal(await field('cover_title_font_family').inputValue(), 'Arial, sans-serif')
  assert.equal(await field('cover_title_weight').inputValue(), '600')
  await saved(() => page.click('#theme-apply'))
  const inherited = await page.locator('#deck section.title-slide h1').evaluate(styles)
  assert.ok(Math.abs(parseFloat(inherited.size) - 56.3336) < .001)
  assert.equal(inherited.weight, '600')
  assert.equal(inherited.family, 'Arial, sans-serif')
  await saved(() => page.click('#undo'))
  await saved(() => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), source, 'Undo restores the original deck exactly')
  assert.deepEqual(errors, [])
  console.log('Title style browser checks passed: cover preview/apply, independent typography, inheritance/reset, author formatting, and exact Undo.')
} finally {
  await browser?.close(); await app?.close(); await rm(dir, { recursive: true, force: true })
}
