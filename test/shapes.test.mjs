import test from 'node:test'
import assert from 'node:assert/strict'

const expectedTypes = [
  'rect', 'rounded-rect', 'ellipse', 'triangle', 'right-triangle', 'diamond',
  'pentagon', 'hexagon', 'octagon', 'parallelogram', 'trapezoid',
  'line', 'arrow', 'double-arrow', 'elbow-arrow', 'curve-arrow',
  'right-arrow', 'left-arrow', 'up-arrow', 'down-arrow', 'left-right-arrow', 'up-down-arrow',
  'star', 'heart', 'plus', 'chevron', 'callout', 'cloud',
  'left-bracket', 'right-bracket', 'left-brace', 'right-brace',
]
const library = () => import('../engine/shapes.mjs')

test('shape gallery and renderer share all common presets without duplicate types', async () => {
  let shapes
  await assert.doesNotReject(async () => { shapes = await library() }, 'The shared shape library must exist')
  const { shapeTypes, shapeGroups, renderShapeSVG } = shapes
  assert.deepEqual(shapeTypes, expectedTypes)
  assert.equal(new Set(shapeTypes).size, shapeTypes.length)
  assert.deepEqual(shapeGroups.flatMap(group => group.shapes.map(shape => shape.type)), shapeTypes)
  for (const group of shapeGroups) {
    assert.ok(group.name)
    for (const shape of group.shapes) {
      assert.ok(shape.label)
      assert.match(shape.svg, /^<svg\b/)
      assert.match(shape.svg, /preserveAspectRatio="xMidYMid meet"/, 'Gallery thumbnails preserve each preset’s natural proportions')
      assert.match(renderShapeSVG(shape.type), /^<svg\b/)
      assert.doesNotMatch(shape.svg, /\bid=|<script|<foreignObject|\bon\w+=|url\(/i)
    }
  }
})

test('shape SVG uses exact frame coordinates and finite contained stroke widths, even in tiny frames', async () => {
  const { shapeTypes, renderShapeSVG } = await library()
  for (const type of shapeTypes) {
    for (const [width, height, stroke_width] of [[240, 120, 3], [80, 32, 40], [1, 1, 40], [1, 120, 40], [120, 1, 40], [12.25, 7.5, 0.1]]) {
      const svg = renderShapeSVG(type, { width, height, stroke_width, stroke: '#123456', fill: '#fedcba' })
      assert.match(svg, new RegExp(`viewBox="0 0 ${width} ${height}"`), type)
      assert.doesNotMatch(svg, /NaN|Infinity|undefined|\bid=|<script|\btransform=/i, type)
      assert.match(svg, /vector-effect="non-scaling-stroke"/, type)
      assert.match(svg, /stroke="#123456"/, type)
      const drawnStroke = Number(svg.match(/stroke-width="([^"]+)"/)[1])
      assert.ok(drawnStroke > 0 && drawnStroke <= Math.min(width, height), `${type} ${width}×${height}`)
      assert.equal(drawnStroke, Math.min(stroke_width, width / 2, height / 2))
    }
  }
})

test('open connectors and brackets ignore fill while closed silhouettes retain it', async () => {
  const { shapeTypes, renderShapeSVG } = await library()
  const openTypes = new Set(['line', 'arrow', 'double-arrow', 'elbow-arrow', 'curve-arrow', 'left-bracket', 'right-bracket', 'left-brace', 'right-brace'])
  for (const type of shapeTypes) {
    assert.match(renderShapeSVG(type, { fill: '#abcdef' }), new RegExp(`fill="${openTypes.has(type) ? 'none' : '#abcdef'}"`), type)
  }
})

test('direct renderer rejects unknown types and never emits unsafe or nonfinite option values', async () => {
  const { renderShapeSVG } = await library()
  assert.throws(() => renderShapeSVG('unsupported'), /Unknown shape/)
  const svg = renderShapeSVG('rect', { width: NaN, height: -1, stroke_width: Infinity, stroke: '"><script>alert(1)</script>', fill: 'url(https://example.com/x)' })
  assert.match(svg, /viewBox="0 0 240 120"/)
  assert.doesNotMatch(svg, /NaN|Infinity|<script|url\(/i)
})

test('every gallery preset survives source validation and rendering with editable frame metadata', async () => {
  const { shapeTypes, renderShapeSVG } = await library()
  const { normalizeEditPatch } = await import('../engine/edit-options.mjs')
  const { Marp } = await import('@marp-team/marp-core')
  const { default: layout } = await import('../engine/layout.mjs')
  const diagnostics = []
  const source = shapeTypes.map(type => {
    assert.equal(normalizeEditPatch({ shape: type }, 'shape').shape, type)
    return `::: shape id=${type} shape=${type} dx=40 dy=80 width=1 height=1 rotate=23 stroke=#123456 stroke_width=40 fill=#fedcba stage=2\n:::`
  }).join('\n')
  const { html } = new Marp({ html: true }).use(layout, { onDiagnostic: diagnostic => diagnostics.push(diagnostic) }).render(source)
  assert.deepEqual(diagnostics, [])
  for (const type of shapeTypes) {
    const frame = html.match(new RegExp(`<div class="shape-frame editable-object"[^>]*data-edit-id="${type}"[^>]*>([\\s\\S]*?)</div>`))
    assert.ok(frame, type)
    assert.equal(frame[1].replaceAll(' />', '/>'), renderShapeSVG(type, { width: 1, height: 1, stroke: '#123456', stroke_width: 40, fill: '#fedcba' }), type)
    const metadata = JSON.parse(frame[0].match(/data-edit-options="([^"]+)"/)[1].replaceAll('&quot;', '"'))
    assert.equal(metadata.stroke_width, 40, 'Tiny-frame drawing must not rewrite the authored stroke')
    assert.equal(metadata.rotate, 23)
    assert.equal(metadata.stage, 2)
    assert.match(frame[0], /transform:translate\(40px,80px\) rotate\(23deg\)/)
  }
})
