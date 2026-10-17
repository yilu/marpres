import { findDeckDesignBlock } from './design-block.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, stat, unlink } from 'node:fs/promises'
import { resolve, dirname, basename, join } from 'node:path'
import MarkdownIt from 'markdown-it'
import { normalizeEditPatch } from '../engine/edit-options.mjs'
import { sourceSeparatorLines } from '../engine/source-syntax.mjs'

const kinds = new Set(['figure', 'box', 'caption', 'ref', 'shape'])
const textKinds = new Set(['box', 'caption', 'ref'])
const blockNames = new Set(['panel','col','figure','box','caption','ref','top','bottom','footer','shape'])
const blockParser = new MarkdownIt({ html: true })

export class SourceError extends Error {
  constructor(message, code = 'INVALID', status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const hashSource = source => createHash('sha256').update(source).digest('hex')

function optionsIn(line) {
  const options = []
  const pattern = /(?:^|\s)([A-Za-z][\w-]*)([ \t]*=[ \t]*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s]+))/g
  for (const match of line.matchAll(pattern)) {
    const leading = /^\s/.test(match[0]) ? 1 : 0
    const quote = match[3] !== undefined ? '"' : match[4] !== undefined ? "'" : ''
    options.push({ key: match[1], prefix: match[1] + match[2], value: match[3] ?? match[4] ?? match[5], start: match.index + leading, end: match.index + match[0].length, quote })
  }
  return options
}

// Map only authored containers; literal code/HTML and YAML cannot expose targets.
export function mapSource(source) {
  const lines = source.split('\n')
  const parseSource = source.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/, value => value.replace(/[^\r\n]/g, ' '))
  const masked = parseSource.split('\n')
  const tokens = blockParser.parse(parseSource, {})
  const {separators,errors,headings,containerDepths}=sourceSeparatorLines(source)
  if(errors.length)throw new SourceError(errors[0].message)
  for (const token of tokens) {
    if (!['fence', 'code_block', 'html_block'].includes(token.type) || !token.map) continue
    for (let index=token.map[0];index<token.map[1];index++) masked[index]=masked[index].replace(/[^\r]/g,' ')
  }
  const stack=[],blocks=[],boundaries=[],ids=new Set()
  for(let line=0;line<masked.length;line++) {
    const value=masked[line]
    const open=/^\s*:{3,}\s*([A-Za-z][\w-]*)(?:\s|$)/.exec(value)
    if(open&&blockNames.has(open[1])) {
      if(stack.length)stack.at(-1).children=true
      const options=optionsIn(lines[line]),idOptions=options.filter(o=>o.key==='id')
      if(idOptions.length>1)throw new SourceError(`Duplicate id options on line ${line+1}.`)
      const id=idOptions[0]?.value
      if(id&&ids.has(id))throw new SourceError(`Duplicate editable id "${id}". IDs must be unique across the deck.`)
      if(id)ids.add(id)
      const depth=containerDepths.get(line)??null
      const block={id,kind:open[1],line,options,children:false,slide:boundaries.length+1,depth}
      stack.push(block);blocks.push(block)
    } else if(/^\s*:{3,}\s*$/.test(value)&&stack.length) {
      stack.pop().endLine=line+1
    } else if(separators.has(line)&&!stack.length)boundaries.push(line)
  }
  if(stack.length)throw new SourceError(`Unclosed layout block on line ${stack[0].line+1}.`)
  const slides=[...boundaries,lines.length].map((endLine,index)=>{const startLine=index?boundaries[index-1]+1:0;const heading=headings.find(h=>h.line>=startLine&&h.line<endLine);return {slide:index+1,startLine,endLine,title:heading?.title||'Untitled slide',heading}})
  const objects=blocks.filter(b=>b.id&&kinds.has(b.kind)).map(b=>({...b,content:lines.slice(b.line+1,b.endLine-1).join('\n').replace(/\r/g,'').replace(/\n+$/,''),contentEditable:textKinds.has(b.kind)&&!b.children}))
  return {objects,slides,blocks}
}
export function scanEditable(source) { return mapSource(source).objects }

export function validatePatch(patch,kind) {
  try { return normalizeEditPatch(patch,kind) }
  catch(error) { throw new SourceError(error.message) }
}

export function patchSource(source, id, patch) {
  const object = scanEditable(source).find(item => item.id === id)
  if (!object) throw new SourceError(`Editable object "${id}" not found.`, 'NOT_FOUND', 404)
  const valid = validatePatch(patch,object.kind)
  if (Object.hasOwn(valid, 'crop') && object.kind !== 'figure') throw new SourceError('Crop is only supported for figures.')
  if (object.kind === 'figure' && valid.height !== undefined && valid.height !== null) throw new SourceError('Figure height is derived from the visible crop aspect ratio. Resize using width.')
  const lines = source.split('\n')
  let line = lines[object.line]
  const replacements = []
  const append = []
  for (const [key, value] of Object.entries(valid)) {
    const matches = object.options.filter(option => option.key === key)
    if (matches.length > 1) throw new SourceError(`Duplicate ${key} options on "${id}".`)
    const match = matches[0]
    const formatted = Array.isArray(value) ? value.join(',') : String(value)
    const quote=match?.quote || (/\s/.test(formatted)?'"':'')
    if (match) {
      const start = value === null && match.start > 0 && /[ \t]/.test(line[match.start - 1]) ? match.start - 1 : match.start
      replacements.push({ start, end: match.end, text: value === null ? '' : `${match.prefix}${quote}${formatted}${quote}` })
    } else if (value !== null) append.push(`${key}=${quote}${formatted}${quote}`)
  }
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) line = line.slice(0, replacement.start) + replacement.text + line.slice(replacement.end)
  if (append.length) line = line.replace(/([ \t]*\r?)$/, ` ${append.join(' ')}$1`)
  lines[object.line] = line
  return lines.join('\n')
}

export function replaceContent(source,id,content) {
  if(typeof content!=='string'||content.length>16000)throw new SourceError('Text content must be a string of at most 16000 characters.')
  const object=scanEditable(source).find(o=>o.id===id)
  if(!object||!object.contentEditable)throw new SourceError('Only a leaf text block can be edited. Nested objects must remain separate.')
  // Structural fences/separators outside literal blocks must not escape the target.
  const masked=content.replace(/\r\n/g,'\n').split('\n')
  const tokens=blockParser.parse(content,{})
  for(const t of tokens)if(['fence','code_block','html_block'].includes(t.type)&&t.map)for(let i=t.map[0];i<t.map[1];i++)masked[i]=''
  if(masked.some(line=>/^\s*(?::{3,}(?:\s|$|[A-Za-z])|---\s*$)/.test(line))||tokens.some(t=>t.type==='hr'&&t.level===0))throw new SourceError('Text cannot contain layout fences or slide separators outside code blocks.')
  const lines=source.split('\n'),eol=source.includes('\r\n')?'\r\n':'\n'
  const body=content.replace(/\r\n/g,'\n').replace(/\n+$/,'').replace(/\n/g,eol)+eol+eol
  const before=lines.slice(0,object.line+1).join('\n')+'\n'
  const after=lines.slice(object.endLine-1).join('\n')
  const changed=before+body+after
  const updated=scanEditable(changed).find(o=>o.id===id)
  if(!updated?.contentEditable)throw new SourceError('This text would change the surrounding block structure.')
  return changed
}

export function insertShape(source,slide,shape,{id=`shape-${randomUUID().slice(0,8)}`,panel}={}) {
  if(panel!=null)throw new SourceError('Shapes can only be inserted freely on the slide.')
  if(!Number.isInteger(slide)||slide<1)throw new SourceError('Choose a valid slide.')
  validatePatch({shape},'shape')
  const map=mapSource(source),target=map.slides[slide-1]
  if(!target)throw new SourceError('Slide does not exist.')
  if(!/^[A-Za-z][\w-]*$/.test(id)||map.blocks.some(b=>b.id===id))throw new SourceError('Shape ID must be unique.')
  const eol=source.includes('\r\n')?'\r\n':'\n',lines=source.split('\n')
  const position=target.endLine<lines.length?lines.slice(0,target.endLine).join('\n').length+1:source.length
  const prefix=source.slice(0,position),suffix=source.slice(position)
  const block=`::: shape id=${id} shape=${shape} dx=480 dy=280 width=240 height=${['line','arrow','double-arrow'].includes(shape)?32:120} rotate=0 stroke=#7a005f stroke_width=3 fill=none${eol}:::${eol}`
  return {source:prefix+(prefix.endsWith(eol+eol)?'':prefix.endsWith(eol)?eol:eol+eol)+block+eol+suffix,id}
}

export function insertText(source,slide,content='New text',{id=`text-${randomUUID().slice(0,8)}`,panel}={}) {
  if(typeof content!=='string')throw new SourceError('Text content must be a string.')
  // Validate content with the same leaf-block rules used by the text editor.
  const checked=replaceContent(`::: box id=check\nOld\n:::\n`,'check',content)
  const safeContent=scanEditable(checked)[0].content
  const map=mapSource(source),target=map.slides[slide-1]
  if(!Number.isInteger(slide)||!target)throw new SourceError('Slide does not exist.')
  if(!/^[A-Za-z][\w-]*$/.test(id)||map.blocks.some(b=>b.id===id))throw new SourceError('Text ID must be unique.')
  const position=panel==null?' position=absolute dx=480 dy=280 width=360':''
  const block=`::: box id=${id}${position}\n${safeContent}\n\n:::\n`
  return {source:insertAuthoredBlock(source,slide,block,{panel}),id}
}
export function deleteObject(source,id) {
  const object=scanEditable(source).find(o=>o.id===id)
  if(!object||!(object.kind==='shape'||object.kind==='figure'||object.contentEditable))throw new SourceError('Only shapes, figures and leaf text objects can be deleted here.')
  const lines=source.split('\n');lines.splice(object.line,object.endLine-object.line)
  return lines.join('\n')
}
export function deleteShape(source,id) {
  if(scanEditable(source).find(o=>o.id===id)?.kind!=='shape')throw new SourceError('Only shape objects can be deleted here.')
  return deleteObject(source,id)
}

export function insertAuthoredBlock(source,slide,block,{panel}={}) {
  const mapping=mapSource(source),target=mapping.slides[slide-1]
  if(!Number.isInteger(slide)||!target)throw new SourceError('Slide does not exist.')
  let endLine=target.endLine
  if(panel!=null) {
    if(!Number.isInteger(panel)||panel<1)throw new SourceError('Choose a valid panel number.')
    const panels=mapping.blocks.filter(item=>item.slide===slide&&item.depth===0&&(item.kind==='panel'||item.kind==='col'))
    const selected=panels[panel-1]
    if(!selected)throw new SourceError('Panel does not exist on this slide.')
    endLine=selected.endLine-1
  }
  const lines=source.split('\n'),eol=source.includes('\r\n')?'\r\n':'\n'
  const position=endLine<lines.length?lines.slice(0,endLine).join('\n').length+1:source.length
  const prefix=source.slice(0,position),suffix=source.slice(position)
  return prefix+(prefix.endsWith(eol+eol)?'':prefix.endsWith(eol)?eol:eol+eol)+block.replace(/\r?\n/g,eol).replace(/(?:\r?\n)+$/,'')+eol+eol+suffix
}

export function patchBatch(source,edits) {
  if(!Array.isArray(edits)||edits.length<1||edits.length>100)throw new SourceError('Select between 1 and 100 objects.')
  const ids=new Set()
  for(const edit of edits) {
    if(!edit||typeof edit.id!=='string')throw new SourceError('Every edit needs an object ID.')
    if(ids.has(edit.id))throw new SourceError('Duplicate object in batch edit.')
    ids.add(edit.id)
    source=patchSource(source,edit.id,edit.patch)
  }
  return source
}

function deckPrefix(source) {
  let prefix=source.match(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]||''
  const design=/^\s*<!-- marp-v2-design:begin -->[\s\S]*?<!-- marp-v2-design:end -->(?:\r?\n)?/.exec(source.slice(prefix.length))
  if(design)prefix+=design[0]
  return prefix
}

export function changeSlide(source,action,slide,{title}={}) {
  const originalSource=source
  let sharedDesign=''
  if(action!=='rename') {
    const design=findDeckDesignBlock(source)
    if(design) {
      sharedDesign=source.slice(design.start,design.end)
      source=source.slice(0,design.start)+source.slice(design.end)
    }
  }
  const mapping=mapSource(source),index=slide-1,info=mapping.slides[index]
  if(!Number.isInteger(slide)||!info)throw new SourceError('Slide does not exist.')
  const eol=source.includes('\r\n')?'\r\n':'\n'
  if(title!==undefined&&(typeof title!=='string'||title.length>300||/[\r\n]/.test(title)))throw new SourceError('Use a single-line slide title of at most 300 characters.')
  if(action==='rename') {
    const lines=source.split('\n'),offsets=[0]
    for(const line of lines)offsets.push(offsets.at(-1)+line.length+1)
    const heading='# '+(title||'Untitled slide')
    if(info.heading) {
      const start=offsets[info.heading.line],end=Math.min(source.length,offsets[info.heading.endLine])
      return {source:source.slice(0,start)+heading+(source.slice(start,end).endsWith('\n')?eol:'')+source.slice(end),selectedSlide:slide}
    }
    const position=index===0?deckPrefix(source).length:offsets[info.startLine]
    const before=source.slice(0,position),after=source.slice(position)
    return {source:before+(before&&!before.endsWith('\n')?eol:'')+heading+eol+eol+after,selectedSlide:slide}
  }
  const prefix=deckPrefix(source)
  const lines=source.split('\n'),offsets=[0];for(let n=0;n<lines.length;n++)offsets.push(offsets.at(-1)+lines[n].length+1)
  const parts=mapping.slides.map((s,i)=>source.slice(i===0?prefix.length:offsets[s.startLine],Math.min(source.length,offsets[s.endLine])))
  let selectedSlide=slide
  if(action==='add') {parts.splice(index+1,0,eol+'# '+(title||'New slide')+eol+eol);selectedSlide=slide+1}
  else if(action==='duplicate') {
    const chunk=parts[index],chunkLines=chunk.split('\n'),blocks=mapSource(chunk).blocks
    for(const b of blocks)if(b.id) {
      const opt=b.options.find(o=>o.key==='id'),value=b.id+'-'+randomUUID().slice(0,6),q=opt.quote||(/\s/.test(value)?'"':'')
      chunkLines[b.line]=chunkLines[b.line].slice(0,opt.start)+opt.prefix+q+value+q+chunkLines[b.line].slice(opt.end)
    }
    parts.splice(index+1,0,chunkLines.join('\n'));selectedSlide=slide+1
  } else if(action==='delete') {
    if(parts.length===1)throw new SourceError('The last slide cannot be deleted.')
    parts.splice(index,1);selectedSlide=Math.min(slide,parts.length)
  } else if(action==='move-up'||action==='move-down') {
    const next=index+(action==='move-up'?-1:1)
    if(next<0||next>=parts.length)return {source:originalSource,selectedSlide:slide}
    ;[parts[index],parts[next]]=[parts[next],parts[index]];selectedSlide=next+1
  } else throw new SourceError('Unsupported slide action.')
  const globals=prefix+(prefix&&!prefix.endsWith('\n')&&sharedDesign?eol:'')+sharedDesign+(sharedDesign&&!sharedDesign.endsWith('\n')?eol:'')
  const combined=globals+parts.map((part,i)=>i===parts.length-1?part:part+(part.endsWith(eol+eol)?'':part.endsWith(eol)?eol:eol+eol)+'---'+eol).join('')
  return {source:combined,selectedSlide}
}

export class SourceStore {
  constructor(file) {
    this.file = resolve(file)
    this.undoStack = []
    this.redoStack = []
    this.currentHash = null
    this.queue = Promise.resolve()
  }

  serialize(operation) {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  async snapshot() {
    const source = await readFile(this.file, 'utf8')
    const hash = hashSource(source)
    if (this.currentHash === null) this.currentHash = hash
    const inSync = this.currentHash === hash
    return { source, hash, history: { canUndo: inSync && this.undoStack.length > 0, canRedo: inSync && this.redoStack.length > 0 } }
  }

  read() { return this.serialize(() => this.snapshot()) }

  conflict() { return new SourceError('The source file changed. Reload the deck before editing; your pending edit was not saved.', 'CONFLICT', 409) }

  async guarded(hash) {
    const snapshot = await this.snapshot()
    if (!hash || snapshot.hash !== hash) throw this.conflict()
    return snapshot
  }

  async replace(source, expectedHash) {
    const mode = (await stat(this.file)).mode
    const temp = join(dirname(this.file), `.${basename(this.file)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temp, source, { mode, flag: 'wx' })
      // Recheck after preparing the replacement, immediately before the rename.
      if (hashSource(await readFile(this.file, 'utf8')) !== expectedHash) throw this.conflict()
      await rename(temp, this.file)
    } finally {
      await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    this.currentHash = hashSource(source)
  }

  mutate(hash, transform) {
    return this.serialize(async () => {
      const before=await this.guarded(hash)
      const result=await transform(before.source)
      const source=typeof result==='string'?result:result.source
      if(source===before.source)return {...before,...(typeof result==='object'&&result.selectedSlide?{selectedSlide:result.selectedSlide}:{})}
      const externalChange=this.currentHash!==before.hash
      await this.replace(source,before.hash)
      if(externalChange)this.undoStack=[]
      this.undoStack.push({before:before.source,after:source,beforeHash:before.hash,afterHash:this.currentHash})
      this.redoStack=[]
      return {...await this.snapshot(),...(typeof result==='object'?{selectedId:result.id,selectedSlide:result.selectedSlide}: {})}
    })
  }
  edit({hash,id,patch}) { return this.mutate(hash,source=>patchSource(source,id,patch)) }
  batch({hash,edits}) { return this.mutate(hash,source=>patchBatch(source,edits)) }
  slide({hash,action,slide,title}) { return this.mutate(hash,source=>changeSlide(source,action,slide,{title})) }
  content({hash,id,content}) { return this.mutate(hash,source=>replaceContent(source,id,content)) }
  insert({hash,slide,shape,kind,content,panel}) {
    if(kind&&kind!=='box'&&kind!=='shape')return Promise.reject(new SourceError('Unsupported inserted object kind.'))
    return this.mutate(hash,source=>kind==='box'?insertText(source,slide,content??'New text',{panel}):insertShape(source,slide,shape,{panel}))
  }
  delete({hash,id}) { return this.mutate(hash,source=>deleteObject(source,id)) }

  undo({ hash }) { return this.restore('undo', hash) }
  redo({ hash }) { return this.restore('redo', hash) }

  restore(direction, hash) {
    return this.serialize(async () => {
      const current = await this.guarded(hash)
      if (this.currentHash !== current.hash) throw this.conflict()
      const stack = direction === 'undo' ? this.undoStack : this.redoStack
      const nextStack = direction === 'undo' ? this.redoStack : this.undoStack
      const entry = stack.at(-1)
      if (!entry) throw new SourceError(`Nothing to ${direction}.`)
      const expected = direction === 'undo' ? entry.afterHash : entry.beforeHash
      if (current.hash !== expected) throw this.conflict()
      await this.replace(direction === 'undo' ? entry.before : entry.after, current.hash)
      stack.pop()
      nextStack.push(entry)
      return this.snapshot()
    })
  }
}
