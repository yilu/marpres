import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-multi-format-')), file = join(dir, 'deck.md')
const original = `---
marp: true
theme: marpres
---
# Shared formatting

::: box id=a position=absolute dx=120 dy=150 width=300 font=24 color=#b8361f bold=true font_family=Arial align=left
First text
:::

::: box id=b position=absolute dx=520 dy=150 width=300 font=30 color=#1f4e9c font_family=Georgia align=right
Second text
:::

::: shape id=c shape=rect dx=120 dy=350 width=250 height=100 stroke=#b8361f stroke_width=2 fill=none rotate=0
:::

::: shape id=d shape=ellipse dx=520 dy=350 width=200 height=100 stroke=#1f4e9c stroke_width=5 fill=#cc79a7 rotate=20
:::
`
await writeFile(file, original)
await mkdir('dist/validation', { recursive: true })
let app, browser
try {
  app = await createDraftServer({ file, port: 0 })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(app.url); await page.waitForSelector('#deck .current-slide')
  const object = id => page.locator(`#deck .current-slide [data-edit-id="${id}"]`)
  const options = async id => JSON.parse(await object(id).getAttribute('data-edit-options'))
  const select = async ids => {
    await page.keyboard.press('Escape'); await object(ids[0]).click()
    for (const id of ids.slice(1)) await object(id).click({ modifiers: ['Shift'] })
  }
  const saved = async (path, action) => {
    const pending = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(path))
    await action(); const response = await pending
    assert.equal(response.status(), 200, await response.text())
    await page.waitForFunction(() => !document.body.classList.contains('saving'))
  }
  const snapshot = async ids => Promise.all(ids.map(options))
  const colour = async (field, value) => {
    await page.locator(field).click()
    await page.locator(`#colour-picker [data-colour="${value}"]`).first().click()
  }
  await select(['a', 'b'])
  assert.equal(await page.locator('#style-form').isVisible(), true, 'Two text boxes retain the basic formatting toolbar')
  assert.equal(await page.locator('#style-form [name="color"]').isEnabled(), true)
  assert.equal(await page.getByLabel('Font size', { exact: true }).isEnabled(), true)
  assert.equal(await page.getByLabel('Font size', { exact: true }).inputValue(), '')
  assert.equal(await page.locator('#style-form [name="bold"]').evaluate(e => e.indeterminate), true)
  assert.equal(await page.locator('#content-form').isVisible(), false, 'Batch formatting does not expose a shared text-content editor')
  await page.screenshot({ path: 'dist/validation/multi-text-format.png' })
  const initial = await snapshot(['a', 'b'])
  await saved('/api/batch', () => colour('#style-form [name="color"]', '#b8361f'))
  const coloured = await snapshot(['a', 'b'])
  for (let i = 0; i < 2; i++) assert.deepEqual(coloured[i], { ...initial[i], color: '#b8361f' }, 'Only the selected property changes, even when the chosen colour already belongs to one object')
  assert.equal(await page.locator('#deck .is-selected').count(), 2)
  await saved('/api/undo', () => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), original, 'One Undo restores the entire batch byte-for-byte')
  await saved('/api/batch', async () => { await page.getByLabel('Font size', { exact: true }).fill('32'); await page.getByLabel('Font size', { exact: true }).press('Tab') })
  for (const [i, value] of (await snapshot(['a', 'b'])).entries()) assert.deepEqual(value, { ...initial[i], font: 32 })
  await saved('/api/batch', () => page.locator('#style-form [name="bold"]').check())
  for (const value of await snapshot(['a', 'b'])) assert.equal(value.bold, true)
  await saved('/api/batch', () => page.locator('#style-form [name="align"]').selectOption('center'))
  for (const value of await snapshot(['a', 'b'])) assert.equal(value.align, 'center')
  const beforeReset = await readFile(file, 'utf8')
  await saved('/api/batch', () => page.click('#reset-text-style'))
  for (const value of await snapshot(['a', 'b'])) for (const key of ['font', 'color', 'font_family', 'bold', 'align']) assert.equal(value[key], undefined)
  await saved('/api/undo', () => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), beforeReset)

  await select(['c', 'd'])
  assert.equal(await page.locator('#shape-form').isVisible(), true)
  assert.equal(await page.locator('#delete-shape').isDisabled(), true)
  const shapes = await snapshot(['c', 'd']), beforeShape = await readFile(file, 'utf8')
  await colour('#shape-form [name="stroke"]', '#7a005f')
  await page.getByRole('button', { name: 'Choose fill colour', exact: true }).click()
  await page.locator('#colour-picker').getByRole('button', { name: 'No fill', exact: true }).click()
  assert.equal(await readFile(file, 'utf8'), beforeShape, 'Batch shapes preserve the existing Apply step')
  await saved('/api/batch', () => page.locator('#shape-form button[type="submit"]').click())
  for (const [i, value] of (await snapshot(['c', 'd'])).entries()) assert.deepEqual(value, { ...shapes[i], stroke: '#7a005f', fill: 'none' }, 'Different widths, rotations, positions and geometry remain intact')
  await saved('/api/undo', () => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), beforeShape)

  await select(['a', 'c'])
  assert.equal(await page.locator('#style-form').isVisible(), false)
  assert.equal(await page.locator('#shape-form').isVisible(), false)
  assert.equal(await page.locator('[data-align="left"]').isEnabled(), true, 'Mixed types retain arrangement tools')
  await select(['a'])
  await page.locator('#content-editor').fill('Unsaved personal draft')
  await object('b').click({ modifiers: ['Shift'] })
  await saved('/api/batch', () => colour('#style-form [name="color"]', '#009e73'))
  await select(['a'])
  assert.equal(await page.locator('#content-editor').inputValue(), 'Unsaved personal draft')
  assert.match(await readFile(file, 'utf8'), /First text/, 'Batch formatting preserves unsubmitted text drafts')
  await page.setViewportSize({ width: 900, height: 750 }); await select(['a', 'b'])
  await page.screenshot({ path: 'dist/validation/multi-text-format-narrow.png' })
  assert.deepEqual(errors, [])
  console.log('Multi-format browser checks passed: mixed fields, text styles/font/reset, shape styles, atomic undo, retained selection, untouched geometry/drafts and mixed-type arrangement.')
} finally { await browser?.close(); await app?.close(); await rm(dir, { recursive: true, force: true }) }
