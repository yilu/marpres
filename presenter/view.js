// Each view owns an isolated document. Slide CSS cannot restyle the console,
// and Marp's custom elements retain their own auto-scaling lifecycle.
export class SlideView {
  constructor(host,deck,{label='Slide preview'}={}) {
    this.host=host
    this.viewport=document.createElement('div');this.viewport.className='slide-viewport'
    this.frame=document.createElement('iframe');this.frame.title=label;this.frame.tabIndex=-1
    this.frame.setAttribute('sandbox','allow-scripts allow-same-origin')
    this.frame.setAttribute('aria-hidden','true')
    this.viewport.append(this.frame);host.append(this.viewport)
    this.position={page:deck.startSlide-1,stage:0,board:false,blank:false}
    this.ready=new Promise(resolve=>this.frame.addEventListener('load',()=>{this.loaded=true;this.update(this.position);resolve()},{once:true}))
    const css=`${deck.css}\nhtml,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#000}.marpit>svg[data-marpit-svg]{display:none!important;position:absolute!important;inset:0!important;width:1280px!important;height:720px!important;margin:0!important;box-shadow:none!important}.marpit>svg[data-marpit-svg].presenter-current{display:block!important}section .stage-hidden,section .stage-hidden *{visibility:hidden!important;pointer-events:none!important}`
    this.frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${deck.html}</body></html>`
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize()
  }
  resize() {
    const bounds=this.host.getBoundingClientRect(),scale=Math.max(.01,Math.min(bounds.width/1280,bounds.height/720))
    this.viewport.style.width=`${1280*scale}px`;this.viewport.style.height=`${720*scale}px`
    this.frame.style.transform=`scale(${scale})`
  }
  update(position) {
    const previous=this.position;this.position=position
    this.viewport.classList.toggle('whiteboard',!!position.board)
    this.viewport.classList.toggle('blacked-out',!!position.blank)
    this.frame.style.visibility=position.board||position.blank?'hidden':'visible'
    if(!this.loaded)return
    if(previous===position&&this.rendered)return
    if(this.rendered&&previous.page===position.page&&previous.stage===position.stage)return
    const roots=[...this.frame.contentDocument.querySelectorAll('.marpit>svg[data-marpit-svg]')]
    roots.forEach((root,index)=>{
      root.classList.toggle('presenter-current',index===position.page)
      if(index===position.page)for(const item of root.querySelectorAll('[data-stage]'))item.classList.toggle('stage-hidden',Number(item.dataset.stage)>position.stage)
    })
    this.viewport.dataset.page=String(position.page);this.viewport.dataset.stage=String(position.stage)
    this.rendered=true
  }
  destroy(){this.observer.disconnect();this.viewport.remove()}
}
