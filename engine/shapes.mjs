// One catalogue drives authored shape validation, slide output, and the GUI gallery.
const presets = [
  ['Basic shapes', [
    ['rect', 'Rectangle'], ['rounded-rect', 'Rounded rectangle'], ['ellipse', 'Ellipse'],
    ['triangle', 'Triangle'], ['right-triangle', 'Right triangle'], ['diamond', 'Diamond'],
    ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['octagon', 'Octagon'],
    ['parallelogram', 'Parallelogram'], ['trapezoid', 'Trapezoid'],
  ]],
  ['Lines and arrows', [
    ['line', 'Line'], ['arrow', 'Arrow'], ['double-arrow', 'Double arrow'],
    ['elbow-arrow', 'Elbow arrow'], ['curve-arrow', 'Curved arrow'],
    ['right-arrow', 'Right arrow'], ['left-arrow', 'Left arrow'],
    ['up-arrow', 'Up arrow'], ['down-arrow', 'Down arrow'],
    ['left-right-arrow', 'Left–right arrow'], ['up-down-arrow', 'Up–down arrow'],
  ]],
  ['Symbols and callouts', [
    ['star', 'Star'], ['heart', 'Heart'], ['plus', 'Plus'], ['chevron', 'Chevron'],
    ['callout', 'Speech bubble'], ['cloud', 'Cloud'],
    ['left-bracket', 'Left bracket'], ['right-bracket', 'Right bracket'],
    ['left-brace', 'Left brace'], ['right-brace', 'Right brace'],
  ]],
]

export const shapeTypes = Object.freeze(presets.flatMap(([, shapes]) => shapes.map(([type]) => type)))
const openShapes = new Set(['line', 'arrow', 'double-arrow', 'elbow-arrow', 'curve-arrow', 'left-bracket', 'right-bracket', 'left-brace', 'right-brace'])
const positive = (value, fallback) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
const number = value => Number(value.toFixed(4))
const colour = (value, fallback) => typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value) ? value : fallback

function starPoints() {
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = index * Math.PI / 5 - Math.PI / 2, radius = index % 2 ? 0.22 : 0.5
    return [Math.cos(angle) * radius, Math.sin(angle) * radius]
  })
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y)
  const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top
  return points.map(([x, y]) => [(x - left) / width, (y - top) / height])
}
const star = starPoints()
const rightArrow = [[0, .3], [.62, .3], [.62, 0], [1, .5], [.62, 1], [.62, .7], [0, .7]]
const doubleArrow = [[0, .5], [.28, 0], [.28, .3], [.72, .3], [.72, 0], [1, .5], [.72, 1], [.72, .7], [.28, .7], [.28, 1]]

/** Render in the authored frame's coordinates, without IDs or scaled strokes. */
export function renderShapeSVG(type = 'rect', options = {}) {
  if (!shapeTypes.includes(type)) throw new Error(`Unknown shape: ${type}`)
  const width = positive(options.width, 240), height = positive(options.height, 120)
  // Keep a visible interior even when an authored stroke is wider than a tiny frame.
  // This affects only the drawing; editor metadata retains the authored stroke width.
  const strokeWidth = Math.min(positive(options.stroke_width, 3), width / 2, height / 2)
  const inset = strokeWidth / 2 + Math.min(1, Math.min(width, height) / 20)
  const innerWidth = width - 2 * inset, innerHeight = height - 2 * inset
  const x = value => number(inset + innerWidth * value), y = value => number(inset + innerHeight * value)
  const stroke = colour(options.stroke, '#7a005f')
  const fill = openShapes.has(type) || options.fill === 'none' ? 'none' : colour(options.fill, 'none')
  const attrs = `stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"`
  const path = segments => `<path d="${segments.map(([command, ...values]) => command + (values.length ? ' ' + values.map((value, index) => (index % 2 ? y : x)(value)).join(' ') : '')).join(' ')}" ${attrs}/>`
  const polygon = points => `<polygon points="${points.map(([px, py]) => `${x(px)},${y(py)}`).join(' ')}" ${attrs}/>`
  let drawing
  switch (type) {
    case 'rect': case 'rounded-rect':
      drawing = `<rect x="${x(0)}" y="${y(0)}" width="${number(innerWidth)}" height="${number(innerHeight)}"${type === 'rounded-rect' ? ` rx="${number(Math.min(innerWidth, innerHeight) * .16)}"` : ''} ${attrs}/>`
      break
    case 'ellipse':
      drawing = `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${number(innerWidth / 2)}" ry="${number(innerHeight / 2)}" ${attrs}/>`
      break
    case 'triangle': drawing = polygon([[.5, 0], [1, 1], [0, 1]]); break
    case 'right-triangle': drawing = polygon([[0, 0], [1, 1], [0, 1]]); break
    case 'diamond': drawing = polygon([[.5, 0], [1, .5], [.5, 1], [0, .5]]); break
    case 'pentagon': drawing = polygon([[.5, 0], [1, .382], [.809, 1], [.191, 1], [0, .382]]); break
    case 'hexagon': drawing = polygon([[.25, 0], [.75, 0], [1, .5], [.75, 1], [.25, 1], [0, .5]]); break
    case 'octagon': drawing = polygon([[.293, 0], [.707, 0], [1, .293], [1, .707], [.707, 1], [.293, 1], [0, .707], [0, .293]]); break
    case 'parallelogram': drawing = polygon([[.22, 0], [1, 0], [.78, 1], [0, 1]]); break
    case 'trapezoid': drawing = polygon([[.2, 0], [.8, 0], [1, 1], [0, 1]]); break
    case 'star': drawing = polygon(star); break
    case 'plus': drawing = polygon([[.35, 0], [.65, 0], [.65, .35], [1, .35], [1, .65], [.65, .65], [.65, 1], [.35, 1], [.35, .65], [0, .65], [0, .35], [.35, .35]]); break
    case 'chevron': drawing = polygon([[0, 0], [.65, 0], [1, .5], [.65, 1], [0, 1], [.35, .5]]); break
    case 'right-arrow': drawing = polygon(rightArrow); break
    case 'left-arrow': drawing = polygon(rightArrow.map(([px, py]) => [1 - px, py])); break
    case 'up-arrow': drawing = polygon(rightArrow.map(([px, py]) => [py, 1 - px])); break
    case 'down-arrow': drawing = polygon(rightArrow.map(([px, py]) => [py, px])); break
    case 'left-right-arrow': drawing = polygon(doubleArrow); break
    case 'up-down-arrow': drawing = polygon(doubleArrow.map(([px, py]) => [py, px])); break
    case 'heart':
      drawing = path([['M', .5, .98], ['C', .4, .85, 0, .62, 0, .3], ['C', 0, .02, .34, 0, .5, .22], ['C', .66, 0, 1, .02, 1, .3], ['C', 1, .62, .6, .85, .5, .98], ['Z']])
      break
    case 'callout':
      drawing = path([['M', .12, 0], ['L', .88, 0], ['Q', 1, 0, 1, .12], ['L', 1, .63], ['Q', 1, .75, .88, .75], ['L', .42, .75], ['L', .18, 1], ['L', .18, .75], ['L', .12, .75], ['Q', 0, .75, 0, .63], ['L', 0, .12], ['Q', 0, 0, .12, 0], ['Z']])
      break
    case 'cloud':
      drawing = path([['M', .23, .85], ['C', .06, .85, 0, .68, .1, .55], ['C', .01, .39, .17, .2, .34, .26], ['C', .38, .02, .7, .02, .76, .27], ['C', .93, .2, 1, .4, .92, .53], ['C', 1, .69, .88, .86, .72, .85], ['Z']])
      break
    case 'left-bracket': case 'right-bracket': {
      const mirror = type === 'right-bracket' ? value => 1 - value : value => value
      drawing = path([['M', mirror(1), 0], ['L', mirror(0), 0], ['L', mirror(0), 1], ['L', mirror(1), 1]])
      break
    }
    case 'left-brace': case 'right-brace': {
      const mirror = type === 'right-brace' ? value => 1 - value : value => value
      drawing = path([
        ['M', mirror(1), 0], ['C', mirror(.35), 0, mirror(.5), .25, mirror(.5), .35],
        ['Q', mirror(.5), .5, mirror(0), .5], ['Q', mirror(.5), .5, mirror(.5), .65],
        ['C', mirror(.5), .75, mirror(.35), 1, mirror(1), 1],
      ])
      break
    }
    case 'line': case 'arrow': case 'double-arrow': case 'elbow-arrow': case 'curve-arrow': {
      const head = Math.min(12 + strokeWidth, innerWidth / 3, innerHeight / (type === 'curve-arrow' ? 4 : 2))
      const hx = head / innerWidth, hy = head / innerHeight
      const tipY = type === 'elbow-arrow' ? 1 - hy : type === 'curve-arrow' ? .25 : .5
      const segments = type === 'elbow-arrow' ? [['M', 0, 0], ['L', 0, tipY], ['L', 1, tipY]]
        : type === 'curve-arrow' ? [['M', 0, 1], ['C', 0, 0, .55, tipY, 1, tipY]]
        : [['M', 0, .5], ['L', 1, .5]]
      if (type !== 'line') segments.push(['M', 1 - hx, tipY - hy], ['L', 1, tipY], ['L', 1 - hx, tipY + hy])
      if (type === 'double-arrow') segments.push(['M', hx, .5 - hy], ['L', 0, .5], ['L', hx, .5 + hy])
      drawing = path(segments)
      break
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${drawing}</svg>`
}

const thumbnailWidths = {
  diamond: 40, pentagon: 42, hexagon: 46, octagon: 40, star: 40, heart: 44, plus: 40, chevron: 40,
  'up-arrow': 32, 'down-arrow': 32, 'up-down-arrow': 32,
  'left-bracket': 14, 'right-bracket': 14, 'left-brace': 20, 'right-brace': 20,
}
export const shapeGroups = Object.freeze(presets.map(([name, shapes]) => Object.freeze({
  name,
  shapes: Object.freeze(shapes.map(([type, label]) => Object.freeze({
    type, label,
    svg: renderShapeSVG(type, { width: thumbnailWidths[type] || 56, height: 40, stroke: '#526075', stroke_width: 1.8, fill: '#e8edf5' }).replace('preserveAspectRatio="none"', 'preserveAspectRatio="xMidYMid meet"'),
  }))),
})))
