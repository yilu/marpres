import test from 'node:test'
import assert from 'node:assert/strict'
import { getSlideAppearance, getSlideAppearances } from '../editor/theme-store.mjs'
import { mapSource } from '../editor/source-store.mjs'

test('batch appearances preserve slide boundaries, literal examples, and last directive semantics', () => {
  const source = '# First\n<!-- _appearance: dark -->\n<!-- _appearance: light -->\n---\n# Second\n```html\n<!-- _appearance: dark -->\n```\n---\n# Third\n<!-- _appearance: "dark" -->\n'
  for (const text of [source, source.replaceAll('\n', '\r\n'), source.replace('"dark"', 'invalid')]) {
    const mapping = mapSource(text)
    assert.deepEqual(getSlideAppearances(text, mapping), mapping.slides.map(({ slide }) => getSlideAppearance(text, slide)))
  }
  assert.deepEqual(getSlideAppearances(source), ['light', 'inherit', 'dark'])
})
