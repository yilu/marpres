import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium} from 'playwright-chromium'
import {exportHTML} from '../scripts/html-export.mjs'
import {preparePrintPage} from '../scripts/print.mjs'

test('offline linked originals retain dimensions, crop and cumulative stages through PDF export',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'marpres-linked-browser-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const name='图 plot 50% #&.svg',file=join(dir,'slides.md'),output=join(dir,'dist','linked.html')
 await writeFile(join(dir,name),'<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000" fill="red"/></svg>')
 await writeFile(file,`---\nmarp: true\ntheme: nju-unofficial-v2\n---\n# Crop\n\n::: figure id=plot width=300 crop=25,0,50,100\n![plot](${encodeURIComponent(name)})\n:::\n\n::: box id=next stage=1\n![again](${encodeURIComponent(name)})\n:::\n`)
 const {deck}=await exportHTML(file,{output,linkImages:true});assert.deepEqual(deck.diagnostics,[])
 assert.deepEqual(await readdir(join(dir,'dist')),['linked.html'])
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close())
 const page=await browser.newPage();await page.goto(pathToFileURL(output).href,{waitUntil:'networkidle'});await preparePrintPage(page)
 const images=await page.locator('img').evaluateAll(images=>images.map(image=>({complete:image.complete,width:image.naturalWidth,height:image.naturalHeight,src:image.src})))
 assert.ok(images.length>=2)
 assert.ok(images.every(image=>image.complete&&image.width===2000&&image.height===1000&&image.src.startsWith('file:')))
 assert.equal(await page.locator('.figure-frame').first().evaluate(el=>Math.round(el.getBoundingClientRect().width)),300)
 const pdf=await page.pdf({printBackground:true,preferCSSPageSize:true});assert.equal(pdf.subarray(0,5).toString(),'%PDF-')
})
