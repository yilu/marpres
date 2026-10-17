import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Marp } from '@marp-team/marp-core'
import { chromium } from 'playwright-chromium'
import legacyLayout from '../engine/layout-engine.mjs'
import { renderSource, documentHTML } from '../scripts/render.mjs'
import { applyDeckDesign } from '../editor/theme-store.mjs'

const baseDir = fileURLToPath(new URL('./fixtures/', import.meta.url))
const deck = theme => `---
marp: true
theme: ${theme}
paginate: true
---
<!-- _class: title-slide -->
# Compatibility cover

Cover body

::: footer
Cover footer
:::

---
<!-- _appearance: dark -->
<!-- _layout: cols 1 1 -->
# Shared theme
## Subtitle

::: panel
::: figure id=plot width=320 crop=10,10,80,80
![Plot](wide.svg)
:::
::: caption id=caption
Figure caption
:::
::: ref id=reference
Reference text
:::
:::

::: panel
::: box id=body
Body **text**, [link](https://example.com), and \`inline code\`.
:::

| Column | Value |
| --- | --- |
| First | 1 |
| Second | 2 |

\`\`\`
Code block
\`\`\`
:::

::: footer
Shared footer
:::
`

test('Marpres is the canonical theme and the old v2 name is a thin compatibility alias', async () => {
  const canonical = await readFile(new URL('../themes/marpres.css', import.meta.url), 'utf8')
  const alias = await readFile(new URL('../themes/nju-unofficial-v2.css', import.meta.url), 'utf8')
  assert.match(canonical, /@theme marpres\b/)
  assert.doesNotMatch(canonical, /nju|nanjing/i)
  assert.match(alias, /@theme nju-unofficial-v2\b/)
  assert.match(alias, /@import ['"]marpres['"]/)
  assert.match(alias, /--nju-purple:\s*var\(--deck-accent\)/)
  assert.ok(alias.length < 400)
  assert.match(documentHTML({ html: '', css: '' }), /<title>Marpres<\/title>/)
})

test('canonical and compatibility names render identical geometry, roles, palettes and master offsets', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const measure = async source => {
    const rendered = await renderSource(source, { baseDir })
    assert.deepEqual(rendered.diagnostics, [])
    // A fresh document gives both renders the same Marp custom-element lifecycle.
    await page.goto('about:blank')
    await page.setContent(documentHTML(rendered))
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return page.evaluate(() => [...document.querySelectorAll('section')].map(section => {
      const origin = section.getBoundingClientRect(), scale = origin.width / 1280
      const properties = ['fontSize', 'fontFamily', 'fontWeight', 'color', 'backgroundColor', 'lineHeight', 'borderBottomColor', 'translate', 'display']
      const elements = [section, ...section.querySelectorAll('.deck-heading, h1, h2, .deck-content, .deck-footer, .panel, .panel-caption, .panel-ref, .figure-frame, img, .layout-box, table, th, td, a, code, pre, marp-pre')]
      return {
        pagination: section.dataset.marpitPagination,
        appearance: section.dataset.appearance,
        elements: elements.map(element => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
          return { tag: element.tagName, rect: [(rect.x - origin.x) / scale, (rect.y - origin.y) / scale, rect.width / scale, rect.height / scale], style: Object.fromEntries(properties.map(key => [key, style[key]])) }
        }),
        pageNumber: Object.fromEntries([...properties, 'content'].map(key => [key, getComputedStyle(section, '::after')[key]])),
      }
    }))
  }
  try {
    for (const design of [null, { theme: { title_size: 57, font_family: 'Georgia, serif', title_dx: 24, title_dy: 8, footer_dx: -12, footer_dy: -10, page_number_dx: -20, page_number_dy: -6 } }]) {
      const canonical = deck('marpres'), compatible = deck('nju-unofficial-v2')
      const canonicalState = await measure(design ? applyDeckDesign(canonical, design) : canonical)
      const compatibleState = await measure(design ? applyDeckDesign(compatible, design) : compatible)
      assert.deepEqual(compatibleState, canonicalState)
      assert.equal(canonicalState[0].elements[0].rect[2], 1280)
      assert.equal(canonicalState[0].elements[0].rect[3], 720)
    }
    const compatible = await renderSource(deck('nju-unofficial-v2'), { baseDir })
    await page.setContent(documentHTML(compatible))
    assert.equal(await page.locator('section').nth(1).evaluate(section => getComputedStyle(section).getPropertyValue('--nju-purple').trim()), '#e79bcf')
  } finally { await browser.close() }
})

test('original theme and layout engine retain their exact bytes and still compile earlier layout syntax', async () => {
  const preserved = {
    '../themes/nju-unofficial.css': '9cac3d1920556adc29e590edda33ae2ca9ab9479892173360ffea08ffde666aa',
    '../engine/layout-engine.mjs': '5862a19181ecd2521bdfce5d2aecd26f6ae526ae54f3acf42f1c5a17213af7d0',
  }
  for (const [path, expected] of Object.entries(preserved)) {
    assert.equal(createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex'), expected)
  }
  const marp = new Marp({ html: true }).use(legacyLayout)
  marp.themeSet.add(await readFile(new URL('../themes/nju-unofficial.css', import.meta.url), 'utf8'))
  const source = '---\nmarp: true\ntheme: nju-unofficial\n---\n' + await readFile(new URL('./fixtures/layout-sample.md', import.meta.url), 'utf8')
  const rendered = marp.render(source)
  assert.equal((rendered.html.match(/<section\b/g) || []).length, 3)
  assert.match(rendered.html, /class="layout-body"/)
  assert.match(rendered.html, /--layout-cols:\s*35fr 65fr/)
  assert.match(rendered.css, /--nju-title-zone:\s*84px/)
})
