// This self-contained function is embedded in exported HTML and runs in Chrome.
// The editor consumes the same data-stage attributes without expanding slides.
export function installStagePages() {
  const roots=[...document.querySelectorAll('.marpit > svg[data-marpit-svg]')]
  const pages=[]
  function copyPage(root,suffix) {
    const clone=root.cloneNode(true),ids=new Map()
    for(const node of clone.querySelectorAll('[id]')) {
      const original=node.id
      let replacement=`${original}-${suffix}`
      while(document.getElementById(replacement)||[...ids.values()].includes(replacement))replacement+='-copy'
      ids.set(original,replacement)
      node.id=replacement
    }
    const rewriteURLs=value=>value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,(all,quote,id)=>ids.has(id)?`url(${quote}#${ids.get(id)}${quote})`:all)
    for(const node of clone.querySelectorAll('*')) {
      for(const attr of [...node.attributes]) {
        if(attr.name==='id')continue
        let value=rewriteURLs(attr.value)
        if(['href','xlink:href'].includes(attr.name)&&value.startsWith('#')&&ids.has(value.slice(1)))value=`#${ids.get(value.slice(1))}`
        if(['aria-labelledby','aria-describedby','for'].includes(attr.name))value=value.split(/\s+/).map(id=>ids.get(id)||id).join(' ')
        if(value!==attr.value)node.setAttribute(attr.name,value)
      }
      if(node.tagName.toLowerCase()==='style') {
        node.textContent=rewriteURLs(node.textContent).replace(/#([\w-]+)(?=\s*[{:.#>+~,\[])/g,(all,id)=>ids.has(id)?`#${ids.get(id)}`:all)
      }
    }
    // Marp's bootstrap already ran in the original document.
    for(const script of clone.querySelectorAll('script'))script.remove()
    return clone
  }
  for(const [index,root] of roots.entries()) {
    const section=root.querySelector('section')
    if(!section)continue
    const stages=[...new Set([0,...[...section.querySelectorAll('[data-stage]')].map(el=>Number(el.dataset.stage)).filter(n=>Number.isInteger(n)&&n>=0)])].sort((a,b)=>a-b)
    let previous=root
    for(const stage of stages) {
      const page=stage===0?root:copyPage(root,`slide-${index+1}-stage-${stage}`)
      if(page!==root){previous.after(page);previous=page}
      page.dataset.sourceSlide=section.dataset.sourceSlide||String(index+1)
      page.dataset.exportStage=String(stage)
      for(const el of page.querySelectorAll('[data-stage]'))el.classList.toggle('stage-hidden',Number(el.dataset.stage)>stage)
      pages.push(page)
    }
  }
  if(pages.length>roots.length) {
    document.body.classList.add('stage-presentation')
    const controls=document.createElement('nav')
    controls.id='stage-controls'
    controls.setAttribute('aria-label','Presentation stages')
    controls.innerHTML='<button type="button" id="stage-previous" aria-label="Previous stage">← Previous</button><span id="stage-page-label" aria-live="polite"></span><button type="button" id="stage-next" aria-label="Next stage">Next →</button>'
    document.body.append(controls)
    const previous=controls.querySelector('#stage-previous'),next=controls.querySelector('#stage-next'),label=controls.querySelector('#stage-page-label')
    let current=0
    function show(index) {
      current=Math.max(0,Math.min(pages.length-1,index))
      pages.forEach((page,n)=>page.classList.toggle('stage-current',n===current))
      const page=pages[current]
      label.textContent=`Slide ${page.dataset.sourceSlide} · Stage ${page.dataset.exportStage} · ${current+1} / ${pages.length}`
      previous.disabled=current===0
      next.disabled=current===pages.length-1
    }
    previous.addEventListener('click',()=>show(current-1))
    next.addEventListener('click',()=>show(current+1))
    document.addEventListener('keydown',event=>{
      if(event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,select,[contenteditable="true"]'))return
      if(['ArrowRight','PageDown',' '].includes(event.key)){event.preventDefault();show(current+1)}
      if(['ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();show(current-1)}
      if(event.key==='Home'){event.preventDefault();show(0)}
      if(event.key==='End'){event.preventDefault();show(pages.length-1)}
    })
    show(0)
  }
  window.__marpStagesReady=true
}

export const stagePageCSS=`
  section .stage-hidden,section .stage-hidden *{visibility:hidden!important;pointer-events:none!important}
  #stage-controls{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:100;display:flex;align-items:center;gap:20px;padding:10px 14px;border-radius:10px;background:#fff;box-shadow:0 2px 18px #0003;font:14px system-ui,sans-serif;white-space:nowrap}
  #stage-controls button{padding:6px 10px;border:1px solid #d6c3d0;border-radius:6px;background:#faf7f9;color:#7a005f;cursor:pointer}
  #stage-controls button:disabled{opacity:.4;cursor:default}
  @media screen{body.stage-presentation{padding-bottom:70px}.stage-presentation .marpit>svg{display:none}.stage-presentation .marpit>svg.stage-current{display:block}}
  @media print{#stage-controls{display:none!important}.stage-presentation .marpit>svg{display:block}}
`
