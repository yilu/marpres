import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'
export const blockNames=['panel','col','figure','box','caption','ref','top','bottom','footer','shape']
const literalParser=new MarkdownIt({html:true})
const layoutParser=new MarkdownIt({html:true})
for(const name of blockNames)layoutParser.use(container,name)
export function maskFrontMatter(source) {
 return source.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/,value=>value.replace(/[^\r\n]/g,' '))
}
export function literalLines(source) {
 const ignored=new Set()
 for(const token of literalParser.parse(source,{}))if(['fence','code_block','html_block'].includes(token.type)&&token.map)for(let n=token.map[0];n<token.map[1];n++)ignored.add(n)
 return ignored
}
export function normalizeContainerFences(source,onError=()=>{}) {
 const ignored=literalLines(source),stack=[],lines=source.split('\n')
 lines.forEach((line,n)=>{
  if(ignored.has(n))return
  const open=/^(\s*)(:{3,})\s*([A-Za-z][\w-]*)(\s.*)?$/.exec(line)
  if(open&&blockNames.includes(open[3])) {
   const length=64-stack.length
   if(length<3){onError({code:'container-depth',message:'Layout containers are nested too deeply.',line:n+1});return}
   stack.push(length);lines[n]=open[1]+':'.repeat(length)+' '+open[3]+(open[4]||'')
  } else if(/^\s*:{3,}\s*$/.test(line)&&stack.length)lines[n]=':'.repeat(stack.pop())
  else if(/^---\s*$/.test(line)&&stack.length){onError({code:'unclosed-block',message:'Close all layout blocks before a slide separator.',line:n+1});stack.length=0}
 })
 if(stack.length)onError({code:'unclosed-block',message:'A layout block is missing its closing fence.'})
 return lines.join('\n')
}
export function sourceSeparatorLines(source) {
 const errors=[]
 const normalized=normalizeContainerFences(maskFrontMatter(source),e=>errors.push(e))
 const tokens=layoutParser.parse(normalized,{})
 const separators=new Set(tokens.filter(t=>t.type==='hr'&&t.level===0).map(t=>t.map[0]))
 const headings=tokens.flatMap((t,i)=>t.type==='heading_open'&&t.tag==='h1'&&t.level===0?[{line:t.map[0],endLine:t.map[1],title:tokens[i+1]?.content||''}]:[])
 // Container-aware levels stop lazy list/quote continuations at DSL closing fences.
 const containerDepths=new Map(tokens.filter(t=>/^container_\w+_open$/.test(t.type)&&t.map).map(t=>[t.map[0],t.level]))
 return {separators,errors,headings,containerDepths}
}
