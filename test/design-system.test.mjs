import test from 'node:test'
import assert from 'node:assert/strict'
import { Marp } from '@marp-team/marp-core'
import layout from '../engine/layout.mjs'
import { defaultDeckTheme, normalizeDeckDesign, generateDesignCSS, validateAdvancedCSS } from '../engine/design-system.mjs'
import { getDeckDesign, applyDeckDesign, findDeckDesignBlock, getSlideAppearance, setSlideAppearance } from '../editor/theme-store.mjs'
import { mapSource } from '../editor/source-store.mjs'
import { renderSource } from '../scripts/render.mjs'

const source = '---\nmarp: true\ntheme: nju-unofficial-v2\nstyle: |\n  section { letter-spacing: 0; }\n---\n<style>\nsection .custom { color: red; }\n</style>\n\n<!-- _class: title-slide -->\n# First\n\n---\n# Second\n'

test('unmanaged source has detached theme defaults without changing its authored source', () => {
  const design = getDeckDesign(source)
  assert.deepEqual(design, { theme: defaultDeckTheme, css: '' })
  design.theme.palettes.light.background = '#000000'
  assert.equal(getDeckDesign(source).theme.palettes.light.background, '#ffffff')
  assert.equal(findDeckDesignBlock(source), null)
})

test('managed design round trips and replaces only its own block', () => {
  const design = normalizeDeckDesign({ theme: { title_size: 62, palettes: { dark: { accent: '#abc' } } }, css: 'section .custom { border: 1px solid red; }\n' })
  const changed = applyDeckDesign(source, design)
  assert.deepEqual(getDeckDesign(changed), design)
  const range = findDeckDesignBlock(changed)
  assert.equal(changed.slice(0, range.start) + changed.slice(range.end), source)
  assert.equal(mapSource(changed).slides.length, 2)
  assert.equal(applyDeckDesign(changed, design), changed)
  const revised = applyDeckDesign(changed, { theme: { body_size: 31 }, css: 'section { opacity: .95; }' })
  const next = findDeckDesignBlock(revised)
  assert.equal(revised.slice(0, next.start) + revised.slice(next.end), source)
  assert.equal(getDeckDesign(revised).theme.body_size, 31)
})

test('managed blocks preserve CRLF and ignore literal marker examples in fenced code', () => {
  const literal = '# Example\n\n```html\n<!-- marp-v2-design:begin -->\n<!-- marp-v2-design:end -->\n```\n'
  assert.equal(findDeckDesignBlock(literal), null)
  const original = (source + literal).replaceAll('\n', '\r\n')
  const changed = applyDeckDesign(original, { css: 'section { color: #abcdef; }' })
  const range = findDeckDesignBlock(changed)
  assert.equal(changed.slice(0, range.start) + changed.slice(range.end), original)
  assert.doesNotMatch(changed, /(?<!\r)\n/)
})

test('design and appearance insertion keep frontmatter valid when its closing fence is at EOF', () => {
  for (const eol of ['\n', '\r\n']) {
    const original = ['---', 'marp: true', '---'].join(eol)
    const themed = applyDeckDesign(original, { theme: { title_size: 55 } })
    assert.ok(themed.startsWith(original + eol + '<!-- marp-v2-design:begin -->'))
    assert.equal(getDeckDesign(themed).theme.title_size, 55)
    const dark = setSlideAppearance(original, 1, 'dark')
    assert.equal(dark, original + eol + '<!-- _appearance: dark -->' + eol)
    assert.equal(getSlideAppearance(dark, 1), 'dark')
  }
})

test('theme validation rejects malformed presets and CSS that can escape the source style block', () => {
  for (const theme of [{ title_size: 0 }, { body_size: '26' }, { unknown: true }, { show_page_numbers: 'false' }, { appearance: 'auto' }, { font_family: 'Arial; color:red' }, { palettes: { dark: { text: 'red' } } }, { palettes: { bad: {} } }]) {
    assert.throws(() => normalizeDeckDesign({ theme }))
  }
  for (const css of ['section { color: red;', 'section { color: red; } </STYLE><script>alert(1)</script>', '/* marp-v2-design:begin */']) {
    assert.throws(() => validateAdvancedCSS(css))
  }
  assert.equal(validateAdvancedCSS('@media print { section { color: #123; } }'), '@media print { section { color: #123; } }')
  assert.throws(() => getDeckDesign('<!-- marp-v2-design:begin -->\n# Incomplete\n'))
})

test('generated CSS exposes all shared roles and complete coordinated palettes', () => {
  const css = generateDesignCSS({ title_size: 60, font_family: 'DIN 2014, serif', show_page_numbers: false, appearance: 'dark' })
  assert.match(css, /--deck-font-family:\s*"DIN 2014", serif/)
  assert.match(css, /--deck-title-size:\s*60px/)
  for (const role of ['body','caption','reference','footer','page-number']) assert.match(css, new RegExp(`--deck-${role}-size:`))
  for (const mode of ['light','dark']) for (const role of ['background','text','title','muted','accent','rule']) assert.match(css, new RegExp(`--deck-${mode}-${role}:`))
  assert.match(css, /--deck-background:\s*var\(--deck-dark-background\)/)
  assert.match(css, /--deck-page-number-display:\s*none/)
})

test('cover typography can override shared title styles without changing old presets', () => {
  const old = normalizeDeckDesign({ theme: { title_size: 60 } })
  assert.equal(old.theme.cover_title_size, null)
  assert.match(generateDesignCSS(old.theme), /--deck-cover-title-size:61\.4548px/)
  const theme = { title_size: 50, title_font_family: 'Arial, sans-serif', title_weight: 600, cover_title_size: 64, cover_title_font_family: 'Georgia, serif', cover_title_weight: 700 }
  const stored = getDeckDesign(applyDeckDesign(source, { theme })).theme
  for (const [key, value] of Object.entries(theme)) assert.equal(stored[key], value)
  const css = generateDesignCSS(stored)
  assert.match(css, /--deck-title-size:50px/)
  assert.match(css, /--deck-cover-title-size:64px/)
  assert.match(css, /--deck-cover-title-font-family:"Georgia", serif/)
  assert.match(css, /--deck-title-weight:600/)
  assert.match(css, /--deck-cover-title-weight:700/)
  for (const theme of [{ cover_title_size: 0 }, { cover_title_size: '64' }, { title_weight: 750 }, { cover_title_weight: 0 }, { cover_title_font_family: 'Arial; color:red' }]) assert.throws(() => normalizeDeckDesign({ theme }))
  assert.doesNotMatch(generateDesignCSS({ title_font_family: null, cover_title_weight: null }), /--deck-title-font-family:|--deck-cover-title-weight:/)
})

test('master position offsets default to zero, round trips and validate each axis', () => {
  const fields = ['title_dx', 'title_dy', 'footer_dx', 'footer_dy', 'page_number_dx', 'page_number_dy']
  const oldPreset = { title_size: 52, body_size: 28 }
  for (const key of fields) {
    assert.equal(normalizeDeckDesign({ theme: oldPreset }).theme[key], 0)
    const bound = key.endsWith('_dx') ? 1280 : 720
    for (const value of [-bound, 0, bound, 10.12568]) {
      const design = normalizeDeckDesign({ theme: { [key]: value } })
      assert.equal(design.theme[key], Number(value.toFixed(4)))
      assert.equal(getDeckDesign(applyDeckDesign(source, design)).theme[key], Number(value.toFixed(4)))
      assert.match(generateDesignCSS(design.theme), new RegExp(`--deck-${key.replaceAll('_', '-')}:${Number(value.toFixed(4))}px`))
    }
    for (const value of [-bound - 0.1, bound + 0.1, NaN, Infinity, '0', null]) assert.throws(() => normalizeDeckDesign({ theme: { [key]: value } }))
  }
  assert.match(generateDesignCSS(), /--deck-title-translate:none/)
  assert.match(generateDesignCSS(), /--deck-page-number-translate:none/)
  assert.match(generateDesignCSS({ title_dx: 20, title_dy: -30 }), /--deck-title-translate:20px -30px/)
})

test('appearance edits keep classes, slide content, YAML, and literal examples intact', () => {
  const original = source + '\n```html\n<!-- _appearance: dark -->\n```\n'
  let changed = setSlideAppearance(original, 2, 'dark')
  assert.equal(getSlideAppearance(changed, 1), 'inherit')
  assert.equal(getSlideAppearance(changed, 2), 'dark')
  assert.match(changed, /<!-- _class: title-slide -->/)
  changed = setSlideAppearance(changed, 2, 'light')
  assert.equal(getSlideAppearance(changed, 2), 'light')
  changed = setSlideAppearance(changed, 2, 'inherit')
  assert.equal(changed, original)
  assert.throws(() => setSlideAppearance(source, 99, 'dark'))
  assert.throws(() => setSlideAppearance(source, 1, 'sepia'))
})

test('appearance edits preserve neighboring directives in multi-line comments and CRLF', () => {
  const original = '---\r\nmarp: true\r\n---\r\n<!--\r\n_class: title-slide\r\n_appearance: dark\r\n_paginate: false\r\n-->\r\n# Title\r\n'
  const changed = setSlideAppearance(original, 1, 'light')
  assert.equal(changed, original.replace('_appearance: dark', '_appearance: light'))
  const inherited = setSlideAppearance(changed, 1, 'inherit')
  assert.match(inherited, /_class: title-slide\r\n_paginate: false/)
  assert.equal(getSlideAppearance(inherited, 1), 'inherit')
})

test('appearance render metadata applies palette references without changing class or pagination', () => {
  const diagnostics = []
  const marp = new Marp({ html: true, inlineSVG: true }).use(layout, { onDiagnostic: d => diagnostics.push(d) })
  const { html } = marp.render('---\nmarp: true\npaginate: true\n---\n<!-- _class: title-slide -->\n<!-- _appearance: dark -->\n# Dark\n\n---\n# Inherited\n\n---\n<!-- _appearance: light -->\n# Light')
  assert.deepEqual(diagnostics, [])
  const sections = [...html.matchAll(/<section\b[^>]*>/g)].map(m => m[0])
  assert.match(sections[0], /class="title-slide"/)
  assert.match(sections[0], /data-appearance="dark"/)
  assert.match(sections[0], /--deck-background:var\(--deck-dark-background\)/)
  assert.match(sections[1], /data-appearance="inherit"/)
  assert.match(sections[2], /data-appearance="light"/)
  assert.match(html, /data-marpit-pagination="3"/)
})

test('managed page numbers enable numbering without changing source or per-slide suppression', async () => {
  for (const setting of ['', 'paginate: false\n']) {
    const original = `---\nmarp: true\ntheme: nju-unofficial-v2\n${setting}---\n# First\n\n---\n<!-- _paginate: false -->\n# Hidden\n\n---\n# Third\n\n\`\`\`html\n<!-- _paginate: false -->\n\`\`\`\n`
    const unmanaged = await renderSource(original)
    assert.doesNotMatch(unmanaged.html, /data-marpit-pagination="/)
    const changed = applyDeckDesign(original, { theme: { show_page_numbers: true } })
    const rendered = await renderSource(changed)
    assert.equal(rendered.source, changed)
    assert.deepEqual(rendered.diagnostics, [])
    const sections = [...rendered.html.matchAll(/<section\b[^>]*>/g)].map(match => match[0])
    assert.match(sections[0], /data-marpit-pagination="1"/)
    assert.doesNotMatch(sections[1], /data-marpit-pagination="/)
    assert.match(sections[2], /data-marpit-pagination="3"/)
    assert.match(sections[2], /data-marpit-pagination-total="3"/)
  }
})

test('managed numbering retains frontmatter spot directives, inline spots and skip or hold counting', async () => {
  const original = `---\nmarp: true\ntheme: nju-unofficial-v2\npaginate: false\n_paginate: false\n---\n# Hidden cover\n\n---\n# Second\n\n---\n<!-- _paginate: skip -->\n# Skipped\n\n---\n<!-- _paginate: hold -->\n# Held\n\n---\n# Hidden inline\nText <!-- _paginate: false -->\n\n---\n# Last\n`
  const rendered = await renderSource(applyDeckDesign(original, { theme: { show_page_numbers: true } }))
  const sections = [...rendered.html.matchAll(/<section\b[^>]*>/g)].map(match => match[0])
  assert.doesNotMatch(sections[0], /data-marpit-pagination="/)
  assert.match(sections[1], /data-marpit-pagination="2"/)
  assert.doesNotMatch(sections[2], /data-marpit-pagination="/)
  assert.match(sections[3], /data-marpit-pagination="2"/)
  assert.doesNotMatch(sections[4], /data-marpit-pagination="/)
  assert.match(sections[5], /data-marpit-pagination="4"/)
  assert.match(sections[5], /data-marpit-pagination-total="4"/)
})

test('malformed managed designs return actionable diagnostics and a recoverable source preview', async () => {
  const malformed = [
    '<!-- marp-v2-design:begin -->\n# Recoverable\n',
    '<!-- marp-v2-design:begin -->\n<!-- marp-v2-design:metadata {invalid} -->\n<!-- marp-v2-design:end -->\n# Recoverable\n',
    applyDeckDesign('# Recoverable\n', {}).replace('"title_size":47.84', '"title_size":0'),
  ]
  for (const original of malformed) {
    const rendered = await renderSource(original)
    assert.equal(rendered.source, original)
    assert.match(rendered.html, /<h1[^>]*>Recoverable<\/h1>/)
    const diagnostic = rendered.diagnostics.find(item => item.code === 'invalid-design')
    assert.equal(diagnostic?.severity, 'error')
    assert.ok(diagnostic.message.length > 10)
  }
})
