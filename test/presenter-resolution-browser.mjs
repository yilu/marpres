import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { chromium } from 'playwright-chromium'
import { renderSource } from '../scripts/render.mjs'

// The 1/3-slide-pixel stripes resolve to individual pixels at 3840px wide.
// Rendering the same pattern into a 300px PNG intentionally loses that detail.
const stripes = Array.from({ length: 450 }, (_, i) => `<rect x="${i * 2 / 3}" width="${1 / 3}" height="100" fill="black"/>`).join('')
const rasterPlaceholder = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const source = `---
theme: marpres
math: mathjax
---
<style>
section h1{font-size:40px!important;color:#123456!important}
@media(min-width:1600px){section h1{font-size:90px!important;color:red!important}}
#viewport-probe{width:10vw;height:10vh;font-size:2vw}
</style>

# Audience resolution

::: box id=copy font=30
HTML text and mathematics: $E = mc^2$.
:::

<p style="position:absolute;left:80px;top:310px">SVG · 450 pairs of fine lines</p>
<p style="position:absolute;left:700px;top:310px">PNG · the same pattern at 300 pixels</p>
<div id="viewport-probe" style="position:absolute;left:80px;top:230px;white-space:nowrap">Viewport-relative CSS stays consistent</div>
<svg id="vector-probe" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" style="position:absolute;left:80px;top:400px;width:300px;height:100px;background:white">${stripes}</svg>
<img id="raster-probe" src="${rasterPlaceholder}" style="position:absolute;left:700px;top:400px;width:300px;height:100px">

::: box id=reveal stage=3 position=absolute dx=80 dy=560 width=600
Third reveal
:::

---
# Second slide

::: box id=second
Independent slide geometry
:::
`
const deck = { ...await renderSource(source), startSlide: 1 }
assert.deepEqual(deck.diagnostics, [])
const artifacts = process.env.PRESENTER_RESOLUTION_ARTIFACTS
  ? resolve(process.env.PRESENTER_RESOLUTION_ARTIFACTS)
  : await mkdtemp(join(tmpdir(), 'marpres-resolution-browser-'))
await mkdir(artifacts, { recursive: true })
const files = new Set(['view.js', 'presenter.css', 'overlay.js', 'geometry.mjs'])
const server = createServer(async (request, response) => {
  if (request.url === '/deck') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(deck)); return
  }
  const name = request.url?.replace('/presenter/', '')
  if (request.url?.startsWith('/presenter/') && files.has(name)) {
    response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript')
    response.end(await readFile(new URL(`../presenter/${name}`, import.meta.url))); return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><link rel="stylesheet" href="/presenter/presenter.css">
    <div id="host" class="view-host" style="width:100vw;height:100vh"></div>
    <script type="module">
      import { SlideView } from '/presenter/view.js';
      import { createOverlay } from '/presenter/overlay.js';
      const deck=await(await fetch('/deck')).json();
      const canvas=document.createElement('canvas');canvas.width=300;canvas.height=100;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,300,100);ctx.fillStyle='black';
      for(let i=0;i<450;i++)ctx.fillRect(i*2/3,0,1/3,100);
      deck.html=deck.html.replace(${JSON.stringify(rasterPlaceholder)},canvas.toDataURL());
      window.view=new SlideView(document.querySelector('#host'),deck);
      window.actions=[];
      window.overlay=createOverlay({host:view.viewport,onAction:action=>actions.push(action)});
      await view.ready;window.ready=true;
    </script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const chrome = process.env.CHROME_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
let browser
const report = []

async function settle(page) {
  await page.evaluate(async () => {
    const doc = view.frame.contentDocument
    await doc.fonts.ready
    await Promise.all([...doc.images].map(image => image.decode()))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}
async function geometry(page) {
  return page.evaluate(() => {
    const frame = view.frame, doc = frame.contentDocument, root = doc.querySelector('.presenter-current')
    const rect = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height } }
    const section = root.querySelector('section'), text = root.querySelector('[data-edit-id="copy"]')
    const style = node => { const s = getComputedStyle(node); return { width: s.width, height: s.height, fontSize: s.fontSize } }
    const heading = getComputedStyle(root.querySelector('h1,marp-h1'))
    return {
      frame: rect(frame), frameViewport: [frame.clientWidth, frame.clientHeight],
      transform: getComputedStyle(frame).transform, viewport: rect(view.viewport),
      root: rect(root), viewBox: root.getAttribute('viewBox'), section: style(section), text: text && style(text),
      overlay: rect(document.querySelector('[data-presenter-overlay]')),
      rasterWidth: doc.querySelector('#raster-probe').naturalWidth,
      mathPaths: root.querySelectorAll('mjx-container svg path').length,
      authored: {
        heading: { fontSize: heading.fontSize, color: heading.color },
        viewportUnits: style(doc.querySelector('#viewport-probe')),
        wideMedia: frame.contentWindow.matchMedia('(min-width:1600px)').matches,
      },
    }
  })
}
async function samplePixels(page, screenshot) {
  return page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
    const sample = left => {
      const row = ctx.getImageData(left * devicePixelRatio, 1250 * devicePixelRatio, 900 * devicePixelRatio, 1).data
      let black = 0, white = 0, gray = 0, transitions = 0, previous
      for (let i = 0; i < row.length; i += 4) {
        const value = row[i], bit = value < 128
        if (value < 10) black++; else if (value > 245) white++; else gray++
        if (previous !== undefined && previous !== bit) transitions++
        previous = bit
      }
      return { black, white, gray, transitions }
    }
    return { pixels: [image.naturalWidth, image.naturalHeight], vector: sample(240), raster: sample(2100) }
  }, `data:image/png;base64,${screenshot.toString('base64')}`)
}

try {
  browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) })
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: dpr })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForFunction(() => window.ready)
    await settle(page)
    const audience = await geometry(page)
    const screenshot = await page.screenshot({ path: join(artifacts, `audience-4k-dpr${dpr}.png`) })
    const samples = await samplePixels(page, screenshot)
    assert.deepEqual(audience.authored, {
      heading: { fontSize: '40px', color: 'rgb(18, 52, 86)' },
      viewportUnits: { width: '128px', height: '72px', fontSize: '25.6px' },
      wideMedia: false,
    }, 'A 4K display must preserve the same authored media queries and viewport units as a slide preview')
    assert.deepEqual(audience.frameViewport, [1280, 720], 'The logical CSS viewport stays fixed independently of the display')
    assert.equal(audience.viewBox, '0 0 1280 720')
    assert.deepEqual([audience.section.width, audience.section.height], ['1280px', '720px'])
    assert.equal(audience.rasterWidth, 300, 'PNG assets retain their original resolution')
    assert.ok(audience.mathPaths > 0, 'MathJax remains SVG paths')
    assert.deepEqual(audience.root, { x: 0, y: 0, width: 1280, height: 720 })
    assert.deepEqual(audience.frame, { x: 0, y: 0, width: 3840, height: 2160 })
    assert.deepEqual(audience.overlay, audience.viewport)
    assert.deepEqual(samples.pixels, [3840 * dpr, 2160 * dpr])
    assert.equal(samples.vector.gray, 0, 'Subpixel slide details resolve to sharp physical pixels at 4K')
    assert.equal(samples.vector.transitions, 899, 'All 450 black/white line pairs remain distinguishable')
    assert.ok(samples.raster.gray > 850 * dpr, 'Enlarging a low-resolution PNG does not recreate lost vector detail')

    const resizes = []
    for (const [width, height] of [[1920, 1200], [3440, 1440], [640, 480], [3840, 2160]]) {
      await page.setViewportSize({ width, height }); await settle(page)
      const actual = await geometry(page), scale = Math.min(width / 1280, height / 720)
      assert.ok(Math.abs(actual.viewport.width - 1280 * scale) < .1)
      assert.ok(Math.abs(actual.viewport.height - 720 * scale) < .1)
      assert.ok(Math.abs(actual.viewport.x - (width - actual.viewport.width) / 2) < .1)
      assert.ok(Math.abs(actual.viewport.y - (height - actual.viewport.height) / 2) < .1)
      assert.deepEqual(actual.frameViewport, [1280, 720])
      assert.deepEqual(actual.authored, audience.authored, 'Preview and audience sizes retain identical authored typography and viewport-relative dimensions')
      assert.deepEqual(actual.section, audience.section)
      assert.deepEqual(actual.text, audience.text)
      assert.deepEqual(actual.frame, actual.viewport)
      assert.deepEqual(actual.overlay, actual.viewport, 'Annotations follow the fitted slide through host resizes')
      await page.mouse.move(actual.viewport.x + actual.viewport.width / 4, actual.viewport.y + actual.viewport.height / 4)
      const pointer = await page.evaluate(() => actions.filter(action => action.type === 'pointer' && action.point).at(-1)?.point)
      assert.ok(Math.abs(pointer.x - 320) < .1 && Math.abs(pointer.y - 180) < .1, 'Pointer coordinates stay in 1280×720 slide space')
      resizes.push({ width, height, authored: actual.authored, frameViewport: actual.frameViewport })
    }
    report.push({ dpr, audience, samples, resizes })
    await page.evaluate(() => {
      window.resizeCount = 0
      const resize = view.resize.bind(view)
      view.resize = () => { resizeCount++; resize() }
      document.querySelector('#host').style.width = '701px'
      document.querySelector('#host').style.height = '503px'
    })
    await settle(page)
    const resizeCount = await page.evaluate(() => resizeCount)
    await settle(page)
    assert.ok(resizeCount > 0 && resizeCount < 4, 'Host resize settles in a bounded number of observer callbacks')
    assert.equal(await page.evaluate(() => resizeCount), resizeCount, 'ResizeObserver does not feed back indefinitely')
    for (const stage of [0, 3]) {
      await page.evaluate(stage => view.update({ page: 0, stage, board: false, blank: false }), stage)
      const visibility = await page.evaluate(() => getComputedStyle(view.frame.contentDocument.querySelector('[data-edit-id="reveal"]')).visibility)
      assert.equal(visibility, stage === 0 ? 'hidden' : 'visible')
    }
    for (const patch of [{ page: 1 }, { page: 0, board: true }, { board: false, blank: true }, { blank: false }]) {
      await page.evaluate(patch => view.update({ ...view.position, ...patch }), patch)
      const actual = await page.evaluate(() => ({ hidden: getComputedStyle(view.frame).visibility === 'hidden', visibleRoots: [...view.frame.contentDocument.querySelectorAll('.marpit>svg[data-marpit-svg]')].map(svg => getComputedStyle(svg).display) }))
      assert.equal(actual.hidden, !!(patch.board || patch.blank))
      assert.equal(actual.visibleRoots.filter(value => value !== 'none').length, 1)
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`Presenter resolution checks passed: 4K at DPR 1/2, SVG physical-pixel detail, raster limitations, stable logical CSS viewport/media queries/typography, letterboxing/resizes, annotation coordinates, stage visibility, blanking, and ResizeObserver settling. Screenshots and report: ${artifacts}`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
