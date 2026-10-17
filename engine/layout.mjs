import container from 'markdown-it-container'
import { normalizeContainerFences } from './source-syntax.mjs'
import marpitPlugin from '@marp-team/marpit/plugin.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { imageSize } from 'image-size'
import { readEditOptions, fontFamilyCSS } from './edit-options.mjs'
import { renderShapeSVG } from './shapes.mjs'
import { paletteVariables } from './design-system.mjs'

const names = ['panel','col','figure','box','caption','ref','top','bottom','footer','shape']
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const range = value => { const m=/^(\d+)(?:-(\d+))?$/.exec(String(value)); return m ? [+m[1],+(m[2]||m[1])] : null }
export function parseOptions(info) {
  const values={}
  for(const m of info.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g)) values[m[1]]=m[2]??m[3]??m[4]
  return values
}
function groups(tokens) {
  const out=[]
  for(let i=0;i<tokens.length;i++) {
    const start=i
    if(tokens[i].nesting===1) { let depth=1; while(depth && ++i<tokens.length) depth+=tokens[i].nesting }
    out.push(tokens.slice(start,i+1))
  }
  return out
}
const kind = group => /^container_(\w+)_open$/.exec(group[0]?.type)?.[1]
function layoutSpec(value,count,report) {
  let parts=String(value||'').trim().split(/\s+/), type=parts.shift(), rows=1,cols=count||1,colWeights,rowWeights
  if(!type || type==='single' || type==='hero') { type='cols';cols=count||1 }
  else if(type==='comparison') { type='cols';cols=count||2 }
  else if(type==='figure-text') { type='cols';cols=2 }
  else if(type==='summary') { type='cols';cols=count||3 }
  else if(type==='cols') { cols=parts.length;colWeights=parts.map(Number) }
  else if(type==='grid') {
    const m=/^(\d+)x(\d+)$/.exec(parts.shift()||'')
    if(m) { rows=+m[1];cols=+m[2] } else rows=0
    const slash=parts.indexOf('/');colWeights=(slash<0?parts:parts.slice(0,slash)).map(Number)
    rowWeights=(slash<0?[]:parts.slice(slash+1)).map(Number)
  } else rows=0
  if(!rows || !cols || rows>12 || cols>12 || [colWeights,rowWeights].some(w=>w?.some(x=>!Number.isFinite(x)||x<=0)) || (colWeights?.length && colWeights.length!==cols) || (rowWeights?.length && rowWeights.length!==rows)) {
    report('invalid-layout',`Invalid layout: ${value}`);return {type:'cols',rows:1,cols:count||1,colWeights:Array(count||1).fill(1),rowWeights:[1]}
  }
  return {type,rows,cols,colWeights:colWeights?.length?colWeights:Array(cols).fill(1),rowWeights:rowWeights?.length?rowWeights:Array(rows).fill(1)}
}

export default marpitPlugin((md, {baseDir=process.cwd(),onDiagnostic=()=>{}}={})=>{
  for(const name of names) md.use(container,name)
  for(const name of ['layout','caption_align','valign','guides','gap','appearance']) md.marpit.customDirectives.local[name]=value=>({[`v2_${name}`]:String(value)})
  // Preserve line numbers while making equal-length nested DSL fences unambiguous.
  md.core.ruler.before('block','v2_fences',state=>{
    if(state.inlineMode)return
    state.src=normalizeContainerFences(state.src,error=>onDiagnostic({severity:'error',...error}))
  })
  md.core.ruler.after('marpit_directives_apply','v2_layout',state=>{
    if(state.inlineMode)return
    let slide=0,shapeFrames=[]
    const ids=new Map()
    for(const t of state.tokens) if(/^container_.*_open$/.test(t.type)) { const id=parseOptions(t.info).id;if(id)ids.set(id,(ids.get(id)||0)+1) }
    const report=(code,message,token,severity='error')=>onDiagnostic({severity,code,message,slide,line:token?.map?.[0]!=null?token.map[0]+1:undefined})
    const raw=content=>{const t=new state.Token('html_block','',0);t.content=content;t.block=true;return t}
    const wrap=(tag,attrs,tokens)=>[raw(`<${tag}${attrs?' '+attrs:''}>`),...tokens,raw(`</${tag}>`)]
    function stageAttributes(token,type=kind([token])) {
      const value=parseOptions(token.info).stage
      const {options,errors}=readEditOptions(value==null?{}:{stage:value},type)
      for(const error of errors)report('invalid-option',error.message||String(error),token)
      return ` data-stage="${options.stage??0}"`
    }
    function metadata(token,type,extra={},inheritedStage=0) {
      const opts=parseOptions(token.info),styles=[],{options,errors}=readEditOptions(opts,type),saved={...extra,...options}
      for(const error of errors)report(type==='figure'&&opts.height!=null&&String(error.message||error).includes('height')?'figure-height':'invalid-option',error.message||String(error),token)
      if(opts.id) saved.id=opts.id
      if(saved.width)styles.push(`width:${saved.width}px`)
      if(saved.height)styles.push(`height:${saved.height}px`)
      if(saved.font)styles.push(`font-size:${saved.font}px`)
      if(saved.font_family)styles.push(`font-family:${fontFamilyCSS(saved.font_family)}`)
      if(saved.bold!=null)styles.push(`font-weight:${saved.bold?700:400}`)
      if(saved.italic!=null)styles.push(`font-style:${saved.italic?'italic':'normal'}`)
      if(saved.underline!=null||saved.strike!=null)styles.push(`text-decoration-line:${[saved.underline?'underline':'',saved.strike?'line-through':''].filter(Boolean).join(' ')||'none'}`)
      if(saved.color)styles.push(`color:${saved.color}`)
      if(saved.align)styles.push(`text-align:${saved.align}`)
      if(saved.position==='absolute')styles.push('position:absolute;left:0;top:0')
      styles.push(`z-index:${100+(saved.layer??(saved.position==='absolute'&&type!=='figure'?1:0))}`)
      styles.push(`transform:translate(${saved.dx||0}px,${saved.dy||0}px)${type==='shape'?` rotate(${saved.rotate||0}deg)`:''}`)
      let attrs=''
      if(opts.id && ids.get(opts.id)===1)attrs=` data-edit-id="${esc(opts.id)}" data-edit-kind="${type}" data-edit-options="${esc(JSON.stringify(saved))}" data-source-line="${token.map?.[0]+1}"`
      else if(opts.id) report('duplicate-id',`ID '${opts.id}' occurs more than once; use a unique ID for editing.`,token)
      const editable=!!attrs
      attrs+=` data-stage="${Math.max(saved.stage??0,inheritedStage)}"${saved.position?` data-position="${saved.position}"`:""}`
      return {opts,saved,styles,attrs,editable}
    }
    function renderGroups(input,inheritedStage=0) {
      return groups(input).flatMap(group=>{
        const type=kind(group),token=group[0]
        const childStage=type?Math.max(inheritedStage,readEditOptions(parseOptions(token.info),type).options.stage??0):inheritedStage
        if(type==='figure') {
          const images=group.flatMap(t=>t.children||[]).filter(t=>t.type==='image')
          const otherContent=group.slice(1,-1).some(t=>!['paragraph_open','paragraph_close','inline'].includes(t.type)||(t.type==='inline'&&t.children?.some(c=>!['image','softbreak'].includes(c.type)&&!(c.type==='text'&&!c.content.trim()))))
          if(images.length!==1||otherContent) {report('figure-content','A figure block must contain exactly one Markdown image.',token);return renderGroups(group.slice(1,-1),childStage)}
          const img=images[0],src=img.attrGet('src'),opt=parseOptions(token.info)
          let size,crop=opt.crop?opt.crop.split(',').map(Number):[0,0,100,100]
          if(crop.length!==4||crop.some(n=>!Number.isFinite(n))||crop[0]<0||crop[1]<0||crop[2]<=0||crop[3]<=0||crop[0]+crop[2]>100||crop[1]+crop[3]>100) {report('invalid-crop','Crop must be left,top,width,height percentages within the source image.',token);crop=[0,0,100,100]}
          try {size=imageSize(readFileSync(resolve(baseDir,decodeURIComponent(src))))} catch {report('image-dimensions',`Cannot read dimensions for '${src}'. Use a local image in figure blocks.`,token);size={width:1,height:1}}
          const ratio=size.width*crop[2]/(size.height*crop[3]),meta=metadata(token,'figure',{crop},inheritedStage)
          meta.styles.push(`--crop-ratio:${ratio}`)
          const [l,t,w,h]=crop
          const frame=raw(`<div class="figure-frame${meta.editable?' editable-object':''}"${meta.attrs} style="${esc(meta.styles.join(';'))}"><img src="${esc(src)}" alt="${esc(img.content)}" draggable="false" style="width:${10000/w}%;height:${10000/h}%;left:${-100*l/w}%;top:${-100*t/h}%"></div>`)
          if(meta.saved.position==='absolute'){shapeFrames.push(frame);return []}
          return wrap('div','class="figure-slot"',[frame])
        }
        if(type==='shape') {
          if(group.slice(1,-1).length)report('shape-content','A shape block must have an empty body.',token)
          const shapeName=parseOptions(token.info).shape
          const meta=metadata(token,type,{shape:'rect',width:240,height:['line','arrow','double-arrow'].includes(shapeName)?32:120,rotate:0,stroke:'#7a005f',stroke_width:3,fill:'none'},inheritedStage),shape=meta.saved.shape
          const width=meta.saved.width||240,height=meta.saved.height||(['line','arrow','double-arrow'].includes(shape)?32:120),stroke=meta.saved.stroke||'#7a005f',strokeWidth=meta.saved.stroke_width??3,fill=meta.saved.fill||'none'
          if(!meta.saved.width)meta.styles.push(`width:${width}px`)
          if(!meta.saved.height)meta.styles.push(`height:${height}px`)
          const drawing=renderShapeSVG(shape,{width,height,stroke,stroke_width:strokeWidth,fill})
          shapeFrames.push(raw(`<div class="shape-frame${meta.editable?' editable-object':''}"${meta.attrs} style="${esc(meta.styles.join(';'))}">${drawing}</div>`))
          return []
        }
        if(['box','caption','ref'].includes(type)) {
          const meta=metadata(token,type),align=meta.opts.align||/\b(left|center|right)\b/.exec(token.info)?.[1]
          if(!meta.saved.align&&['left','center','right'].includes(align))meta.styles.push(`text-align:${align}`)
          return wrap('div',`class="layout-${type}${meta.editable?' editable-object':''}"${meta.attrs} style="${esc(meta.styles.join(';'))}"`,renderGroups(group.slice(1,-1),childStage))
        }
        if(type) return wrap('div',`class="layout-${type}"${stageAttributes(token,type)}`,renderGroups(group.slice(1,-1),childStage))
        if(token.type==='paragraph_open') {
          const inline=group.find(t=>t.type==='inline')
          if(inline?.children?.some(t=>t.type==='image')&&inline.children.every(t=>t.type==='image'||t.type==='softbreak'||(t.type==='text'&&!t.content.trim())))token.attrJoin('class','image-line')
        }
        return group
      })
    }
    const result=[]
    for(let i=0;i<state.tokens.length;i++) {
      const opening=state.tokens[i]
      if(opening.type!=='marpit_slide_open') {result.push(opening);continue}
      slide++;shapeFrames=[];const inner=[];while(++i<state.tokens.length&&state.tokens[i].type!=='marpit_slide_close')inner.push(state.tokens[i])
      const closing=state.tokens[i],blocks=groups(inner),head=[],before=[],panels=[],after=[],footer=[]
      let seenPanel=false,headingTaken=false
      for(const block of blocks) {
        const type=kind(block)
        if(block[0].type==='heading_open'&&((block[0].tag==='h1'&&!headingTaken)||(block[0].tag==='h2'&&head.length&&!before.length&&!seenPanel))) {head.push(...block);headingTaken=true}
        else if(type==='panel'||type==='col'){panels.push(block);seenPanel=true}
        else if(type==='footer')footer.push(...block)
        else (seenPanel?after:before).push(...block)
      }
      const directives=opening.meta?.marpitDirectives||{},spec=layoutSpec(directives.v2_layout,panels.length,report)
      const nextSlide=state.tokens.slice(i+1).find(t=>t.type==='marpit_slide_open')
      opening.attrSet('data-source-slide',String(slide))
      opening.attrSet('data-source-end-line',String(nextSlide?.map?.[0]!=null?nextSlide.map[0]+1:state.src.split('\n').length+(state.src.endsWith('\n')?0:1)))
      const stages=new Set([0])
      for(const token of inner)if(/^container_.*_open$/.test(token.type)) {
        const value=parseOptions(token.info).stage
        if(value!=null) {
          const {options}=readEditOptions({stage:value},kind([token]))
          if(options.stage!=null)stages.add(options.stage)
        }
      }
      opening.attrSet('data-stages',[...stages].sort((a,b)=>a-b).join(','))
      opening.attrSet('data-layout',spec.type)
      const appearance=directives.v2_appearance||'inherit'
      if(!['inherit','light','dark'].includes(appearance))report('invalid-appearance',`Invalid appearance: ${appearance}. Choose light, dark, or inherit.`,opening)
      opening.attrSet('data-appearance',['light','dark'].includes(appearance)?appearance:'inherit')
      if(['light','dark'].includes(appearance))opening.attrSet('style',`${opening.attrGet('style')||''};${paletteVariables(appearance)}`)
      if(['left','center','right'].includes(directives.v2_caption_align))opening.attrSet('style',`${opening.attrGet('style')||''};--caption-align:${directives.v2_caption_align}`)
      if(directives.v2_guides)opening.attrSet('data-guides',directives.v2_guides)
      const placements=[],occupied=new Set()
      const cells=([r,re,c,ce])=>{const out=[];for(let y=r;y<=re;y++)for(let x=c;x<=ce;x++)out.push(`${y},${x}`);return out}
      panels.forEach((block,n)=>{
        const opt=parseOptions(block[0].info),legacy=/(?:^|\s)(\d+(?:-\d+)?)\s*,\s*(\d+(?:-\d+)?)(?:\s|$)/.exec(block[0].info)
        if(opt.row||opt.col||legacy) {
          const row=range(opt.row||legacy?.[1]||'1'),col=range(opt.col||legacy?.[2]||'1')
          const p=row&&col?[...row,...col]:null
          if(!p||p[0]<1||p[2]<1||p[1]<p[0]||p[3]<p[2]||p[1]>spec.rows||p[3]>spec.cols||cells(p).some(c=>occupied.has(c)))report('panel-placement','Panel placement is invalid, overlaps another panel, or exceeds the declared grid.',block[0])
          else {placements[n]=p;cells(p).forEach(c=>occupied.add(c))}
        }
      })
      panels.forEach((block,n)=>{
        if(placements[n])return
        for(let r=1;r<=spec.rows;r++)for(let c=1;c<=spec.cols;c++)if(!occupied.has(`${r},${c}`)){placements[n]=[r,r,c,c];occupied.add(`${r},${c}`);return}
        report('panel-capacity','There are more panels than cells in this layout.',block[0]);placements[n]=[1,1,1,1]
      })
      const gridTokens=[]
      panels.forEach((block,n)=>{
        const opts=parseOptions(block[0].info),[r,re,c,ce]=placements[n],body=[],cap=[],ref=[]
        for(const child of groups(block.slice(1,-1))) (kind(child)==='caption'?cap:kind(child)==='ref'?ref:body).push(...child)
        const align=['left','center','right'].includes(opts.align)?opts.align:'center'
        const v={top:'flex-start',start:'flex-start',center:'center',bottom:'flex-end',end:'flex-end',stretch:'flex-start'}[opts.valign||directives.v2_valign]||'flex-start'
        const attributes=`class="panel"${stageAttributes(block[0],kind(block))}${['top','center','bottom'].includes(opts.pack)?` data-pack="${opts.pack}"`:""} data-panel-id="${esc(opts.id||`slide-${slide}-panel-${n+1}`)}" data-panel-index="${n+1}" style="grid-row:${r} / ${re+1};grid-column:${c} / ${ce+1};--panel-align:${{left:'flex-start',center:'center',right:'flex-end'}[align]};--panel-valign:${v}"`
        const panelStage=readEditOptions(opts,kind(block)).options.stage??0
        gridTokens.push(...wrap('div',attributes,[...wrap('div','class="panel-body"',renderGroups(body,panelStage)),...wrap('div','class="panel-caption"',renderGroups(cap,panelStage)),...wrap('div','class="panel-ref"',renderGroups(ref,panelStage))]))
      })
      const gridStyle=`grid-template-columns:${spec.colWeights.map(w=>`minmax(0,${w}fr)`).join(' ')};${spec.rows>1?`grid-template-rows:${spec.rowWeights.map(w=>`minmax(0,${w}fr)`).join(' ')};`:''}${/^\d+(\.\d+)?$/.test(directives.v2_gap||'')?`--panel-gap:${directives.v2_gap}px;`:''}`
      const grid=panels.length?wrap('div',`class="panel-grid ${spec.rows===1?'comparison-grid':'tile-grid'}" style="${gridStyle}"`,gridTokens):[]
      const bodyTokens=[...renderGroups(before),...grid,...renderGroups(after)]
      result.push(opening,...wrap('header','class="deck-heading"',head),...wrap('main','class="deck-content"',bodyTokens),...wrap('footer','class="deck-footer"',renderGroups(footer)),...shapeFrames,closing)
    }
    state.tokens=result
  })
})
