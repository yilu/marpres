import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { SourceStore } from '../editor/source-store.mjs'
import { exportDeckPDF } from '../scripts/export.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-print-'))
const file = join(dir, 'code.md')
// A reveal activates the single-page screen viewer, so the second slide is
// initially hidden. Its Marp auto-scaling code needs layout before PDF capture.
await writeFile(file, '---\nmarp: true\ntheme: marpres\n---\n# First\n::: box id=reveal stage=1\nReveal\n:::\n---\n# Code\n:::: panel valign=center\n::: box id=example\n```js\nconst message = "keep every line"\nconsole.log(message)\n```\n:::\n::::\n')
const launch = chromium.launch.bind(chromium)
let captured = false
chromium.launch = async (...args) => {
  const browser = await launch(...args)
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (...pageArgs) => {
    const page = await newPage(...pageArgs)
    const pdf = page.pdf.bind(page)
    page.pdf = async options => {
      // Observe the real capture point without supplying any missing media
      // switch or settling frames on behalf of the exporter.
      const geometry = await page.locator('marp-pre, pre').evaluate(el => {
        const frame = el.getBoundingClientRect(), code = el.querySelector('code').getBoundingClientRect()
        return { print: matchMedia('print').matches, frame: frame.toJSON(), code: code.toJSON() }
      })
      assert.equal(geometry.print, true, 'Exporter must enter print layout before capture')
      assert.ok(geometry.frame.height > 50 && geometry.code.bottom <= geometry.frame.bottom + 1,
        `PDF code block must contain its text at capture time: ${JSON.stringify(geometry)}`)
      captured = true
      return pdf(options)
    }
    return page
  }
  return browser
}
try {
  const store = new SourceStore(file)
  const result = await exportDeckPDF(store, { hash: (await store.read()).hash })
  assert.ok(captured)
  assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-')
  console.log('PDF print check passed: code on initially hidden slides has completed auto-scaling before capture.')
} finally {
  chromium.launch = launch
  await rm(dir, { recursive: true, force: true })
}
