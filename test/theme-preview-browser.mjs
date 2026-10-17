import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { createDraftServer } from '../editor/server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marp-theme-preview-'))
const file = join(dir, 'preview.md')
const original = `---
marp: true
theme: nju-unofficial-v2
paginate: true
footer: Master footer
---
# First slide

::: box id=first
First slide body.
:::

---
# Preview this slide

::: box id=second
A live preview with a footer and page number.
:::

<img src="https://preview.example.test/image.svg" width="80" height="32" alt="Remote diagram">
`
await writeFile(file, original)
let browser, app
try {
  app = await createDraftServer({ file, port: 0, ui: 'gui' })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://preview.example.test/image.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="32"><rect width="80" height="32" rx="5" fill="#a9bfd9"/></svg>' }))
  await page.goto(app.url)
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
  await page.locator('.slide-item[data-slide="2"]').click()
  await page.click('#theme-toggle')
  assert.equal(await page.locator('#theme-preview-frame').count(), 1, 'Theme dialog has an isolated rendered-slide preview')
  assert.equal(await page.locator('#theme-preview-frame').isVisible(), true)
  const frame = page.frameLocator('#theme-preview-frame')
  const bodySize = () => frame.locator('.marpit > svg:visible [data-edit-id="second"]').evaluate(element => getComputedStyle(element).fontSize)
  const waitPreview = async () => {
    await page.waitForFunction(() => document.querySelector('#theme-preview-status').textContent === 'Preview up to date' && document.querySelector('#theme-preview').getAttribute('aria-busy') !== 'true')
    await frame.locator('.marpit > svg:visible h1').waitFor()
  }
  const snapshot = () => frame.locator('.marpit > svg:visible').evaluate(svg => {
    const section = svg.querySelector('section'), title = svg.querySelector('h1'), footer = svg.querySelector('footer'), body = svg.querySelector('[data-edit-id]')
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return { title: rect(title), body: rect(body), footer: footer ? rect(footer) : null, titleFont: getComputedStyle(title).fontSize, bodyFont: getComputedStyle(body).fontSize, background: getComputedStyle(section).backgroundColor, titleColor: getComputedStyle(title).color, pageTranslate: getComputedStyle(section, '::after').translate, bodySpacing: getComputedStyle(body).letterSpacing }
  })
  const deck = () => page.evaluate(() => fetch('/api/deck').then(response => response.json()))
  const baseline = await deck()
  const sameSource = async label => {
    assert.equal(await readFile(file, 'utf8'), original, `${label}: source bytes unchanged`)
    const current = await deck()
    assert.equal(current.hash, baseline.hash, `${label}: hash unchanged`)
    assert.deepEqual(current.history, baseline.history, `${label}: history unchanged`)
  }
  const saved = async (path, action) => {
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(path))
    await action()
    const response = await pending
    assert.equal(response.status(), 200, await response.text())
    await page.waitForFunction(() => !document.body.classList.contains('saving'))
    return response.json()
  }
  const close = (a, b, message) => assert.ok(Math.abs(a - b) < .15, `${message}: ${a} versus ${b}`)
  await waitPreview()
  assert.equal(await page.locator('#theme-preview-slide').inputValue(), '2', 'Preview starts at the current editor slide')
  assert.equal(await frame.locator('.marpit > svg:visible h1').innerText(), 'Preview this slide')
  await frame.locator('img[alt="Remote diagram"]').evaluate(image => image.decode())
  assert.equal(await frame.locator('img[alt="Remote diagram"]').evaluate(image => image.naturalWidth), 80, 'Ordinary remote images remain visible inside the preview')
  assert.equal(await page.locator('#theme-preview-frame').getAttribute('sandbox'), '', 'Preview uses an opaque-origin scriptless sandbox')
  assert.equal(await page.locator('#theme-preview-frame').evaluate(element => element.contentDocument === null), true, 'Preview CSS and DOM are isolated from the editor')
  await page.locator('#theme-editor [name="body_size"]').fill('32')
  await page.locator('#theme-editor [name="title_size"]').fill('55')
  await waitPreview()
  assert.equal(await bodySize(), '32px')
  assert.equal((await snapshot()).titleFont, '55px')
  assert.equal(await page.locator('#deck [data-edit-id="second"]').evaluate(element => getComputedStyle(element).fontSize), '26px', 'Unsaved preview leaves the editor slide unchanged')
  await page.click('[data-theme-tab="colours"]')
  await page.locator('#theme-editor [name="light.background"]').fill('#eef4ff')
  await page.locator('#theme-editor [name="light.title"]').fill('#184fa0')
  await waitPreview()
  assert.equal((await snapshot()).background, 'rgb(238, 244, 255)')
  assert.equal((await snapshot()).titleColor, 'rgb(24, 79, 160)')
  const beforePositions = await snapshot()
  assert.ok(beforePositions.footer, 'Fixture provides a real footer')
  await page.click('[data-theme-tab="positions"]')
  for (const [key, value] of Object.entries({ title_dx: 24, title_dy: 12, footer_dx: -28, footer_dy: -14, page_number_dx: -40, page_number_dy: -20 })) await page.locator(`#theme-editor [name="${key}"]`).fill(String(value))
  await waitPreview()
  const moved = await snapshot()
  close(moved.title.x, beforePositions.title.x + 24, 'Title X offset appears before Apply')
  close(moved.title.y, beforePositions.title.y + 12, 'Title Y offset appears before Apply')
  close(moved.footer.x, beforePositions.footer.x - 28, 'Footer X offset appears before Apply')
  close(moved.footer.y, beforePositions.footer.y - 14, 'Footer Y offset appears before Apply')
  assert.equal(moved.pageTranslate, '-40px -20px')
  assert.deepEqual(moved.body, beforePositions.body, 'Moving the title preserves reserved layout space')
  await page.click('[data-reset-position="title"]')
  await waitPreview()
  assert.equal(await page.locator('#theme-editor [name="title_dx"]').inputValue(), '0')
  assert.deepEqual((await snapshot()).title, beforePositions.title, 'Reset restores the original title position')
  await sameSource('Fonts, colours, offsets and reset previews')

  const validFrame = await page.locator('#theme-preview-frame').getAttribute('srcdoc')
  await page.locator('#theme-editor [name="title_dx"]').fill('1281')
  await page.waitForFunction(() => !document.querySelector('#theme-preview-error').hidden)
  assert.match(await page.locator('#theme-preview-error').textContent(), /1280/)
  assert.equal(await page.locator('#theme-preview-frame').getAttribute('srcdoc'), validFrame, 'Invalid offsets retain the last valid preview')
  await page.locator('#theme-editor [name="title_dx"]').fill('0')
  await waitPreview()
  await page.click('[data-theme-tab="advanced"]')
  const cssResponse = page.waitForResponse(response => response.url().endsWith('/api/theme-preview'))
  await page.locator('#theme-css').fill('section {')
  assert.equal((await cssResponse).status(), 400)
  await page.waitForFunction(() => !document.querySelector('#theme-preview-error').hidden)
  assert.match(await page.locator('#theme-preview-status').textContent(), /last valid/)
  assert.deepEqual((await snapshot()).title, beforePositions.title)
  await page.locator('#theme-css').fill('.layout-box { letter-spacing: 3px; } .theme-heading { display: none !important; }')
  await waitPreview()
  assert.equal((await snapshot()).bodySpacing, '3px')
  assert.equal(await page.locator('.theme-heading').isVisible(), true, 'Custom CSS cannot affect dialog chrome')
  assert.notEqual(await page.locator('#deck [data-edit-id="second"]').evaluate(element => getComputedStyle(element).letterSpacing), '3px')
  await page.selectOption('#theme-preview-slide', '1')
  assert.equal(await frame.locator('.marpit > svg:visible h1').innerText(), 'First slide')
  assert.equal(await page.locator('#page-label').textContent(), '2 / 2', 'Choosing another preview slide does not navigate the editor')
  await page.selectOption('#theme-preview-slide', '2')
  await page.click('[data-theme-tab="positions"]')
  await waitPreview()
  await frame.locator('.marpit > svg:visible h1').filter({ hasText: 'Preview this slide' }).waitFor()
  if (process.env.THEME_PREVIEW_SCREENSHOT) await page.screenshot({ path: process.env.THEME_PREVIEW_SCREENSHOT })
  await page.setViewportSize({ width: 900, height: 740 })
  await page.waitForTimeout(100)
  const layout = await page.locator('#theme-dialog').evaluate(element => {
    const preview = element.querySelector('#theme-preview-viewport').getBoundingClientRect(), dialog = element.getBoundingClientRect(), apply = element.querySelector('#theme-apply').getBoundingClientRect()
    return { dialog: { left: dialog.left, right: dialog.right }, preview: { width: preview.width, height: preview.height, right: preview.right }, apply: { bottom: apply.bottom }, width: innerWidth, height: innerHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
  })
  assert.ok(layout.dialog.left >= 0 && layout.dialog.right <= layout.width)
  close(layout.preview.width / layout.preview.height, 16 / 9, 'Preview maintains its slide aspect ratio')
  assert.ok(layout.preview.width > 400 && layout.preview.right <= layout.width, '900 px viewport retains a useful visible preview')
  assert.ok(layout.apply.bottom < layout.height, 'Apply remains visible on the narrow viewport')
  assert.equal(layout.scrollWidth, layout.clientWidth, 'Dialog has no horizontal overflow')
  if (process.env.THEME_PREVIEW_NARROW_SCREENSHOT) await page.screenshot({ path: process.env.THEME_PREVIEW_NARROW_SCREENSHOT })
  await page.keyboard.press('Escape')
  await sameSource('Cancel')

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.click('#theme-toggle')
  await waitPreview()
  assert.equal(await bodySize(), '26px', 'Reopening starts from the committed theme')
  await page.click('[data-theme-tab="type"]')
  await page.locator('#theme-editor [name="body_size"]').fill('34')
  await page.click('[data-theme-tab="positions"]')
  for (const [key, value] of Object.entries({ title_dx: 18, title_dy: 9, footer_dx: -15, page_number_dy: -8 })) await page.locator(`#theme-editor [name="${key}"]`).fill(String(value))
  await waitPreview()
  const downloadPending = page.waitForEvent('download')
  await page.click('#theme-export')
  const download = await downloadPending
  const preset = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.equal(preset.theme.title_dx, 18)
  assert.equal(preset.theme.title_dy, 9)
  assert.equal(preset.theme.footer_dx, -15)
  assert.equal(preset.theme.page_number_dy, -8)
  preset.theme.body_size = 31
  preset.theme.title_dx = 22
  await writeFile(join(dir, 'preset.json'), JSON.stringify(preset))
  await page.locator('#theme-file').setInputFiles(join(dir, 'preset.json'))
  await waitPreview()
  assert.equal(await page.locator('#theme-editor [name="title_dx"]').inputValue(), '22')
  assert.equal(await bodySize(), '31px', 'Imported positions and styles render without being applied')
  await sameSource('Preset download and import')
  await saved('/api/theme', () => page.click('#theme-apply'))
  assert.equal(await page.locator('#theme-dialog').isVisible(), false)
  const applied = await deck()
  assert.equal(applied.design.theme.title_dx, 22)
  assert.equal(applied.design.theme.footer_dx, -15)
  assert.equal(await page.locator('#deck [data-edit-id="second"]').evaluate(element => getComputedStyle(element).fontSize), '31px')
  await saved('/api/undo', () => page.click('#undo'))
  assert.equal(await readFile(file, 'utf8'), original, 'All proposed changes apply in one undo step')
  assert.equal((await deck()).history.canUndo, false)
  assert.equal((await deck()).history.canRedo, true)

  // Hold actual preview responses so requests can finish out of order.
  let releaseOld, oldArrived, oldDone
  const hold = size => {
    let arrived, done
    oldArrived = new Promise(resolve => { arrived = resolve })
    oldDone = new Promise(resolve => { done = resolve })
    const released = new Promise(resolve => { releaseOld = resolve })
    return { size, arrived, done, released }
  }
  let held = hold(41)
  await page.route('**/api/theme-preview', async route => {
    const body = route.request().postDataJSON()
    const response = await route.fetch()
    if (body.theme.body_size === held.size) {
      const current = held
      current.arrived()
      await current.released
      await route.fulfill({ response }).catch(() => {})
      current.done()
    } else await route.fulfill({ response }).catch(() => {})
  })
  await page.click('#theme-toggle')
  await waitPreview()
  await page.click('[data-theme-tab="type"]')
  await page.locator('#theme-editor [name="body_size"]').fill('41')
  await oldArrived
  await page.locator('#theme-editor [name="body_size"]').fill('42')
  await waitPreview()
  assert.equal(await bodySize(), '42px')
  releaseOld(); await oldDone
  await page.waitForTimeout(150)
  assert.equal(await bodySize(), '42px', 'An older delayed response cannot overwrite the latest preview')
  held = hold(43)
  await page.locator('#theme-editor [name="body_size"]').fill('43')
  await oldArrived
  await page.click('#theme-close')
  const closedFrame = await page.locator('#theme-preview-frame').getAttribute('srcdoc')
  releaseOld(); await oldDone
  await page.waitForTimeout(150)
  assert.equal(await page.locator('#theme-dialog').isVisible(), false)
  assert.equal(await page.locator('#theme-preview-frame').getAttribute('srcdoc'), closedFrame, 'Closing cancels pending preview updates')
  assert.equal(await readFile(file, 'utf8'), original)
  assert.deepEqual((await deck()).history, { canUndo: false, canRedo: true }, 'Read-only preview preserves redo history')
  await page.unroute('**/api/theme-preview')

  // Servers started before these capabilities were added keep their existing UI.
  const oldPage = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  let previewRequests = 0, oldThemeRequest
  oldPage.on('request', request => {
    if (request.url().endsWith('/api/theme-preview')) previewRequests++
    if (request.url().endsWith('/api/theme') && request.method() === 'POST') oldThemeRequest = request.postDataJSON()
  })
  await oldPage.route('**/api/deck', async route => {
    const response = await route.fetch(), data = await response.json()
    data.capabilities = { panelInsertion: true }
    await route.fulfill({ response, json: data })
  })
  await oldPage.route('https://preview.example.test/image.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="32"></svg>' }))
  await oldPage.goto(app.url)
  await oldPage.waitForFunction(() => document.querySelector('#status').textContent === 'Select an object to edit')
  await oldPage.click('#theme-toggle')
  assert.equal(await oldPage.locator('#theme-preview').isVisible(), false)
  assert.equal(await oldPage.locator('[data-theme-tab="positions"]').isVisible(), false)
  await oldPage.locator('#theme-editor [name="body_size"]').fill('28')
  const oldSave = oldPage.waitForResponse(response => response.url().endsWith('/api/theme'))
  await oldPage.click('#theme-apply')
  assert.equal((await oldSave).status(), 200)
  assert.equal(previewRequests, 0, 'Older servers receive no unsupported preview requests')
  assert.equal(Object.hasOwn(oldThemeRequest.theme, 'title_dx'), false, 'Older servers receive no unsupported master-position fields')
  await oldPage.close()
  assert.deepEqual(errors, [])
  console.log('Theme live preview browser checks passed: current slide, isolated fonts/colours/CSS/positions, read-only hash/history, last valid preview on invalid values/CSS, resets, slide chooser, one-step Apply/undo, cancellation, out-of-order responses, preset positions, 900 px layout, and old-server capability gating.')
} catch (error) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: '/tmp/marp-theme-preview-failure.png' }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await app?.close()
  await rm(dir, { recursive: true, force: true })
}
