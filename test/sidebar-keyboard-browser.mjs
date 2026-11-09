import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-sidebar-keyboard-'))
const file = join(dir, 'deck.md')
await writeFile(file, `---\nmarp: true\ntheme: marpres\n---\n` + Array.from({ length: 8 }, (_, index) => `# Slide ${index + 1}\n\n::: box id=words-${index + 1} position=absolute dx=120 dy=150 width=400\nFirst line\nSecond line\n:::\n`).join('\n---\n'))
let app, browser
try {
  app = await createDraftServer({ file, port: 0 })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(app.url)
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
  await page.evaluate(() => {
    window.addEventListener('keydown', event => { window.lastKeyEvent = event }, true)
  })
  const item = number => page.locator(`.slide-item[data-slide="${number}"]`)
  const checkPage = async number => {
    assert.equal(await page.locator('#page-label').textContent(), `${number} / 8`)
    assert.equal(await page.locator('#deck .current-slide').count(), 1, 'Exactly one slide is current on the main canvas')
    assert.equal(await page.locator('#deck .current-slide h1').isVisible(), true, 'Current slide heading is visible on the main canvas')
    assert.equal(await page.locator('#deck .current-slide h1').textContent(), `Slide ${number}`, 'Main canvas follows thumbnail navigation')
    assert.equal(await page.locator('.slide-item[aria-selected="true"]').getAttribute('data-slide'), String(number))
  }
  const checkNavigation = async (key, number) => {
    await page.keyboard.press(key)
    await checkPage(number)
    assert.equal(await item(number).evaluate(element => element === document.activeElement), true, 'Focus follows the selected thumbnail for repeated keys')
    assert.equal(await page.evaluate(() => window.lastKeyEvent.defaultPrevented), true, 'Navigator arrow keys prevent native scrolling, including at bounds')
    assert.equal(await item(number).evaluate(element => {
      const box = element.getBoundingClientRect(), list = element.parentElement.getBoundingClientRect()
      return box.top >= list.top - 1 && box.bottom <= list.bottom + 1
    }), true, 'Selected thumbnail remains visible')
  }
  // Simulate browsers where a pointer click does not automatically focus buttons.
  await page.locator('#workspace').focus()
  await item(1).evaluate(element => element.addEventListener('mousedown', event => event.preventDefault(), { once: true }))
  await item(1).click()
  assert.equal(await item(1).evaluate(element => element === document.activeElement), true, 'Clicking a thumbnail explicitly transfers keyboard focus from the workspace')
  await checkNavigation('ArrowDown', 2)
  await checkNavigation('ArrowDown', 3)
  await checkNavigation('ArrowUp', 2)
  await checkNavigation('ArrowUp', 1)
  const top = await page.locator('#slide-list').evaluate(element => element.scrollTop)
  await checkNavigation('ArrowUp', 1)
  assert.equal(await page.locator('#slide-list').evaluate(element => element.scrollTop), top, 'No scrolling past the first slide')
  for (let number = 2; number <= 8; number++) await checkNavigation('ArrowDown', number)
  const bottom = await page.locator('#slide-list').evaluate(element => element.scrollTop)
  await checkNavigation('ArrowDown', 8)
  assert.equal(await page.locator('#slide-list').evaluate(element => element.scrollTop), bottom, 'No scrolling past the last slide')

  // Native caret movement and source scrolling must not navigate slides.
  await item(1).click()
  const nativeArrows = async selector => {
    await page.locator(selector).focus()
    for (const key of ['ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key)
      await checkPage(1)
      assert.equal(await page.evaluate(() => window.lastKeyEvent.defaultPrevented), false, `${selector} keeps native arrow behavior`)
      assert.equal(await page.locator(selector).evaluate(element => element === document.activeElement), true)
    }
  }
  await nativeArrows('#slide-title')
  await page.locator('#deck [data-edit-id="words-1"]').click()
  await nativeArrows('#content-editor')
  await page.locator('#content-editor').evaluate(element => element.setSelectionRange(0, 0))
  await page.keyboard.press('ArrowDown')
  assert.ok(await page.locator('#content-editor').evaluate(element => element.selectionStart) > 0, 'ArrowDown moves the text caret')
  await page.click('#toggle-notes')
  await nativeArrows('#notes-editor')
  await page.click('#close-notes')
  await page.click('#toggle-source')
  await nativeArrows('.source-line:first-child')
  await page.click('#source-close')

  // Canvas selection still owns arrow nudges even after visiting the navigator.
  await page.locator('#deck [data-edit-id="words-1"]').click()
  await page.locator('#workspace').focus()
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/edit'))
  await page.keyboard.press('ArrowDown')
  assert.equal((await saved).status(), 200)
  await page.waitForFunction(() => !document.body.classList.contains('saving'))
  assert.equal(await page.locator('#deck [data-edit-id="words-1"]').evaluate(element => JSON.parse(element.dataset.editOptions).dy), 151)
  await checkPage(1)
  assert.deepEqual(errors, [])
  console.log('Sidebar keyboard browser checks passed: next/previous, repeated focus, scrolling into view, both bounds, native text/source/notes keys, and canvas nudging.')
} finally {
  await browser?.close()
  await app?.close()
  await rm(dir, { recursive: true, force: true })
}
