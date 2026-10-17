import { Marp } from '@marp-team/marp-core'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname,resolve,extname } from 'node:path'
import layout from '../engine/layout.mjs'
import { yaml } from '@marp-team/marpit/lib/markdown/directives/yaml.js'
import { findDeckDesignBlock, getDeckDesign } from '../editor/theme-store.mjs'
import { installStagePages,stagePageCSS } from './stages.mjs'
const themes=['marpres','nju-unofficial-v2'].map(name=>readFileSync(new URL(`../themes/${name}.css`,import.meta.url),'utf8'))
const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.gif':'image/gif','.webp':'image/webp'}

function enableManagedPageNumbers(marp, source) {
 // Work on parsed directives, not authored bytes or source line positions. Marpit
 // still owns numbering (including skip/hold), while explicit spot directives win.
 const frontMatter=source.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
 const firstSlideSpot=frontMatter!==undefined&&Object.hasOwn(yaml(frontMatter,!!marp.options.looseYAML)||{},'_paginate')
 marp.markdown.core.ruler.before('marpit_directives_apply','v2_theme_pagination',state=>{
  if(state.inlineMode)return
  let opening,hasSpot=firstSlideSpot,slide=0
  const readSpot=token=>{if(token.type==='marpit_comment'&&Object.hasOwn(token.meta?.marpitParsedDirectives||{},'_paginate'))hasSpot=true}
  for(const token of state.tokens) {
   if(token.type==='marpit_slide_open') {opening=token;hasSpot=++slide===1&&firstSlideSpot}
   else if(token.type==='marpit_slide_close') {
    const directives=opening?.meta?.marpitDirectives
    if(directives&&!hasSpot&&(directives.paginate===undefined||directives.paginate===false))directives.paginate=true
   } else {
    readSpot(token)
    if(token.type==='inline')for(const child of token.children||[])readSpot(child)
   }
  }
 })
}

export async function renderFile(file,{draft=false}={}) {
 return renderSource(await readFile(file,'utf8'),{baseDir:dirname(resolve(file)),draft})
}
export async function renderSource(source,{baseDir=process.cwd(),draft=false}={}) {
 const diagnostics=[]
 baseDir=resolve(baseDir)
 const marp=new Marp({html:true,inlineSVG:true}).use(layout,{baseDir,onDiagnostic:d=>diagnostics.push(d)})
 for(const theme of themes)marp.themeSet.add(theme)
 try {
  if(findDeckDesignBlock(source)&&getDeckDesign(source).theme.show_page_numbers)enableManagedPageNumbers(marp,source)
 } catch(error) {
  diagnostics.push({severity:'error',code:'invalid-design',message:error.message})
 }
 let {html,css}=marp.render(source)
 html=html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g,(all,start,src,end)=>{
   if(/^(?:data:|https?:|\/\/)/.test(src))return all
   try {const path=resolve(baseDir,decodeURIComponent(src.replace(/&amp;/g,'&')));return start+`data:${mime[extname(path).toLowerCase()]||'application/octet-stream'};base64,${readFileSync(path).toString('base64')}`+end}
   catch {diagnostics.push({severity:'error',code:'missing-asset',message:`Cannot read ${src}`});return all}
 })
 return {html,css,diagnostics,source,hash:createHash('sha256').update(source).digest('hex'),draft}
}
export function documentHTML({html,css},title='Marpres') {
 return `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&]/g,'')}</title><style>${css}\nhtml,body{margin:0;background:#ddd}.marpit>svg{display:block;margin:24px auto;box-shadow:0 2px 10px #0003;max-width:100%;height:auto}@media print{html,body{background:white}.marpit>svg{margin:0;box-shadow:none;max-width:none}}${stagePageCSS}</style></head><body>${html}<script>(${installStagePages.toString()})();</script></body></html>`
}
