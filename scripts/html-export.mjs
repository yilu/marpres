import {createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname,basename,resolve,relative,sep} from 'node:path'
import {renderFile,documentHTML} from './render.mjs'

// Assets retain the original bytes; hashes allow decks in one directory to share them.
export async function exportHTML(file,{output,embedImages=false,linkImages=false}={}) {
 if(embedImages&&linkImages)throw new Error('embedImages and linkImages cannot be used together')
 output=resolve(output)
 const assets=new Map(),extensions={'image/svg+xml':'svg','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'}
 const resolveAsset=embedImages?undefined:linkImages?(_bytes,_type,path)=>relative(dirname(output),path).split(sep).map(encodeURIComponent).join('/'):(bytes,type)=>{
  const name=createHash('sha256').update(type).update(bytes).digest('hex')+'.'+(extensions[type]||'bin')
  assets.set(name,bytes)
  return 'assets/'+name
 }
 const deck=await renderFile(file,{resolveAsset})
 if(deck.diagnostics.some(d=>d.severity==='error'))return {deck,output}
 await mkdir(dirname(output),{recursive:true})
 if(assets.size) {
  await mkdir(resolve(dirname(output),'assets'),{recursive:true})
  await Promise.all([...assets].map(([name,bytes])=>writeFile(resolve(dirname(output),'assets',name),bytes)))
 }
 await writeFile(output,documentHTML(deck,basename(file,'.md')))
 return {deck,output}
}
