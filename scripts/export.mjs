import { basename, dirname, extname } from 'node:path'
import { chromium } from 'playwright-chromium'
import { SourceError } from '../editor/source-store.mjs'
import { renderSource, documentHTML } from './render.mjs'
import { preparePrintPage } from './print.mjs'

export async function exportDeckPDF(store,{hash}) {
  const snapshot=await store.read()
  if(!hash||snapshot.hash!==hash)throw store.conflict()
  const deck=await renderSource(snapshot.source,{baseDir:dirname(store.file)})
  const errors=deck.diagnostics.filter(item=>item.severity==='error')
  if(errors.length)throw new SourceError(`Cannot export this deck: ${errors.map(item=>item.message).join(' ')}`)
  const filename=basename(store.file,extname(store.file))+'.pdf'
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
  let buffer
  try {
    const page=await browser.newPage()
    // setContent keeps export in memory and renders only the confirmed snapshot.
    await page.setContent(documentHTML(deck,filename),{waitUntil:'load'})
    await preparePrintPage(page)
    buffer=await page.pdf({printBackground:true,preferCSSPageSize:true,width:'1280px',height:'720px',margin:{top:0,bottom:0,left:0,right:0}})
  } finally { await browser.close() }
  await store.guarded(snapshot.hash)
  return {buffer,filename}
}
