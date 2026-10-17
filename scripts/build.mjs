import { mkdir,writeFile } from 'node:fs/promises'
import { resolve,basename } from 'node:path'
import { chromium } from 'playwright-chromium'
import { renderFile,documentHTML } from './render.mjs'
import { preparePrintPage } from './print.mjs'
const file=resolve(process.argv[2]||'slides/demo.md')
const deck=await renderFile(file)
for(const d of deck.diagnostics)console.error(`${d.severity}: slide ${d.slide||'?'}: ${d.message}`)
if(deck.diagnostics.some(d=>d.severity==='error'))process.exit(1)
await mkdir('dist',{recursive:true})
const stem=basename(file,'.md'),html=resolve(`dist/${stem}.html`),pdf=resolve(`dist/${stem}.pdf`)
await writeFile(html,documentHTML(deck,stem))
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
try {
 const page=await browser.newPage()
 await page.goto(`file://${html}`,{waitUntil:'networkidle'})
 await preparePrintPage(page)
 await page.pdf({path:pdf,printBackground:true,preferCSSPageSize:true,width:'1280px',height:'720px',margin:{top:0,bottom:0,left:0,right:0}})
} finally {await browser.close()}
console.log(`Built ${html}\nBuilt ${pdf}`)
