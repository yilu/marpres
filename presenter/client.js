import { initialState, reducePresentation, nextPosition, currentInk, inkKey, elapsedTime, publicState, restoreState, contextualActions } from './model.mjs'
import { SlideView } from './view.js'
import { createOverlay } from './overlay.js'

const $=selector=>document.querySelector(selector)
const role=document.body.dataset.role, presenter=role==='presenter'
const id=new URLSearchParams(location.search).get('session')
const key=new URLSearchParams(location.hash.slice(1)).get('key')||''
const client=crypto.randomUUID(), storageKey=`marpres:session:${id}`
let deck,state,channel,view,nextView,overlay,epoch=0,revision=0,seenEpoch=0,seenRevision=-1,controller=null,ended=false,releaseLock
let lastController=Date.now(),lastPage=-1,transientFrame,persistTimer,hudTimer,heartbeat,timerInterval
const audienceWindows=new Map()
const toolDefinitions=[
  ['arrow','Arrow','V','M5 3v17l5-5 4 6 3-2-4-6h7Z'],['hand','Hand','','M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-4-2-6-4l-4-5a2 2 0 0 1 3-2l2 2'],
  ['laser','Laser','L','m4 20 11-11 3 3L7 23ZM17 4l1-3m3 6 3-1M12 4l-2-2'],['spotlight','Spotlight','S','M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Zm0 5v8m-4-4h8'],
  ['pen','Pen','P','m4 16 12-12 4 4L8 20l-5 1Zm10-10 4 4'],['highlighter','Highlight','H','m5 14 10-11 6 6-11 10Zm0 0 5 5-3 3H2v-5Z'],['eraser','Eraser','E','m3 14 11-11 7 7-11 11H7Zm4-4 7 7M10 21h12']
]

function status(message){$('#status').textContent=message}
function failure(error) {
  $('#loading').hidden=true;$('#console').hidden=true;$('#audience').hidden=true;$('#failure').hidden=false
  $('#failure-message').textContent=error.message||String(error)
}
async function fetchSnapshot() {
  if(!id||!/^[a-zA-Z0-9_-]{16,128}$/.test(id))throw new Error('Open a presentation from the editor’s Present button.')
  const response=await fetch(`/api/presentation/${encodeURIComponent(id)}?role=${role}`,{headers:presenter?{'X-Presenter-Key':key}:{}})
  const value=await response.json();if(!response.ok)throw new Error(value.error||'The presentation is no longer available. Start it again from the editor.')
  return value
}
function loadSaved() {
  try{return JSON.parse(localStorage.getItem(storageKey)||'null')}catch{return null}
}
function persist() {
  clearTimeout(persistTimer)
  persistTimer=setTimeout(persistNow,120)
}
function persistNow() {
  clearTimeout(persistTimer)
  try{localStorage.setItem(storageKey,JSON.stringify({epoch,ended,state:{...publicState(state),timer:state.timer}}))}
  catch{status('Presentation is running. Browser storage is unavailable, so refreshing may reset it.')}
}
function packet(kind,extra={}) {return {session:id,kind,client,epoch,...extra}}
function sendState() {
  if(ended)return
  channel.postMessage(packet('state',{controller:client,revision:++revision,view:publicState(state)}))
}
function sendTransient() {
  if(transientFrame)return
  transientFrame=requestAnimationFrame(()=>{
    transientFrame=null
    if(!ended)channel.postMessage(packet('transient',{controller:client,revision:++revision,context:state.context,pointer:state.pointer,drawing:state.drawing}))
  })
}
function dispatch(action) {
  if(ended)return
  if(!presenter){channel.postMessage(packet('command',{epoch:seenEpoch,context:state.context,action}));return}
  const updated=reducePresentation(state,action,deck.slides)
  if(updated===state)return
  state=updated
  if(action.type==='pointer'||action.type==='drawing') {paintOverlay();sendTransient();return}
  paint();sendState();persist()
}
function paintOverlay() {
  overlay.update({context:state.context,tool:state.tool,color:state.color,width:state.width,pointer:state.pointer,drawing:state.drawing,strokes:currentInk(state),blank:state.blank})
}
function paint() {
  view.update(state);paintOverlay()
  if(!presenter)return
  $('#position').textContent=`${state.board?'Whiteboard · ':state.blank?'Black screen · ':''}Slide ${state.page+1} / ${deck.slides.length} · Reveal ${state.stage}`
  $('#slide-picker').value=String(state.page)
  $('#previous').disabled=!nextPosition(state,deck.slides,-1)
  $('#next').disabled=!nextPosition(state,deck.slides)
  for(const [button,field] of [['#black','blank'],['#board','board']])$(button).setAttribute('aria-pressed',String(state[field]))
  for(const button of $('#tools').children)button.setAttribute('aria-pressed',String(button.dataset.tool===state.tool))
  $('#ink-color').value=state.color;$('#ink-width').value=String(state.width)
  $('#ink-undo').disabled=!(state.undo[inkKey(state)]||[]).length
  $('#ink-redo').disabled=!(state.redo[inkKey(state)]||[]).length
  $('#ink-clear').disabled=!currentInk(state).length
  const upcoming=nextPosition(state,deck.slides)
  $('#finished').hidden=!!upcoming;$('#next-view').hidden=!upcoming
  $('#next-label').textContent=upcoming?`Slide ${upcoming.page+1} · Reveal ${upcoming.stage}`:''
  if(upcoming)nextView.update({...upcoming,board:false,blank:false})
  if(lastPage!==state.page) {
    const notes=deck.notes?.[state.page]
    $('#notes').innerHTML=notes?.html||'<p class="notes-empty">No speaker notes on this slide. Add them with Notes in the editor.</p>'
    $('#notes').scrollTop=0;lastPage=state.page
  }
  $('#target').value=String(state.timer.target/60000)
  paintTimer()
}
function paintTimer() {
  const elapsed=elapsedTime(state),seconds=Math.floor(elapsed/1000),minutes=Math.floor(seconds/60)
  $('#timer').textContent=`${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`
  $('#clock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
  $('#timer-toggle').textContent=state.timer.startedAt===null?'Start timer':'Pause timer'
  $('#timer-progress').style.width=`${Math.min(100,elapsed/state.timer.target*100)}%`
  $('.timer-card').classList.toggle('over-time',elapsed>=state.timer.target)
}
function hello(){if(!ended)channel.postMessage(packet('hello',{epoch:seenEpoch}))}
function receive(message) {
  const data=message.data
  if(!data||data.session!==id||data.client===client||ended)return
  if(presenter) {
    if(data.kind==='hello') {audienceWindows.set(data.client,Date.now());sendState();connection();return}
    if(data.kind==='command'&&data.epoch===epoch) {
      if(contextualActions.has(data.action?.type)&&data.context!==state.context)return
      dispatch({...data.action,context:data.context})
    }
    return
  }
  if(!Number.isSafeInteger(data.epoch)||data.epoch<seenEpoch)return
  if(data.kind==='ping') {lastController=Date.now();hello();return}
  if(!['state','transient','ended'].includes(data.kind)||!Number.isSafeInteger(data.revision)||data.epoch===seenEpoch&&data.revision<=seenRevision)return
  if(data.kind==='transient'&&(data.epoch!==seenEpoch||data.controller!==controller))return
  if(data.kind==='state') {
    if(!data.view||typeof data.controller!=='string')return
    state=restoreState(data.view,deck.slides,deck.startSlide)
    state=reducePresentation(state,{type:'pointer',point:data.view.pointer},deck.slides)
    state=reducePresentation(state,{type:'drawing',stroke:data.view.drawing},deck.slides)
    seenEpoch=data.epoch;controller=data.controller
  } else if(data.kind==='transient') {
    if(data.context!==state.context)return
    state=reducePresentation(state,{type:'pointer',point:data.pointer},deck.slides)
    state=reducePresentation(state,{type:'drawing',stroke:data.drawing},deck.slides)
  } else {showEnded();return}
  seenRevision=data.revision;lastController=Date.now();$('#audience-status').textContent='Connected · F for fullscreen'
  paint()
}
function connection() {
  if(ended)return
  if(presenter) {
    const count=[...audienceWindows.values()].filter(time=>Date.now()-time<3500).length
    $('#connection').textContent=count?`Audience connected${count>1?` (${count})`:''}`:'Audience not connected'
    $('#connection').classList.toggle('connected',count>0)
  } else if(Date.now()-lastController>3500) {
    $('#audience-status').textContent='Presenter disconnected. Reopen its console to continue.'
    state={...state,pointer:null,drawing:null};paintOverlay();revealHUD(true)
  }
}
function revealHUD(sticky=false) {
  $('#audience-controls').classList.remove('dormant');clearTimeout(hudTimer)
  if(!sticky&&document.fullscreenElement)hudTimer=setTimeout(()=>$('#audience-controls').classList.add('dormant'),1700)
}
async function fullscreen() {
  try{
    if(document.fullscreenElement)await document.exitFullscreen()
    else await $('#audience').requestFullscreen()
  }catch{$('#audience-status').textContent='Fullscreen was unavailable. Use the browser’s fullscreen command.'}
  revealHUD()
}
function showEnded() {
  ended=true;clearInterval(heartbeat);clearInterval(timerInterval);clearTimeout(hudTimer);clearTimeout(persistTimer)
  if(transientFrame)cancelAnimationFrame(transientFrame)
  overlay?.destroy();channel?.close();releaseLock?.()
  if(presenter) {
    $('#console').hidden=true;$('#failure').hidden=false;$('#failure h1').textContent='Presentation ended'
    $('#failure-message').textContent='Your slides and notes are unchanged. Start a new presentation from the editor.';$('#retry').hidden=true
  } else {$('#ended').hidden=false;$('#audience-controls').hidden=true}
}
async function endPresentation() {
  try {
    const response=await fetch(`/api/presentation/${id}/end`,{method:'POST',headers:{'Content-Type':'application/json','X-Presenter-Key':key},body:'{}'})
    if(!response.ok)throw new Error((await response.json()).error||'Could not end presentation.')
    channel.postMessage(packet('ended',{controller:client,revision:++revision}))
    try{localStorage.setItem(storageKey,JSON.stringify({ended:true,epoch}))}catch{}
    showEnded()
  }catch(error){status(error.message)}
}
function setupConsole() {
  $('#console').hidden=false;$('#deck-title').textContent=deck.title||'Presentation'
  document.title=`${deck.title||'Marpres'} · Presenter`
  $('#slide-picker').replaceChildren(...deck.slides.map((slide,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1}. ${slide.title}`;return option}))
  $('#slide-picker').addEventListener('change',event=>dispatch({type:'jump',page:Number(event.target.value)}))
  for(const [name,label,shortcut,path] of toolDefinitions) {
    const button=document.createElement('button');button.dataset.tool=name;button.title=label+(shortcut?` · ${shortcut}`:'');button.setAttribute('aria-label',label)
    button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg><span>${label}</span>`
    button.addEventListener('click',()=>dispatch({type:'tool',tool:name}));$('#tools').append(button)
  }
  for(const [button,type] of [['previous','previous'],['next','next'],['black','blank'],['board','board'],['ink-undo','undo'],['ink-redo','redo'],['ink-clear','clear'],['timer-toggle','timer-toggle'],['timer-reset','timer-reset']])$('#'+button).addEventListener('click',()=>dispatch({type}))
  $('#ink-color').addEventListener('input',event=>dispatch({type:'color',color:event.target.value}))
  $('#ink-width').addEventListener('input',event=>dispatch({type:'width',width:Number(event.target.value)}))
  $('#target').addEventListener('change',event=>dispatch({type:'target',minutes:Number(event.target.value)}))
  $('#open-audience').addEventListener('click',()=>{
    const url=`/audience?session=${encodeURIComponent(id)}`
    const popup=window.open(url,`marpres-audience-${id}`,'popup,width=1280,height=720')
    if(!popup){status('The audience window was blocked. Allow popups, or open this link: ');const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent='Audience window';$('#status').append(link)}
    else {popup.focus();status('Move the audience window to your second display, then choose Enter fullscreen there.')}
  })
  $('#end').addEventListener('click',endPresentation)
  $('#help-toggle').addEventListener('click',()=>$('#help').showModal())
  $('#help-close').addEventListener('click',()=>$('#help').close())
  $('#notes-toggle').addEventListener('click',()=>{const hidden=!$('#notes').hidden;$('#notes').hidden=hidden;$('#notes-toggle').textContent=hidden?'Show':'Hide';$('#notes-toggle').setAttribute('aria-pressed',String(!hidden))})
  let notesSize=17
  for(const [button,delta] of [['notes-smaller',-1],['notes-larger',1]])$('#'+button).addEventListener('click',()=>{notesSize=Math.max(12,Math.min(32,notesSize+delta));$('#notes').style.setProperty('--notes-size',`${notesSize}px`)})
  view=new SlideView($('#current-view'),deck)
  nextView=new SlideView($('#next-view'),deck,{label:'Next reveal preview'})
  overlay=createOverlay({host:view.viewport,onAction:dispatch})
  timerInterval=setInterval(paintTimer,250)
}
function setupAudience() {
  $('#audience').hidden=false;document.title='Marpres · Audience'
  view=new SlideView($('#audience-view'),deck,{label:'Audience slide'})
  overlay=createOverlay({host:view.viewport,onAction:dispatch})
  $('#fullscreen').addEventListener('click',fullscreen)
  $('#audience-previous').addEventListener('click',()=>dispatch({type:'previous'}));$('#audience-next').addEventListener('click',()=>dispatch({type:'next'}))
  document.addEventListener('fullscreenchange',()=>{$('#fullscreen').textContent=document.fullscreenElement?'Exit fullscreen':'Enter fullscreen';view.resize();revealHUD()})
  document.addEventListener('pointermove',()=>revealHUD())
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)hello()})
}
function keys(event) {
  if(ended||!state||event.altKey||event.target.closest('input,textarea,select,[contenteditable=true]')||$('#help').open)return
  if(event.target.closest('button,a')&&[' ','Enter'].includes(event.key))return
  let action
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z')action={type:event.shiftKey?'redo':'undo'}
  else if(event.metaKey||event.ctrlKey)return
  else if(['ArrowRight','ArrowDown','PageDown',' '].includes(event.key))action={type:'next'}
  else if(['ArrowLeft','ArrowUp','PageUp'].includes(event.key))action={type:'previous'}
  else if(event.key==='Home')action={type:'first'}
  else if(event.key==='End')action={type:'last'}
  else if(event.key.toLowerCase()==='b')action={type:'blank'}
  else if(event.key.toLowerCase()==='w')action={type:'board'}
  else if(event.key==='Escape') {
    if(document.fullscreenElement)return
    action=state.blank?{type:'blank'}:state.board?{type:'board'}:{type:'tool',tool:'arrow'}
  } else if(event.key.toLowerCase()==='f'&&!presenter){event.preventDefault();fullscreen();return}
  else if(event.key==='?'&&presenter){$('#help').showModal();return}
  else {const tool={v:'arrow',l:'laser',s:'spotlight',p:'pen',h:'highlighter',e:'eraser'}[event.key.toLowerCase()];if(tool)action={type:'tool',tool}}
  if(action){event.preventDefault();dispatch(action)}
}
async function start() {
  const saved=presenter?loadSaved():null
  if(saved?.ended)throw new Error('This presentation has ended. Start a new one from the editor.')
  state=presenter?restoreState(saved?.state,deck.slides,deck.startSlide):initialState(deck.slides,deck.startSlide)
  epoch=presenter?Math.max(Date.now(),Number(saved?.epoch||0)+1):0
  channel=new BroadcastChannel(`marpres:${id}`);channel.onmessage=receive
  if(presenter)setupConsole();else setupAudience()
  $('#loading').hidden=true
  paint();await view.ready;paint()
  document.addEventListener('keydown',keys)
  if(presenter){persist();sendState()}else hello()
  heartbeat=setInterval(()=>{connection();if(presenter)channel.postMessage(packet('ping'));else hello()},1000)
  if(presenter)window.addEventListener('pagehide',()=>{if(!ended)persistNow()})
}
$('#retry').addEventListener('click',()=>location.reload())
try {
  deck=await fetchSnapshot()
  if(presenter) {
    if(!navigator.locks)throw new Error('Presenter mode requires a browser with Web Locks support. Open the editor in current Chrome.')
    navigator.locks.request(`marpres-controller:${id}`,{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('This presentation already has a presenter console. Close that console, then try again here.')
      await start();if(!ended)await new Promise(resolve=>{releaseLock=resolve})
    }).catch(failure)
  } else await start()
}catch(error){failure(error)}
