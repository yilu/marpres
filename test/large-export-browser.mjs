import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-chromium'
import { SourceStore } from '../editor/source-store.mjs'
import { exportDeckPDF } from '../scripts/export.mjs'

const dir = await mkdtemp(join(tmpdir(), 'marpres-large-export-')), file = join(dir, 'deck.md'), image = join(dir, 'large.svg')
const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><!--' + 'x'.repeat(4 * 1024 * 1024) + '--><rect width="320" height="160" fill="#00aa00"/></svg>')
await writeFile(image, bytes)
const source = '# Large image\n\n![First](large.svg)\n\n---\n\n# Repeated image\n\n![Second](large.svg)\n'
await writeFile(file, source)
const launch = chromium.launch.bind(chromium)
let temporary, observed = false
chromium.launch = async (...args) => {
  const browser = await launch(...args), newPage = browser.newPage.bind(browser)
  browser.newPage = async (...args) => {
    const page = await newPage(...args), setContent = page.setContent.bind(page), goto = page.goto.bind(page)
    page.setContent = async (html, ...args) => {
      assert.ok(html.length < 1024 * 1024, 'PDF export must not send megabytes of inline image data through the browser protocol')
      return setContent(html, ...args)
    }
    page.goto = async (url, ...args) => {
      assert.match(url, /^file:/)
      temporary = dirname(fileURLToPath(url))
      const html = await readFile(fileURLToPath(url), 'utf8')
      assert.ok(html.length < 1024 * 1024)
      const images = [...html.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map(m => m[1])
      assert.equal(images.length, 2)
      assert.equal(new Set(images).size, 1, 'Repeated images share a frozen asset')
      assert.deepEqual(await readFile(fileURLToPath(new URL(images[0], url))), bytes, 'Export snapshots preserve original image bytes')
      await writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')
      observed = true
      return goto(url, ...args)
    }
    return page
  }
  return browser
}
try {
  const store = new SourceStore(file), snapshot = await store.read()
  const result = await exportDeckPDF(store, { hash: snapshot.hash })
  assert.ok(observed, 'Export uses an isolated file-based snapshot')
  assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-')
  assert.equal((result.buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, 2)
  assert.equal(await readFile(file, 'utf8'), source)
  assert.deepEqual((await store.read()).history, { canUndo: false, canRedo: false })
  assert.deepEqual((await readdir(dir)).sort(), ['deck.md', 'large.svg'])
  await assert.rejects(access(temporary), { code: 'ENOENT' })
  console.log('Large PDF export passed: bounded browser payload, deduplicated immutable image bytes, two pages, source/history preservation and temporary cleanup.')
} finally {
  chromium.launch = launch
  await rm(dir, { recursive: true, force: true })
}
