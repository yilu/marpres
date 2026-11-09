import { basename, dirname, extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-chromium'
import { SourceError } from '../editor/source-store.mjs'
import { renderSource, documentHTML } from './render.mjs'
import { preparePrintPage } from './print.mjs'

export async function exportDeckPDF(store,{hash}) {
  const snapshot=await store.read()
  if(!hash||snapshot.hash!==hash)throw store.conflict()
  const filename=basename(store.file,extname(store.file))+'.pdf'
  const temporary=await mkdtemp(join(tmpdir(),'marpres-pdf-'))
  let browser
  try {
    // Freeze original image bytes beside a small HTML snapshot. Sending a large
    // deck's data URLs through setContent can close the Chromium renderer.
    const assets=new Map(),extensions={'image/svg+xml':'svg','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'}
    const deck=await renderSource(snapshot.source,{baseDir:dirname(store.file),resolveAsset:(bytes,type)=>{
      const name=createHash('sha256').update(type).update(bytes).digest('hex')+'.'+(extensions[type]||'bin')
      assets.set(name,bytes)
      return 'assets/'+name
    }})
    const errors=deck.diagnostics.filter(item=>item.severity==='error')
    if(errors.length)throw new SourceError(`Cannot export this deck: ${errors.map(item=>item.message).join(' ')}`)
    await mkdir(join(temporary,'assets'))
    await Promise.all([...assets].map(([name,bytes])=>writeFile(join(temporary,'assets',name),bytes)))
    const html=join(temporary,'deck.html')
    await writeFile(html,documentHTML(deck,filename))
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
    const page=await browser.newPage()
    await page.goto(pathToFileURL(html).href,{waitUntil:'load'})
    await preparePrintPage(page)
    const buffer=await page.pdf({printBackground:true,preferCSSPageSize:true,width:'1280px',height:'720px',margin:{top:0,bottom:0,left:0,right:0}})
    await store.guarded(snapshot.hash)
    return {buffer,filename}
  } finally {
    try { await browser?.close() } finally { await rm(temporary,{recursive:true,force:true}) }
  }
}
