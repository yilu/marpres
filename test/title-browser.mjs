import assert from 'node:assert/strict'
import { chromium } from 'playwright-chromium'
import { renderSource, documentHTML } from '../scripts/render.mjs'
import { applyDeckDesign } from '../editor/theme-store.mjs'

const cases = []
for (const font of [undefined, 'Arial, sans-serif', 'Georgia, serif']) {
  for (const title of ['Typography', 'gypq', '中文标题 Typography gypq', 'Typography gypq<br>第二行 pgyq']) cases.push({ title, font })
  cases.push({ title: 'Typography gypq<br>中文标题', font, cover: true, size: 64 })
}
cases.push({ title: 'Typography gypq 中文标题', size: 64, offsets: { title_dx: 18, title_dy: 12 } })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const results = []
try {
  for (const fixture of cases) {
    const label = `${fixture.font || 'default'} / ${fixture.title} / ${fixture.cover ? 'cover' : 'normal'}`
    let source = `---\nmarp: true\ntheme: marpres\n---\n${fixture.cover ? '<!-- _class: title-slide -->\n' : ''}# ${fixture.title}\n\n::: panel\nContent column one\n:::\n\n::: panel\nContent column two\n:::\n`
    if (fixture.font || fixture.size || fixture.offsets) source = applyDeckDesign(source, { theme: { ...(fixture.font ? { font_family: fixture.font } : {}), ...(fixture.size ? { title_size: fixture.size } : {}), ...fixture.offsets } })
    const rendered = await renderSource(source)
    assert.deepEqual(rendered.diagnostics, [])
    await page.goto('about:blank')
    await page.setContent(documentHTML(rendered))
    await page.evaluate(() => document.fonts.ready)
    const bounds = await page.evaluate(() => {
      const header = document.querySelector('.deck-heading'), title = header.querySelector('h1'), content = document.querySelector('.deck-content')
      const range = document.createRange(); range.selectNodeContents(title)
      const text = range.getBoundingClientRect(), box = header.getBoundingClientRect(), body = content.getBoundingClientRect()
      return { header: box.toJSON(), title: title.getBoundingClientRect().toJSON(), text: text.toJSON(), content: body.toJSON(), foreground: getComputedStyle(title).color, hasAutoScaling: !!title.shadowRoot?.querySelector('marp-auto-scaling') }
    })
    assert.equal(bounds.hasAutoScaling, false, label + ': ordinary titles remain native text')
    assert.ok(bounds.content.top > bounds.header.bottom, label + ': columns start below the heading')
    const clip = { x: 0, y: Math.max(0, Math.floor(Math.min(bounds.header.top, bounds.text.top) - 5)), width: 1280, height: 1 }
    clip.height = Math.ceil(Math.min(bounds.content.top - 1, Math.max(bounds.header.bottom, bounds.text.bottom) + 10) - clip.y)
    const actual = await page.screenshot({ clip })
    // The reference exposes any glyph ink outside its line box, without changing
    // font metrics, title geometry, wrapping, the cover band, or column placement.
    await page.locator('.deck-heading').evaluate(header => { header.style.overflow = 'visible' })
    const reference = await page.screenshot({ clip })
    const pixels = await page.evaluate(async ({ actual, reference, foreground }) => {
      const decode = async value => {
        const image = new Image(); image.src = 'data:image/png;base64,' + value; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
        return { pixels: context.getImageData(0, 0, image.width, image.height).data, width: image.width }
      }
      const before = await decode(actual), full = await decode(reference), color = foreground.match(/\d+/g).slice(0, 3).map(Number)
      let changedPixels = 0, ink = 0, firstInkRow = Infinity, lastInkRow = -1
      for (let index = 0; index < full.pixels.length; index += 4) {
        if (before.pixels.slice(index, index + 4).some((value, channel) => value !== full.pixels[index + channel])) changedPixels++
        if (color.every((value, channel) => Math.abs(value - full.pixels[index + channel]) < 48)) {
          ink++; const row = Math.floor(index / 4 / full.width); firstInkRow = Math.min(firstInkRow, row); lastInkRow = row
        }
      }
      return { changedPixels, ink, firstInkRow, lastInkRow }
    }, { actual: actual.toString('base64'), reference: reference.toString('base64'), foreground: bounds.foreground })
    assert.ok(pixels.ink > 50, label + ': screenshot contains title glyph ink')
    assert.equal(pixels.changedPixels, 0, `${label}: ${pixels.changedPixels} glyph pixels are clipped by the title header`)
    assert.ok(clip.y + pixels.lastInkRow + 12 < bounds.content.top, label + ': full descenders remain clear of the content columns')
    const after = await page.locator('.deck-heading').evaluate(header => header.getBoundingClientRect().toJSON())
    assert.deepEqual(after, bounds.header, label + ': exposing ink must preserve heading geometry')
    results.push({ font: fixture.font || 'default', cover: !!fixture.cover, changedPixels: pixels.changedPixels, clearance: Number((bounds.content.top - clip.y - pixels.lastInkRow).toFixed(2)) })
  }
  console.log(`Title raster checks passed: ${results.length} Latin/CJK, default/Arial/Georgia, multiline, cover, enlarged and offset cases; minimum glyph-to-content clearance ${Math.min(...results.map(result => result.clearance))}px.`)
} finally { await browser.close() }
