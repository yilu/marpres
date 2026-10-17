import assert from 'node:assert/strict'
import { chromium } from 'playwright-chromium'
import { renderSource, documentHTML } from '../scripts/render.mjs'
import { applyDeckDesign, setSlideAppearance } from '../editor/theme-store.mjs'

const section = title => `# ${title}

::: panel
::: box id=${title}-body
Body with [link](https://example.com) and \`code\`.
:::

| Name | Value |
| --- | --- |
| First | 1 |
| Second | 2 |

\`\`\`
Code sample
\`\`\`

::: caption id=${title}-caption
Caption
:::
::: ref id=${title}-ref
Reference
:::
:::

::: ref id=${title}-standalone
Standalone reference
:::

::: footer
Footer
:::

::: figure id=${title}-plot position=absolute dx=870 dy=150 width=220
![Plot](test/fixtures/wide.svg)
:::
`
const source = `---
marp: true
theme: nju-unofficial-v2
paginate: true
---
<!-- _class: title-slide -->
# Cover

::: footer
Cover footer
:::

---
${section('Light')}
---
${section('Dark')}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
async function show(markdown) {
  const rendered = await renderSource(markdown)
  assert.deepEqual(rendered.diagnostics, [])
  await page.setContent(documentHTML(rendered))
  return page.evaluate(() => [...document.querySelectorAll('section')].map(section => {
    const style = (selector, pseudo) => {
      const element = selector ? section.querySelector(selector) : section
      if (!element) return null
      const computed = getComputedStyle(element, pseudo)
      return { font: computed.fontSize, family: computed.fontFamily, color: computed.color, background: computed.backgroundColor, display: computed.display, border: computed.borderBottomColor, content: computed.content }
    }
    return { section: style(), title: style('.deck-heading h1'), band: style('.deck-heading'), body: style('.layout-box'), caption: style('.layout-caption'), reference: style('.layout-ref'), standalone: style('[data-edit-id$="-standalone"]'), footer: style('.deck-footer'), number: style(null, '::after'), link: style('a'), code: style('pre, marp-pre'), th: style('th'), even: style('tbody tr:nth-child(even)'), inlineCode: style('code'), pagination: section.dataset.marpitPagination }
  }))
}
async function geometry() {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => [...document.querySelectorAll('section')].map(section => {
    const root = section.getBoundingClientRect(), scale = root.width / 1280
    const rect = selector => {
      const box = section.querySelector(selector)?.getBoundingClientRect()
      return box ? { x: (box.left - root.left) / scale, y: (box.top - root.top) / scale, width: box.width / scale, height: box.height / scale } : null
    }
    return { title: rect('.deck-heading h1'), band: rect('.deck-heading'), footer: rect('.deck-footer'), body: rect('.deck-content'), plot: rect('.figure-frame'), pageNumber: getComputedStyle(section, '::after').translate }
  }))
}
try {
  const footerSource = '---\nmarp: true\ntheme: nju-unofficial-v2\n---\n# X\n\n::: footer\n::: box id=footer-free position=absolute dx=20 dy=30 width=100\nFree text\n:::\n:::\n'
  const footerGeometry = async () => page.locator('[data-edit-id="footer-free"]').evaluate(element => {
    const section = element.closest('section'), rect = element.getBoundingClientRect(), root = section.getBoundingClientRect(), scale = root.width / 1280
    return { x: (rect.left - root.left) / scale, y: (rect.top - root.top) / scale, parent: element.offsetParent?.tagName, footerTranslate: getComputedStyle(section.querySelector('.deck-footer')).translate, titleTranslate: getComputedStyle(section.querySelector('.deck-heading h1')).translate }
  })
  await show(footerSource)
  const freeBaseline = await footerGeometry()
  assert.deepEqual(freeBaseline, { x: 20, y: 30, parent: 'SECTION', footerTranslate: 'none', titleTranslate: 'none' })
  await show(applyDeckDesign(footerSource, {}))
  assert.deepEqual(await footerGeometry(), freeBaseline, 'Explicit defaults retain the authored containing block')
  const movedFooterSource = applyDeckDesign(footerSource, { theme: { footer_dx: 40, footer_dy: -20 } })
  await show(movedFooterSource)
  assert.deepEqual(await footerGeometry(), freeBaseline, 'Moving normal footer content preserves independent absolute slide coordinates')
  await show(applyDeckDesign(movedFooterSource, { theme: { footer_dx: 0, footer_dy: 0 } }))
  assert.deepEqual(await footerGeometry(), freeBaseline, 'Reset restores the original containing block and absolute position')

  const initial = await show(source)
  assert.equal(initial[0].title.font, '49px')
  assert.equal(initial[1].title.font, '47.84px')
  assert.equal(initial[1].body.font, '26px')
  assert.equal(initial[1].caption.font, '25px')
  assert.equal(initial[1].reference.font, '18px')
  assert.equal(initial[1].footer.font, '19px')
  assert.equal(initial[1].number.font, '19px')
  assert.equal(initial[1].th.background, 'rgb(246, 241, 245)')
  assert.equal(initial[1].even.background, 'rgb(250, 247, 249)')

  // Pure translations keep both flow and the cover title band in place.
  await show(applyDeckDesign(source, {}))
  const positions = await geometry()
  const offsetTheme = { title_dx: 36, title_dy: -12, footer_dx: -24, footer_dy: -18, page_number_dx: -40, page_number_dy: 9 }
  const positioned = applyDeckDesign(source, { theme: offsetTheme })
  await show(positioned)
  const moved = await geometry()
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < .02, `${message}: ${actual} vs ${expected}`)
  for (let index = 0; index < moved.length; index++) {
    for (const [role, dx, dy] of [['title', 36, -12], ['footer', -24, -18]]) {
      near(moved[index][role].x, positions[index][role].x + dx, `${role} horizontal offset on slide ${index + 1}`)
      near(moved[index][role].y, positions[index][role].y + dy, `${role} vertical offset on slide ${index + 1}`)
      near(moved[index][role].width, positions[index][role].width, `${role} width`)
      near(moved[index][role].height, positions[index][role].height, `${role} height`)
    }
    assert.deepEqual(moved[index].band, positions[index].band)
    assert.deepEqual(moved[index].body, positions[index].body)
    assert.deepEqual(moved[index].plot, positions[index].plot)
    assert.equal(moved[index].pageNumber, '-40px 9px')
  }
  assert.equal(await page.locator('section').nth(1).locator('h1').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString() }), 'Light')
  await show(applyDeckDesign(positioned, { theme: Object.fromEntries(Object.keys(offsetTheme).map(key => [key, 0])) }))
  const reset = await geometry()
  for (let index = 0; index < reset.length; index++) {
    for (const role of ['title', 'footer', 'band', 'body', 'plot']) assert.deepEqual(reset[index][role], positions[index][role])
    assert.equal(reset[index].pageNumber, 'none')
  }

  let changed = applyDeckDesign(source, { theme: { title_size: 60, body_size: 29, caption_size: 24, reference_size: 17, footer_size: 16, page_number_size: 15, font_family: 'Georgia, serif', appearance: 'dark', show_page_numbers: false }, css: 'section .layout-box { letter-spacing: 1px; }' })
  changed = setSlideAppearance(changed, 2, 'light')
  const themed = await show(changed)
  assert.equal(themed[0].title.font, '61.4548px')
  for (const slide of themed.slice(1)) {
    assert.equal(slide.title.font, '60px')
    assert.equal(slide.body.font, '29px')
    assert.equal(slide.caption.font, '24px')
    assert.equal(slide.reference.font, '17px')
    assert.equal(slide.footer.font, '16px')
    assert.equal(slide.number.font, '15px')
    assert.equal(slide.number.display, 'none')
    assert.match(slide.body.family, /Georgia/)
  }
  assert.equal(themed[0].band.background, 'rgb(231, 155, 207)')
  assert.equal(themed[0].title.color, 'rgb(23, 20, 29)')
  assert.equal(themed[1].section.background, 'rgb(255, 255, 255)')
  assert.equal(themed[1].body.color, 'rgb(23, 20, 23)')
  assert.equal(themed[1].title.color, 'rgb(122, 0, 95)')
  assert.equal(themed[2].section.background, 'rgb(23, 20, 29)')
  for (const role of ['body', 'caption', 'th', 'code']) assert.equal(themed[2][role].color, 'rgb(243, 239, 245)', `dark ${role} text uses text palette`)
  for (const role of ['reference', 'standalone', 'footer', 'number']) assert.equal(themed[2][role].color, 'rgb(187, 176, 194)', `dark ${role} uses muted palette`)
  assert.equal(themed[2].title.color, 'rgb(240, 182, 221)')
  assert.equal(themed[2].link.color, 'rgb(231, 155, 207)')
  for (const role of ['th', 'even', 'code', 'inlineCode']) assert.notEqual(themed[2][role].background, initial[2][role].background, `dark ${role} background follows palette`)
  assert.equal(themed[2].pagination, '3')
  assert.equal(await page.locator('[data-edit-id="Dark-body"]').evaluate(element => getComputedStyle(element).letterSpacing), '1px')

  for (const setting of ['', 'paginate: false\n']) {
    const original = `---\nmarp: true\ntheme: nju-unofficial-v2\n${setting}---\n# First\n\n---\n<!-- _paginate: false -->\n# Hidden\n\n---\n# Third\n`
    const unmanaged = await show(original)
    assert.ok(unmanaged.every(slide => slide.pagination === undefined))
    const enabled = applyDeckDesign(original, { theme: { show_page_numbers: true } })
    const numbered = await show(enabled)
    assert.equal(numbered[0].pagination, '1')
    assert.equal(numbered[0].number.content, '"1"')
    assert.equal(numbered[0].number.display, 'block')
    assert.equal(numbered[1].pagination, undefined)
    assert.doesNotMatch(numbered[1].number.content, /\d/)
    assert.equal(numbered[2].pagination, '3')
    assert.equal(numbered[2].number.content, '"3"')
    const hidden = await show(applyDeckDesign(enabled, { theme: { show_page_numbers: false } }))
    assert.ok(hidden.every(slide => slide.number.display === 'none'))
    const restored = await show(applyDeckDesign(enabled, { theme: { show_page_numbers: true } }))
    assert.equal(restored[2].number.content, '"3"')
    assert.equal(restored[1].pagination, undefined)
  }
  console.log('Theme browser checks passed: shared roles, palettes, custom CSS, cover title and pagination.')
} finally { await browser.close() }
