import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marp-gui-browser-'))
const file = join(dir, 'deck.md')
await writeFile(file, `---
marp: true
theme: nju-unofficial-v2
---
# A visual workspace

::: box id=words position=absolute dx=120 dy=150 width=400
Select these words and keep $x^2$.
:::

::: box id=later position=absolute dx=120 dy=260 width=400 stage=2
Second reveal.
:::

::: caption id=last position=absolute dx=120 dy=350 width=400 stage=4
Final reveal.
:::

::: figure id=picture position=absolute dx=700 dy=180 width=320
![Four colours](quadrants.svg)
:::

::: shape id=shape-a shape=rect dx=150 dy=500 width=80 height=60 fill=#dce8f5
:::
::: shape id=shape-b shape=ellipse dx=450 dy=470 width=160 height=90 fill=#eee1f5
:::
::: shape id=shape-c shape=diamond dx=850 dy=520 width=120 height=80 fill=#e1efde
:::

---
# Second slide

::: box id=second position=absolute dx=120 dy=160 width=400
Second slide text.
:::
`)
await writeFile(join(dir, 'quadrants.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><path d="M0 0H800V500H0Z" fill="#287fb8"/><path d="M800 0H1600V500H800Z" fill="#e0ad38"/><path d="M0 500H800V1000H0Z" fill="#71a77c"/><path d="M800 500H1600V1000H800Z" fill="#a85d7d"/></svg>')
let browser, app
try {
  app = await createDraftServer({ file, port: 0, ui: 'gui' })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(app.url)
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
  assert.equal(await page.locator('#slide-navigator').count(), 1, 'Independent GUI provides a slide navigator')
  assert.equal(await page.locator('#play').count(), 1, 'GUI provides presentation mode')
  assert.equal(await page.locator('#zoom-level').count(), 1, 'GUI provides explicit zoom')
  const object = id => page.locator(`#deck [data-edit-id="${id}"]`)
  const options = id => object(id).evaluate(element => JSON.parse(element.dataset.editOptions))
  const saved = async action => {
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/') && !response.url().endsWith('/api/theme-preview'))
    await action()
    const response = await pending
    assert.equal(response.status(), 200, await response.text())
    await page.waitForFunction(() => !document.body.classList.contains('saving'))
    return response.json()
  }
  const selectMany = async ids => {
    await object(ids[0]).click()
    for (const id of ids.slice(1)) await object(id).click({ modifiers: ['Shift'] })
    assert.equal(await page.locator('#deck .is-selected').count(), ids.length)
  }
  const drag = async (target, dx, dy) => {
    const box = await target.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 7 })
    await page.mouse.up()
  }
  const atZoom = async value => {
    await page.selectOption('#zoom-level', String(value))
    await page.waitForFunction(expected => Math.abs(document.querySelector('#stage').getBoundingClientRect().width / 1280 - expected) < .001, value / 100)
  }
  const bounds = async ids => Promise.all(ids.map(id => object(id).boundingBox()))
  const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1, `${message}: ${a} vs ${b}`)
  assert.equal(await page.locator('.slide-item').count(), 2)
  await object('words').click()
  const family = await object('words').evaluate(element => getComputedStyle(element).fontFamily.replace(/["']/g, ''))
  assert.equal(await page.locator('#font-family').inputValue(), family)
  const fontBox = await page.locator('#font-family').boundingBox(), colourBox = await page.locator('#style-form [name="color"]').boundingBox()
  close(fontBox.y, colourBox.y, 'Text controls share a horizontal toolbar')
  await page.locator('#geometry-form [name="width"]').fill('430')
  await saved(() => page.locator('#geometry-form button[type="submit"]').click())
  assert.equal((await options('words')).font, undefined, 'Geometry preserves inherited font')
  assert.equal((await options('words')).height, undefined, 'Changing width preserves natural text height')
  await saved(() => page.locator('#style-form [name="bold"]').check())
  assert.equal((await options('words')).bold, true)
  assert.equal((await options('words')).font_family, undefined, 'Bold leaves inherited font family alone')
  await saved(() => page.locator('#reset-text-style').click())
  const text = page.locator('#content-editor')
  await text.fill('Draft keeps $x^2$ and selected words.')
  await text.evaluate(element => { element.focus(); element.setSelectionRange(22, 30) })
  await page.locator('[data-format="italic"]').click()
  assert.equal(await text.inputValue(), 'Draft keeps $x^2$ and *selected* words.')
  await text.fill('Draft keeps $x^2$ and selected words.')
  await text.evaluate(element => { element.focus(); element.setSelectionRange(22, 30) })
  await page.locator('#style-form [name="bold"]').click()
  assert.equal(await text.inputValue(), 'Draft keeps $x^2$ and **selected** words.', 'Upper toolbar formats selected words')
  await object('later').click()
  await object('words').click()
  assert.match(await text.inputValue(), /\*\*selected\*\*/, 'Draft survives selection')
  await atZoom(50)
  const beforePlay = await readFile(file, 'utf8')
  await page.click('#play')
  await page.waitForSelector('body.presenting')
  assert.notEqual(await readFile(file, 'utf8'), beforePlay, 'Play saves valid pending drafts')
  assert.equal(await object('later').isVisible(), false)
  assert.equal(await object('last').isVisible(), false)
  assert.equal(await page.locator('.command-bar').isVisible(), false)
  assert.equal(await page.locator('#guides').isVisible(), false)
  await page.keyboard.press('ArrowRight')
  assert.equal(await object('later').isVisible(), true)
  assert.equal(await object('last').isVisible(), false)
  await page.keyboard.press('Space')
  assert.equal(await object('last').isVisible(), true)
  await page.keyboard.press('ArrowRight')
  assert.match(await page.locator('#presentation-position').textContent(), /2 \/ 2/)
  await page.keyboard.press('ArrowLeft')
  assert.match(await page.locator('#presentation-position').textContent(), /1 \/ 2.*4/)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('body.presenting').count(), 0)
  assert.equal(await page.locator('#zoom-level').inputValue(), '50')
  assert.equal(await object('words').evaluate(element => element.classList.contains('is-selected')), true)
  assert.equal(await page.locator('#stage-preview').inputValue(), 'all')

  // Explicit zoom scales pointer edits, rather than source coordinates.
  for (const zoom of [50, 100, 200]) {
    await atZoom(zoom)
    await object('words').scrollIntoViewIfNeeded()
    await object('words').click()
    const before = await options('words')
    await saved(() => drag(object('words'), 12 * zoom / 100, 8 * zoom / 100))
    close((await options('words')).dx, before.dx + 12, `Dragging at ${zoom}% preserves slide units`)
    close((await options('words')).dy, before.dy + 8, `Dragging at ${zoom}% preserves slide units`)
  }
  await atZoom(200)
  const beforePanSource = await readFile(file, 'utf8')
  await page.locator('#workspace').evaluate(element => { element.scrollLeft = 200; element.scrollTop = 100 })
  const workspace = await page.locator('#workspace').boundingBox()
  const panBefore = await page.locator('#workspace').evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))
  await page.locator('#workspace').focus()
  await page.keyboard.down('Space')
  await page.mouse.move(workspace.x + workspace.width / 2, workspace.y + workspace.height / 2)
  await page.mouse.down()
  await page.mouse.move(workspace.x + workspace.width / 2 - 80, workspace.y + workspace.height / 2 - 40, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  const panAfter = await page.locator('#workspace').evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))
  close(panAfter.left, panBefore.left + 80, 'Space-drag pans horizontally')
  close(panAfter.top, panBefore.top + 40, 'Space-drag pans vertically')
  assert.equal(await readFile(file, 'utf8'), beforePanSource, 'Panning does not alter slide geometry')
  await object('picture').dblclick()
  const cropBefore = await page.locator('.crop-window').boundingBox()
  await drag(page.locator('[data-crop-handle="w"]'), 40, 0)
  close((await page.locator('.crop-window').boundingBox()).width, cropBefore.width - 40, 'Crop respects 200% zoom')
  await saved(() => page.click('#apply-direct-crop'))
  close((await options('picture')).width, 300, 'Crop commits source-pixel width')
  await atZoom(50)

  const shapeIds = ['shape-a', 'shape-b', 'shape-c']
  await selectMany(shapeIds)
  assert.equal(await page.locator('#style-form').isHidden(), true, 'Mixed/group selection does not offer ambiguous style edits')
  for (const alignment of ['left', 'center']) {
    await saved(() => page.locator(`[data-align="${alignment}"]`).click())
    const rectangles = await bounds(shapeIds)
    for (const rect of rectangles.slice(1)) close(rect.x + (alignment === 'center' ? rect.width / 2 : 0), rectangles[0].x + (alignment === 'center' ? rectangles[0].width / 2 : 0), `Horizontal ${alignment} alignment`)
    await saved(() => page.click('#undo'))
  }
  let beforeArrangement = await readFile(file, 'utf8')
  await saved(() => page.locator('[data-align="top"]').click())
  let rectangles = await bounds(shapeIds)
  close(rectangles[0].y, rectangles[1].y, 'Top alignment')
  close(rectangles[1].y, rectangles[2].y, 'Top alignment')
  await saved(() => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), beforeArrangement, 'One undo restores all aligned objects')
  await saved(() => page.locator('[data-align="middle"]').click())
  rectangles = await bounds(shapeIds)
  close(rectangles[0].y + rectangles[0].height / 2, rectangles[1].y + rectangles[1].height / 2, 'Vertical centre alignment')
  await saved(() => page.locator('[data-align="bottom"]').click())
  rectangles = await bounds(shapeIds)
  close(rectangles[0].y + rectangles[0].height, rectangles[2].y + rectangles[2].height, 'Bottom alignment')
  await saved(() => page.locator('[data-distribute="horizontal"]').click())
  rectangles = await bounds(shapeIds)
  close(rectangles[1].x - rectangles[0].x - rectangles[0].width, rectangles[2].x - rectangles[1].x - rectangles[1].width, 'Unequal widths receive equal horizontal gaps')
  const groupBefore = await Promise.all(shapeIds.map(options))
  await saved(() => drag(object('shape-b'), 10, -7))
  const groupAfter = await Promise.all(shapeIds.map(options))
  for (let i = 0; i < 3; i++) {
    close(groupAfter[i].dx, groupBefore[i].dx + 20, 'Group drag moves each object in slide units')
    close(groupAfter[i].dy, groupBefore[i].dy - 14, 'Group drag moves each object in slide units')
  }
  await saved(() => page.click('#undo'))
  assert.deepEqual(await Promise.all(shapeIds.map(options)), groupBefore, 'Group drag is a single undo step')
  await selectMany(['picture', 'shape-a'])
  await saved(() => page.locator('[data-align="right"]').click())
  const figure = await object('picture').evaluate(element => { const r = (element.querySelector('.figure-frame') ?? element).getBoundingClientRect(); return { x: r.x, width: r.width } }), shape = await object('shape-a').boundingBox()
  close(figure.x + figure.width, shape.x + shape.width, 'Alignment uses the visible cropped image frame')
  await saved(() => page.click('#undo'))

  // Marquee selection is anchored to the scaled canvas.
  await page.click('#zoom-fit')
  await page.keyboard.press('Escape')
  rectangles = await bounds(shapeIds)
  const left = Math.min(...rectangles.map(rect => rect.x)) - 8, top = Math.min(...rectangles.map(rect => rect.y)) - 8
  const right = Math.max(...rectangles.map(rect => rect.x + rect.width)) + 8, bottom = Math.max(...rectangles.map(rect => rect.y + rect.height)) + 8
  await page.mouse.move(left, top); await page.mouse.down(); await page.mouse.move(right, bottom, { steps: 8 }); await page.mouse.up()
  assert.equal(await page.locator('#deck .is-selected').count(), 3, 'Drag on empty canvas selects multiple objects')
  await saved(() => page.locator('[data-distribute="vertical"]').click())
  rectangles = (await bounds(shapeIds)).sort((a, b) => a.y - b.y)
  close(rectangles[1].y - rectangles[0].y - rectangles[0].height, rectangles[2].y - rectangles[1].y - rectangles[1].height, 'Unequal heights receive equal vertical gaps')

  await page.click('#shape-menu-toggle')
  assert.equal(await page.locator('.shape-group').count(), 3)
  assert.ok(await page.locator('[data-shape]').count() >= 30)
  const inserted = await saved(() => page.locator('[data-shape="heart"]').click())
  assert.equal((await options(inserted.selectedId)).shape, 'heart')
  await saved(() => page.click('#bring-front'))
  assert.ok((await options(inserted.selectedId)).layer > 1)
  await saved(() => page.click('#delete-shape'))
  const insertedText = await saved(() => page.click('#insert-text'))
  assert.equal(await text.evaluate(element => document.activeElement === element), true)
  await text.fill('Written inside the GUI.')
  await saved(() => page.click('#save-content'))
  assert.equal(await object(insertedText.selectedId).innerText(), 'Written inside the GUI.')
  await saved(() => page.locator('#image-file').setInputFiles(join(dir, 'quadrants.svg')))
  assert.equal(await page.locator('#crop-form').isVisible(), true)

  const originalSlides = await readFile(file, 'utf8')
  await saved(() => page.click('[data-slide-action="add"]'))
  assert.equal(await page.locator('.slide-item').count(), 3)
  assert.equal(await page.locator('#page-label').textContent(), '2 / 3')
  await page.locator('#slide-title').fill('Created in Studio')
  await saved(() => page.locator('#slide-title').press('Enter'))
  await saved(() => page.click('[data-slide-action="duplicate"]'))
  assert.equal(await page.locator('.slide-item').count(), 4)
  await page.locator('#slide-title').fill('Duplicate in Studio')
  await saved(() => page.locator('#slide-title').press('Enter'))
  await saved(() => page.click('[data-slide-action="move-up"]'))
  assert.equal(await page.locator('#page-label').textContent(), '2 / 4')
  await saved(() => page.click('[data-slide-action="delete"]'))
  assert.equal(await page.locator('.slide-item').count(), 3)
  await saved(() => page.click('#undo'))
  assert.equal(await page.locator('.slide-item').count(), 4)
  await saved(() => page.click('#undo'))
  await saved(() => page.click('#undo'))
  await saved(() => page.click('#undo'))
  await saved(() => page.click('#undo'))
  await saved(() => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), originalSlides, 'Slide actions are fully undoable')

  await page.locator('.slide-item[data-slide="1"]').click()
  await object('words').click()
  await text.fill('Export saves pending text, including $x^2$.')
  const downloadPromise = page.waitForEvent('download')
  await page.click('#export-pdf')
  const download = await downloadPromise
  const pdf = await readFile(await download.path())
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 4, 'PDF includes all reveal stages')
  assert.match(await readFile(file, 'utf8'), /Export saves pending text/)
  await page.waitForFunction(() => !document.body.classList.contains('saving'))
  if (process.env.GUI_SCREENSHOT) await page.screenshot({ path: process.env.GUI_SCREENSHOT })
  await page.setViewportSize({ width: 900, height: 700 })
  await page.waitForTimeout(100)
  assert.equal(await page.locator('#play').isVisible(), true)
  assert.equal(await page.locator('#zoom-level').isVisible(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Narrow viewport has no page overflow')
  if (process.env.GUI_NARROW_SCREENSHOT) await page.screenshot({ path: process.env.GUI_NARROW_SCREENSHOT })

  // Source navigation follows object selection in both directions and live edits.
  await page.setViewportSize({ width: 1500, height: 980 })
  await page.click('#go-to-source')
  assert.equal(await page.locator('#source-pane').isVisible(), true)
  let current = await page.evaluate(() => fetch('/api/deck').then(response => response.json()))
  let wordsSource = current.objects.find(object => object.id === 'words')
  assert.equal(await page.locator(`.source-line[data-line="${wordsSource.line}"]`).evaluate(element => element.classList.contains('is-source-selected')), true)
  assert.match(await page.locator('#open-vscode').getAttribute('href'), /vscode:\/\/file.*deck\.md:\d+:1$/)
  const secondSource = current.objects.find(object => object.id === 'second')
  await page.locator(`.source-line[data-line="${secondSource.line}"]`).click()
  assert.equal(await page.locator('#page-label').textContent(), '2 / 2')
  assert.equal(await object('second').evaluate(element => element.classList.contains('is-selected')), true)
  await page.locator('#geometry-form [name="width"]').fill('444')
  await saved(() => page.locator('#geometry-form button[type="submit"]').click())
  assert.match(await page.locator('.source-line.is-source-selected').first().textContent(), /width=444/)
  if (process.env.GUI_SOURCE_SCREENSHOT) await page.screenshot({ path: process.env.GUI_SOURCE_SCREENSHOT })
  await page.click('#source-close')

  // Shared master styles, coordinated slide appearances and portable presets.
  await page.click('#theme-toggle')
  assert.equal(await page.locator('#theme-dialog').isVisible(), true)
  await page.locator('#theme-editor [name="body_size"]').fill('30')
  await page.locator('#theme-editor [name="title_size"]').fill('44')
  await page.click('[data-theme-tab="advanced"]')
  await page.locator('#theme-css').fill('.box { letter-spacing: 0.2px; }')
  await saved(() => page.click('#theme-apply'))
  assert.equal(await page.locator('#theme-dialog').isVisible(), false)
  assert.equal(await object('second').evaluate(element => getComputedStyle(element).fontSize), '30px')
  assert.equal(await page.locator('#deck .current-slide h1').evaluate(element => getComputedStyle(element).fontSize), '44px')
  await saved(() => page.selectOption('#slide-appearance', 'dark'))
  assert.equal(await page.locator('#slide-appearance').inputValue(), 'dark')
  assert.equal(await page.locator('#deck .current-slide section').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(23, 20, 29)')
  await page.locator('.slide-item[data-slide="1"]').click()
  assert.equal(await page.locator('#slide-appearance').inputValue(), 'inherit')
  assert.equal(await page.locator('#deck .current-slide section').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)')
  await page.click('#theme-toggle')
  await page.click('[data-theme-tab="colours"]')
  if (process.env.GUI_THEME_SCREENSHOT) await page.screenshot({ path: process.env.GUI_THEME_SCREENSHOT })
  const presetDownloadPromise = page.waitForEvent('download')
  await page.click('#theme-export')
  const presetDownload = await presetDownloadPromise
  const preset = JSON.parse(await readFile(await presetDownload.path(), 'utf8'))
  assert.equal(preset.theme.body_size, 30)
  assert.equal(preset.css, '.box { letter-spacing: 0.2px; }')
  preset.theme.body_size = 29
  await writeFile(join(dir, 'theme.json'), JSON.stringify(preset))
  await page.locator('#theme-file').setInputFiles(join(dir, 'theme.json'))
  await page.click('[data-theme-tab="type"]')
  assert.equal(await page.locator('#theme-editor [name="body_size"]').inputValue(), '29')
  await saved(() => page.click('#theme-apply'))
  await object('words').click()
  assert.equal(await object('words').evaluate(element => getComputedStyle(element).fontSize), '29px')
  await page.click('#theme-toggle')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#theme-dialog').isVisible(), false)
  assert.equal(await object('words').evaluate(element => element.classList.contains('is-selected')), true, 'Closing a theme dialog preserves the canvas selection')

  // Stale drafts remain available and block presentation until explicitly resolved.
  await text.fill('Unsaved local draft.')
  await writeFile(file, (await readFile(file, 'utf8')).replace('Export saves pending text, including $x^2$.', 'External text edit.'))
  await page.waitForSelector('body.conflicted')
  await page.click('#reload')
  await page.waitForFunction(() => !document.body.classList.contains('saving') && !document.body.classList.contains('conflicted'))
  await page.click('#play')
  assert.equal(await page.locator('body.presenting').count(), 0)
  assert.equal(await text.inputValue(), 'Unsaved local draft.')
  assert.equal(await page.locator('#keep-content').isVisible(), true)
  await page.click('#keep-content')
  await page.click('#play')
  await page.waitForSelector('body.presenting')
  await page.keyboard.press('Escape')
  assert.match(await readFile(file, 'utf8'), /Unsaved local draft/)
  assert.deepEqual(errors, [])
  console.log('GUI browser checks passed: horizontal formatting, drafts and conflicts, stage Play/restore, 50/100/200% geometry, crop at zoom, Shift-click/marquee, six alignment positions and equal gaps, atomic group drag/undo, shapes/text/images, layers, slide management, four-page PDF, source links/navigation/live updates, shared theme/CSS/light-dark/presets, and narrow viewport.')
} catch (error) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: '/tmp/marp-gui-failure.png' }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await app?.close()
  await rm(dir, { recursive: true, force: true })
}
