import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-axis-drag-'))
const file = join(dir, 'deck.md')
await writeFile(file, `---
marp: true
theme: marpres
---
# Axis-constrained movement

::: box id=words position=absolute dx=120 dy=170 width=160
Drag me
:::

::: figure id=picture position=absolute dx=700 dy=190 width=220 crop=25,0,50,100
![](picture.svg)
:::

::: shape id=shape shape=rect dx=400 dy=440 width=100 height=60 rotate=25 fill=#e3d8ec
:::

::: shape id=shape-parallel shape=rect dx=650 dy=500 width=100 height=60 rotate=25 fill=#d8e4ec
:::

::: box id=guide position=absolute dx=560 dy=172 width=160
Snap target
:::
`)
await writeFile(join(dir, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><path fill="#8eaabe" d="M0 0H400V200H0Z"/></svg>')
let app, browser
try {
  app = await createDraftServer({ file, port: 0 })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(app.url)
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
  await page.selectOption('#zoom-level', '50')
  const object = id => page.locator(`#deck [data-edit-id="${id}"]`)
  const options = id => object(id).evaluate(e => JSON.parse(e.dataset.editOptions))
  const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < .1, `${message}: ${actual} vs ${expected}`)
  const saved = async action => {
    const response = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/(edit|batch|undo)$/.test(r.url()))
    await action()
    assert.equal((await response).status(), 200)
    await page.waitForFunction(() => !document.body.classList.contains('saving'))
  }
  const undo = () => saved(() => page.click('#undo'))
  const shiftClick = async id => {
    // Selected groups have a drag surface over their members; use the real
    // pointer path, allowing Moveable to resolve the object beneath it.
    const r = await object(id).boundingBox()
    await page.keyboard.down('Shift')
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
    await page.keyboard.up('Shift')
  }
  const begin = async (id, shift = false) => {
    const r = await object(id).boundingBox()
    const origin = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    await page.mouse.move(origin.x, origin.y)
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.down()
    return origin
  }
  const move = (origin, dx, dy) => page.mouse.move(origin.x + dx / 2, origin.y + dy / 2, { steps: 5 })
  const finish = () => saved(async () => { await page.mouse.up(); await page.keyboard.up('Shift') })
  const liveOffset = id => object(id).evaluate(e => {
    const matrix = new DOMMatrix(getComputedStyle(e).transform)
    return { dx: matrix.m41, dy: matrix.m42 }
  })

  await object('words').click()
  let original = await readFile(file, 'utf8')
  let origin = await begin('words', true)
  await move(origin, 80, 30)
  let live = await liveOffset('words')
  close(live.dx, 200, 'Shift-drag moves on the horizontal axis')
  close(live.dy, 170, 'Shift-drag preview keeps the other coordinate fixed')
  // Once chosen, the axis must not switch as the pointer crosses a diagonal.
  await move(origin, 90, 120)
  live = await liveOffset('words')
  close(live.dx, 210, 'Locked axis follows horizontal pointer distance')
  close(live.dy, 170, 'Axis remains horizontal while Shift stays held')
  await finish()
  close((await options('words')).dy, 170, 'Saved Markdown preserves the locked coordinate')
  await undo()
  assert.equal(await readFile(file, 'utf8'), original, 'One undo restores an entire constrained drag')

  // Shift-click still toggles membership, without saving or moving anything.
  await shiftClick('shape')
  assert.equal(await page.locator('#deck .is-selected').count(), 2)
  await shiftClick('shape')
  assert.equal(await page.locator('#deck .is-selected').count(), 1)
  assert.equal(await readFile(file, 'utf8'), original)

  // A cropped figure can be selected and dragged with Shift already held.
  await page.keyboard.press('Escape')
  origin = await begin('picture', true)
  await move(origin, 20, 70)
  await finish()
  close((await options('picture')).dx, 700, 'Cropped figure is locked vertically')
  close((await options('picture')).dy, 260, 'Cropped figure moves in slide coordinates at 50% zoom')
  assert.deepEqual((await options('picture')).crop, [25, 0, 50, 100])
  await undo()

  // Shift can be pressed, released, and re-pressed during the same drag.
  await object('words').click()
  origin = await begin('words')
  await move(origin, 20, 12)
  close((await liveOffset('words')).dy, 182, 'Ordinary drag remains free')
  await page.keyboard.down('Shift')
  await move(origin, 60, 24)
  close((await liveOffset('words')).dy, 170, 'Mid-drag Shift constrains to the drag origin')
  await page.keyboard.up('Shift')
  await move(origin, 70, 36)
  close((await liveOffset('words')).dy, 206, 'Releasing Shift restores free movement')
  await page.keyboard.down('Shift')
  await page.mouse.move(origin.x + 15, origin.y + 45)
  live = await liveOffset('words')
  close(live.dx, 120, 'Re-pressing Shift can choose the other axis')
  close(live.dy, 260, 'Second lock is vertical')
  await finish()
  await undo()

  // Snapping may adjust the active axis, but cannot pull the locked axis off it.
  await page.check('#snap')
  await object('words').click()
  origin = await begin('words', true)
  await move(origin, 438, 3)
  live = await liveOffset('words')
  close(live.dy, 170, 'Nearby horizontal guide cannot defeat the axis lock')
  close(live.dx, 560, 'Snapping is retained on the active axis')
  await finish()
  await undo()
  await page.uncheck('#snap')

  // The entire multi-selection moves by one constrained delta, including rotation.
  await shiftClick('shape')
  const groupBefore = await Promise.all(['words', 'shape'].map(options))
  origin = await begin('shape', true)
  await move(origin, 24, -60)
  await finish()
  const groupAfter = await Promise.all(['words', 'shape'].map(options))
  for (let i = 0; i < groupBefore.length; i++) {
    close(groupAfter[i].dx, groupBefore[i].dx, 'Group member keeps its horizontal position')
    close(groupAfter[i].dy, groupBefore[i].dy - 60, 'Group member shares the vertical displacement')
  }
  assert.equal(groupAfter[1].rotate, 25)
  assert.equal(await page.locator('#deck .is-selected').count(), 2, 'Shift-drag does not remove a selected member')
  await undo()
  assert.equal(await readFile(file, 'utf8'), original, 'Group constraint is saved and undone atomically')

  // Equally rotated members give the group itself a nonzero transform origin.
  // Child deltas must remain in slide coordinates for both locked and free drags.
  await page.keyboard.press('Escape')
  await object('shape').click()
  await shiftClick('shape-parallel')
  const rotatedBefore = await Promise.all(['shape', 'shape-parallel'].map(options))
  for (const constrained of [true, false]) {
    origin = await begin('shape-parallel', constrained)
    await move(origin, 24, -60)
    await finish()
    const after = await Promise.all(['shape', 'shape-parallel'].map(options))
    for (let i = 0; i < after.length; i++) {
      close(after[i].dx, rotatedBefore[i].dx + (constrained ? 0 : 24), 'Rotated group uses each member’s horizontal delta')
      close(after[i].dy, rotatedBefore[i].dy - 60, 'Rotated group uses each member’s vertical delta')
    }
    await undo()
    assert.equal(await readFile(file, 'utf8'), original)
  }
  assert.deepEqual(errors, [])
  console.log('Axis-drag browser checks passed: horizontal/vertical, sticky axis, mid-drag modifiers, Shift-click, cropped figure, snapping, group movement, rotation, zoom, source persistence and undo.')
} finally {
  await browser?.close()
  await app?.close()
  await rm(dir, { recursive: true, force: true })
}
