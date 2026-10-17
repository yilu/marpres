import assert from 'node:assert/strict'
import { chromium } from 'playwright-chromium'
import { shapeTypes, shapeGroups, renderShapeSVG } from '../engine/shapes.mjs'

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const examples = shapeTypes.flatMap(type => [[240, 120, 3], [80, 32, 40], [1, 1, 40], [1, 120, 40], [120, 1, 40], [12.25, 7.5, .1]].map(([width, height, stroke_width]) => ({
    type, width, height,
    svg: renderShapeSVG(type, { width, height, stroke_width, stroke: '#123456', fill: '#fedcba' }),
  })))
  await page.setContent(examples.map(({ type, width, height, svg }) => `<div data-shape="${type}" style="width:${width}px;height:${height}px">${svg}</div>`).join(''))
  const failures = await page.locator('[data-shape]').evaluateAll(frames => frames.flatMap(frame => {
    const svg = frame.querySelector('svg'), { width, height } = svg.viewBox.baseVal
    const failures = []
    const parsed = new DOMParser().parseFromString(svg.outerHTML, 'image/svg+xml')
    if (parsed.querySelector('parsererror')) failures.push(`${frame.dataset.shape}: invalid XML`)
    for (const element of svg.querySelectorAll('path, polygon, rect, ellipse')) {
      const bounds = element.getBBox(), halfStroke = Number(element.getAttribute('stroke-width')) / 2, tolerance = .001
      const edges = [bounds.x - halfStroke, bounds.y - halfStroke, bounds.x + bounds.width + halfStroke, bounds.y + bounds.height + halfStroke]
      if (!edges.every(Number.isFinite) || edges[0] < -tolerance || edges[1] < -tolerance || edges[2] > width + tolerance || edges[3] > height + tolerance) failures.push(`${frame.dataset.shape} ${width}×${height}: stroke outside frame ${JSON.stringify(edges)}`)
      if (!(element.getTotalLength() > 0)) failures.push(`${frame.dataset.shape} ${width}×${height}: empty geometry`)
    }
    return failures
  }))
  assert.deepEqual(failures, [], 'Every path and its round stroke must fit inside its authored frame')
  assert.deepEqual(errors, [], 'Chrome must accept every SVG path and numeric attribute')

  await page.setContent(`<style>
    body { margin: 0; padding: 32px; font: 13px system-ui; color: #303a4b; background: #f3f5f8; }
    h2 { font-size: 17px; margin: 24px 0 12px; }
    .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; }
    .shape { height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px solid #dce2ea; border-radius: 10px; background: white; }
    .icon { width: 56px; height: 40px; }
    .label { font-size: 11px; }
  </style>${shapeGroups.map(group => `<h2>${group.name}</h2><div class="grid">${group.shapes.map(shape => `<div class="shape"><div class="icon">${shape.svg}</div><div class="label">${shape.label}</div></div>`).join('')}</div>`).join('')}`)
  if (process.env.SHAPE_GALLERY_SCREENSHOT) await page.screenshot({ path: process.env.SHAPE_GALLERY_SCREENSHOT, fullPage: true })
  assert.equal(await page.locator('.shape').count(), 32)
  assert.deepEqual(errors, [], 'Gallery thumbnails must render without errors')
  console.log(`Shape browser checks passed: ${shapeTypes.length} presets, ${examples.length} normal/tiny frame and stroke bounds, valid SVG, gallery thumbnails.`)
} finally {
  await browser.close()
}
