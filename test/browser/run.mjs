import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-chromium'
import { renderFile,documentHTML } from '../../scripts/render.mjs'
await mkdir('dist/validation',{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
try {
 const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1})
 const result=await renderFile('test/fixtures/edge-cases.md')
 const html=resolve('dist/validation/edge-cases.html');await writeFile(html,documentHTML(result));await page.goto(`file://${html}`)
 await page.evaluate(()=>document.fonts.ready)
 const measurements=await page.evaluate(()=>[...document.querySelectorAll('section')].map(s=>{
   const origin=s.getBoundingClientRect(),scale=origin.width/1280,r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return{x:(b.x-origin.x)/scale,y:(b.y-origin.y)/scale,w:b.width/scale,h:b.height/scale,bottom:(b.bottom-origin.y)/scale}}
   return {heading:r(s.querySelector('.deck-heading')),content:r(s.querySelector('.deck-content')),footer:r(s.querySelector('.deck-footer')),panels:[...s.querySelectorAll('.panel')].map(p=>({box:r(p),image:r(p.querySelector('img')),list:r(p.querySelector('ul')),caption:r(p.querySelector('.panel-caption')),ref:r(p.querySelector('.panel-ref'))}))}
 }))
 await writeFile('dist/validation/geometry.json',JSON.stringify({diagnostics:result.diagnostics,measurements},null,2))
 const mixed=measurements[1].panels[0]
 assert.ok(mixed.image.bottom<=mixed.list.y+1,'Image must not overlap bullets')
 assert.equal(measurements[2].panels.length,2)
 assert.ok(measurements[2].panels[1].box.x>600,'Interleaved paragraph must not create a third column')
 const grid=measurements[3]
 assert.ok(grid.panels[0].ref.bottom<=grid.panels[2].box.y,'Multiline reference contained above next row')
 assert.ok(grid.panels[2].ref.bottom<=grid.footer.y,'Bottom reference contained above footer')
 for(const index of [4,5])assert.ok(measurements[index].heading.bottom<=measurements[index].content.y,'Heading content does not overlap')
 assert.equal(measurements[6].panels[0].box.y,measurements[7].panels[0].box.y)
 assert.ok(result.diagnostics.some(d=>d.code==='panel-placement'&&d.slide===9))
 assert.ok(Math.abs(measurements[9].panels[0].image.w-200)<1,'Legacy w:200 remains precise')
 for(const n of [1,3,4,5])await page.locator('section').nth(n).screenshot({path:`dist/validation/case-${n+1}.png`})
 for(const name of ['demo']) {
   const deck=await renderFile(`slides/${name}.md`);assert.equal(deck.diagnostics.length,0,JSON.stringify(deck.diagnostics))
   const path=resolve(`dist/validation/${name}.html`);await writeFile(path,documentHTML(deck));await page.goto(`file://${path}`);await page.evaluate(()=>document.fonts.ready)
   // The public demo includes reveal stages. Print mode exposes every exported
   // page for geometry checks; the interactive viewer displays one at a time.
   await page.waitForFunction(()=>window.__marpStagesReady===true)
   await page.emulateMedia({media:'print'})
   for(let n=0;n<await page.locator('section').count();n++)await page.locator('section').nth(n).screenshot({path:`dist/validation/${name}-${n+1}.png`})
   const overflow=await page.evaluate(()=>[...document.querySelectorAll('.figure-frame,.layout-box,.layout-caption,.layout-ref')].flatMap(el=>{
     const b=el.getBoundingClientRect(),s=el.closest('section').getBoundingClientRect();return b.x<s.x-.1||b.right>s.right+.1||b.y<s.y-.1||b.bottom>s.bottom+.1?[{id:el.dataset.editId,x:b.x-s.x,y:b.y-s.y,width:b.width,height:b.height}]:[]
   }))
   assert.deepEqual(overflow,[],`${name}: slide overflow`)
 }
 console.log('Browser layout checks passed: mixed flow, semantic columns, multiline references/headings, spans, image width, sample bounds.')
}finally{await browser.close()}
