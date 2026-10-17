import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright-chromium'
import { renderFile,documentHTML } from '../scripts/render.mjs'
const dir=await mkdtemp(join(tmpdir(),'marp-authoring-export-'))
const file=join(dir,'stages.md')
const source=`---
marp: true
theme: nju-unofficial-v2
paginate: true
---
# Reveals
::: box id=base width=350 font_family="Georgia, serif" font=31 bold=true italic=true underline=true strike=true color=#123456 align=right
Visible from start with \`inline code\`.
:::
::: box id=middle width=350 height=80 stage=2
Revealed second.
::: shape id=nested-shape shape=rect dx=20 dy=20 width=40 height=40
:::
:::
::: box id=last stage=5
Final reveal $x^2$.
:::
::: box id=inserted position=absolute dx=480 dy=380 width=360
Inserted text.
:::
::: shape id=arrow shape=arrow dx=650 dy=240 width=240 height=32 rotate=30 stroke=#7a005f stroke_width=3 stage=2
:::
<svg width="80" height="40"><defs><path id="glyph" d="M0 0H40V20H0Z"/><clipPath id="clip"><rect width="40" height="20"/></clipPath></defs><use href="#glyph" clip-path="url(#clip)"/></svg>

---
# Ordinary
::: box id=ordinary font_family="DIN 2014, serif"
One page without stages.
:::
`
let browser
try {
  await writeFile(file,source)
  const deck=await renderFile(file)
  assert.deepEqual(deck.diagnostics,[])
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
  const page=await browser.newPage({viewport:{width:1400,height:950}})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent(documentHTML(deck),{waitUntil:'load'})
  await page.evaluate(()=>document.fonts.ready)
  assert.equal(await page.locator('.marpit > svg').count(),4,'Used stages 0,2,5 plus ordinary slide must become four physical pages')
  assert.deepEqual(await page.locator('.marpit > svg').evaluateAll(nodes=>nodes.map(n=>[n.dataset.sourceSlide,n.dataset.exportStage])),[['1','0'],['1','2'],['1','5'],['2','0']])
  assert.equal(await page.locator('.marpit > svg:visible').count(),1)
  assert.equal(await page.locator('#stage-page-label').textContent(),'Slide 1 · Stage 0 · 1 / 4')
  const first=page.locator('.marpit > svg').nth(0)
  const second=page.locator('.marpit > svg').nth(1)
  const styles=await first.locator('[data-edit-id="base"]').evaluate(el=>{const s=getComputedStyle(el);return {family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,italic:s.fontStyle,decoration:s.textDecorationLine,color:s.color,align:s.textAlign}})
  assert.deepEqual(styles,{family:'Georgia, serif',size:'31px',weight:'700',italic:'italic',decoration:'underline line-through',color:'rgb(18, 52, 86)',align:'right'})
  assert.equal(await first.locator('code').evaluate(el=>getComputedStyle(el).color),'rgb(18, 52, 86)','Inline code inherits readable text colour')
  const inserted=await first.locator('[data-edit-id="inserted"]').evaluate(el=>({position:getComputedStyle(el).position,relativeToSlide:el.offsetParent===el.closest('section'),left:el.offsetLeft,top:el.offsetTop}))
  assert.deepEqual(inserted,{position:'absolute',relativeToSlide:true,left:0,top:0},'Free text is anchored to the slide and removed from panel flow')
  const bounds=await first.locator('[data-edit-id="last"]').evaluate(el=>({top:el.offsetTop,height:el.offsetHeight}))
  assert.equal(await first.locator('[data-edit-id="middle"]').evaluate(el=>getComputedStyle(el).visibility),'hidden')
  await page.click('#stage-next')
  assert.equal(await page.locator('#stage-page-label').textContent(),'Slide 1 · Stage 2 · 2 / 4')
  assert.equal(await second.locator('[data-edit-id="middle"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
  assert.equal(await second.locator('[data-edit-id="last"]').evaluate(el=>getComputedStyle(el).visibility),'hidden')
  assert.deepEqual(await second.locator('[data-edit-id="last"]').evaluate(el=>({top:el.offsetTop,height:el.offsetHeight})),bounds,'Hiding a stage must reserve its layout space')
  const nested=await second.locator('[data-edit-id="nested-shape"]').evaluate(el=>({relativeToSlide:el.offsetParent===el.closest('section'),stage:el.dataset.stage}))
  assert.deepEqual(nested,{relativeToSlide:true,stage:'2'},'Nested free shapes keep slide coordinates and inherit parent reveal timing')
  const shape=await second.locator('[data-edit-id="arrow"]').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect(),slide=el.closest('section').getBoundingClientRect();return {position:s.position,origin:s.transformOrigin,matrix:s.transform,centerX:((r.left+r.right)/2-slide.left)*1280/slide.width,centerY:((r.top+r.bottom)/2-slide.top)*720/slide.height,vector:el.querySelector('path').getAttribute('vector-effect')}})
  assert.equal(shape.position,'absolute')
  assert.equal(shape.origin,'120px 16px')
  assert.ok(Math.abs(shape.centerX-770)<0.1&&Math.abs(shape.centerY-256)<0.1,JSON.stringify(shape))
  assert.equal(shape.vector,'non-scaling-stroke')
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('#stage-page-label').textContent(),'Slide 1 · Stage 5 · 3 / 4')
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('#stage-page-label').textContent(),'Slide 2 · Stage 0 · 4 / 4')
  assert.equal(await page.locator('#stage-next').isDisabled(),true)
  const numericFont=await page.locator('[data-edit-id="ordinary"]').evaluate(el=>({value:getComputedStyle(el).fontFamily,accepted:CSS.supports('font-family',el.style.fontFamily)}))
  assert.equal(numericFont.accepted,true)
  assert.equal(numericFont.value,'"DIN 2014", serif')
  const identifiers=await page.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id))
  assert.equal(new Set(identifiers).size,identifiers.length,'Expanded pages must not duplicate SVG or HTML identifiers')
  const references=await page.locator('use').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('href').slice(1),exists:!!document.getElementById(n.getAttribute('href').slice(1)),samePage:document.getElementById(n.getAttribute('href').slice(1))?.closest('[data-marpit-svg]')===n.closest('[data-marpit-svg]'),clip:n.getAttribute('clip-path')})))
  assert.equal(references.length,3)
  assert.ok(references.every(r=>r.exists&&r.samePage),JSON.stringify(references))
  await page.emulateMedia({media:'print'})
  assert.equal(await page.locator('.marpit > svg:visible').count(),4,'Print media must include every cumulative stage')
  assert.equal(await page.locator('#stage-controls').isVisible(),false)
  assert.deepEqual(errors,[])
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/build.mjs',import.meta.url)),file],{cwd:dir})
  const pdf=await readFile(join(dir,'dist/stages.pdf'))
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,4,'PDF must contain one actual page per cumulative stage')
  await writeFile(file,source.slice(0,source.indexOf('# Reveals'))+'# Ordinary only\n\nPlain text.\n')
  await page.emulateMedia({media:'screen'})
  await page.setContent(documentHTML(await renderFile(file)))
  assert.equal(await page.locator('.marpit > svg').count(),1)
  assert.equal(await page.locator('#stage-controls').count(),0,'Ordinary decks preserve their existing document view')
  console.log('Authoring export browser checks passed: computed text styles, slide-relative rotated shapes, cumulative stages, reserved layout, keyboard navigation, unique SVG references, four PDF pages, ordinary deck preservation.')
} finally {
  await browser?.close()
  await rm(dir,{recursive:true,force:true})
}
