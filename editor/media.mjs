import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { imageSize } from 'image-size'
import { SourceError, insertAuthoredBlock } from './source-store.mjs'

export { exportDeckPDF } from '../scripts/export.mjs'

const maxImageBytes=10*1024*1024
const extensions={png:'png',jpg:'jpg',jpeg:'jpg',svg:'svg',gif:'gif',webp:'webp'}

function decodeImage(name,data) {
  if(typeof name!=='string'||!name.trim())throw new SourceError('Choose an image file.')
  const extension=extensions[extname(name).slice(1).toLowerCase()]
  if(!extension)throw new SourceError('Choose a PNG, JPEG, SVG, GIF or WebP image.')
  if(typeof data!=='string'||!data.length||data.length>Math.ceil(maxImageBytes/3)*4)throw new SourceError('Image data is required and must be at most 10 MB.')
  if(data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw new SourceError('Image data must be base64 without a data URL.')
  const bytes=Buffer.from(data,'base64')
  if(bytes.length>maxImageBytes||bytes.toString('base64')!==data)throw new SourceError('Image data is invalid or exceeds 10 MB.')
  let dimensions
  try { dimensions=imageSize(bytes) } catch { throw new SourceError('The file is not a readable image.') }
  if(!extensions[dimensions.type]||extensions[dimensions.type]!==extension)throw new SourceError('The image contents do not match the file extension.')
  if(!Number.isFinite(dimensions.width)||!Number.isFinite(dimensions.height)||dimensions.width<=0||dimensions.height<=0)throw new SourceError('The image must have positive dimensions.')
  return {bytes,extension,width:dimensions.width,height:dimensions.height}
}

export async function importImage(store,{hash,slide,name,data,panel}) {
  const image=decodeImage(name,data)
  return store.mutate(hash,async source=>{
    const id=`image-${randomUUID()}`
    const round=value=>Number(value.toFixed(4))
    const width=round(Math.min(500,400*image.width/image.height))
    const height=width*image.height/image.width
    const dx=round((1280-width)/2),dy=round((720-height)/2)
    const digest=createHash('sha256').update(image.bytes).digest('hex')
    const asset=`figures/imported/${digest}.${image.extension}`
    const alt=basename(name).replace(/[\r\n\u0000-\u001f]/g,' ').replace(/[\\[\]]/g,'\\$&')
    const position=panel==null?` position=absolute dx=${dx} dy=${dy} width=${width}`:''
    const block=`::: figure id=${id}${position}\n![${alt}](${asset})\n:::\n`
    // Validate the requested slide and panel before creating asset directories or files.
    const changed=insertAuthoredBlock(source,slide,block,{panel})
    await store.guarded(hash)
    const file=join(dirname(store.file),asset)
    await mkdir(dirname(file),{recursive:true})
    try { await writeFile(file,image.bytes,{flag:'wx'}) }
    catch(error) {
      if(error.code!=='EEXIST')throw error
      if(!(await readFile(file)).equals(image.bytes))throw new SourceError('An imported asset was modified. Restore it before importing this image again.','CONFLICT',409)
    }
    // Assets stay immutable and survive Markdown undo, so redo can reuse them.
    return {source:changed,id}
  })
}
