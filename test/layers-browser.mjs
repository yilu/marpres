import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-layers-')), file = join(dir, 'deck.md')
let source = `---
marp: true
theme: marpres
---
# Overlapping objects

::: figure id=back position=absolute dx=220 dy=220 width=320
![Covered image](image.svg)
:::

::: shape id=middle shape=rect dx=220 dy=220 width=320 height=160 fill=#ff0000 layer=0
:::

::: box id=front position=absolute dx=220 dy=220 width=320 height=160
Top text
:::

---
# Nested layers

:::: box id=parent position=absolute dx=220 dy=220 width=400 height=220
::: box id=child-low position=absolute dx=0 dy=0 width=180 height=80 layer=0
Lower child
:::
::: box id=child-high position=absolute dx=0 dy=0 width=180 height=80 layer=1 stage=1
Upper child
:::
::::

---
# Anonymous stacking context

:::: box position=absolute dx=220 dy=220 width=320 height=160 layer=0
::: box id=inside position=absolute dx=0 dy=0 width=320 height=160 layer=0
Inside anonymous group
:::
::::

::: box id=outside position=absolute dx=220 dy=220 width=320 height=160 layer=0
Cover outside group
:::
`
source += '\n---\n# Large layer list\n\n' + Array.from({ length: 101 }, (_, i) =>
  '::: box id=many-' + i + ' position=absolute dx=200 dy=200 width=200 layer=0\nItem ' + i + '\n:::\n').join('\n')
source += '\n---\n# Static anonymous stack\n\n::::: box id=static-parent position=absolute dx=220 dy=220 width=320 height=180\n:::: box layer=99\n::: box id=static-inside position=absolute dx=0 dy=0 width=320 height=160\nInside static group\n:::\n::::\n::: box id=static-cover position=absolute dx=0 dy=0 width=320 height=160 layer=0\nCover\n:::\n:::::\n'
await writeFile(file, source)
await writeFile(join(dir, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#00aa00"/></svg>')
let app, browser
try {
  app = await createDraftServer({ file, port: 0, ui: 'gui' })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(app.url)
  await page.waitForSelector('#deck .current-slide')
  assert.equal(await page.locator('#layers-tab').count(), 1, 'Layers tab is available without canvas selection')
  await page.click('#layers-tab')
  const row = id => page.locator('#layer-list [data-layer-id="' + id + '"]')
  const order = () => page.locator('#layer-list [data-layer-id]').evaluateAll(items => items.map(x => x.dataset.layerId))
  const object = id => page.locator('#deck .current-slide [data-edit-id="' + id + '"]')
  const saved = async action => {
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/api/'))
    await action(); const result = await response
    assert.equal(result.status(), 200, await result.text())
    await page.waitForFunction(() => !document.body.classList.contains('saving'))
  }
  const hit = () => object('back').evaluate(el => {
    const r = el.getBoundingClientRect()
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-edit-id]')?.dataset.editId
  })
  const geometry = async () => Promise.all(['back', 'middle', 'front'].map(id => object(id).getAttribute('data-edit-options').then(JSON.parse).then(o => ({ id, dx: o.dx, dy: o.dy, width: o.width, height: o.height }))))
  const originalGeometry = await geometry()
  assert.deepEqual(await order(), ['front', 'middle', 'back'])
  assert.equal(await hit(), 'front')
  await row('back').click()
  assert.equal(await row('back').getAttribute('aria-selected'), 'true', 'Fully covered image is selectable from the list')
  await saved(() => page.click('#layer-forward'))
  assert.deepEqual(await order(), ['front', 'back', 'middle'], 'Forward crosses just one object even when initial layer values tie')
  await saved(() => page.click('#layer-front'))
  assert.deepEqual(await order(), ['back', 'front', 'middle'])
  assert.equal(await hit(), 'back', 'Saved layer order changes the actual hit target')
  assert.deepEqual(await geometry(), originalGeometry, 'Layer changes preserve geometry')
  await saved(() => page.click('#undo'))
  assert.deepEqual(await order(), ['front', 'back', 'middle'])
  await saved(() => page.click('#redo'))
  assert.equal(await hit(), 'back')
  await saved(() => page.click('#layer-backward'))
  assert.deepEqual(await order(), ['front', 'back', 'middle'])
  await saved(() => page.click('#layer-back'))
  assert.deepEqual(await order(), ['front', 'middle', 'back'])
  await row('front').click(); await row('middle').click({ modifiers: ['Shift'] })
  const beforeGroup = await readFile(file, 'utf8')
  await saved(() => page.click('#layer-back'))
  assert.deepEqual(await order(), ['back', 'front', 'middle'], 'Selected group keeps its internal order')
  await saved(() => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), beforeGroup, 'Multi-selection is one undo transaction')
  await row('back').click(); await saved(() => page.click('#layer-front'))
  await page.reload(); await page.waitForSelector('#deck .current-slide'); await page.click('#layers-tab')
  assert.deepEqual(await order(), ['back', 'front', 'middle'], 'Order persists through reload')
  await row('back').click(); await row('back').press('ArrowDown')
  assert.equal(await row('front').getAttribute('aria-selected'), 'true')
  assert.deepEqual(await geometry(), originalGeometry, 'List navigation does not nudge canvas geometry')
  await page.click('.slide-item[data-slide="2"]')
  assert.deepEqual(await order(), ['parent', 'child-high', 'child-low'])
  await page.selectOption('#stage-preview', '0')
  await row('child-high').click()
  assert.equal(await page.locator('#stage-preview').inputValue(), 'all', 'Selecting a hidden-stage object reveals it for editing')
  assert.equal(await row('child-high').getAttribute('aria-selected'), 'true')
  const parentBefore = await object('parent').getAttribute('data-edit-options')
  await row('child-low').click(); await saved(() => page.click('#layer-forward'))
  assert.deepEqual(await order(), ['parent', 'child-low', 'child-high'])
  assert.equal(await object('parent').getAttribute('data-edit-options'), parentBefore, 'Child ordering stays within its parent')
  await page.click('#format-tab')
  assert.equal(await page.locator('#selected-controls').isVisible(), true)
  await page.click('#layers-tab')
  await page.click('.slide-item[data-slide="3"]')
  await row('inside').click()
  assert.equal(await page.locator('#layer-front').isDisabled(), true, 'A child cannot escape an anonymous CSS stacking context')
  await row('outside').click()
  await saved(() => page.click('#layer-back'))
  assert.equal(await object('inside').evaluate(el => {
    const r = el.getBoundingClientRect()
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-edit-id]')?.dataset.editId
  }), 'inside', 'Moving a root object behind an anonymous group changes the painted order')
  await saved(() => page.click('#undo'))
  await page.click('.slide-item[data-slide="4"]')
  await row('many-50').click()
  assert.equal(await page.locator('#layer-forward').isDisabled(), false, 'A one-object move works on a slide with more than 100 objects')
  await saved(() => page.click('#layer-forward'))
  const largeOrder = await order()
  assert.ok(largeOrder.indexOf('many-50') < largeOrder.indexOf('many-51'))
  await page.click('.slide-item[data-slide="5"]')
  assert.deepEqual(await order(), ['static-parent', 'static-cover', 'static-inside'], 'Static anonymous boxes use actual stack level zero, not an ignored z-index')
  if (process.env.LAYERS_SCREENSHOT) await page.screenshot({ path: process.env.LAYERS_SCREENSHOT })
  await page.setViewportSize({ width: 900, height: 700 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log('Layer browser checks passed: covered selection, all four moves, painted order, geometry, undo/redo, persistence, keyboard, stages and nested groups.')
} finally { await browser?.close(); await app?.close(); await rm(dir, { recursive: true, force: true }) }
