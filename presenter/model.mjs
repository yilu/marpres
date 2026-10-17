import { hitStroke } from './geometry.mjs'

export const tools = ['arrow','hand','laser','spotlight','pen','highlighter','eraser']
export const contextualActions = new Set(['pointer','drawing','stroke','erase','advance','undo','redo','clear'])
const colorOK = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
const pointOK = p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
const clampPoint = p => ({x:Math.max(0,Math.min(1280,p.x)),y:Math.max(0,Math.min(720,p.y))})
const stages = (slides,page) => slides[page]?.stages?.length ? slides[page].stages : [0]
export const inkKey = state => state.board ? 'board' : `slide:${state.page}`
export const currentInk = state => state.ink[inkKey(state)] || []
export const elapsedTime = (state,now=Date.now()) => state.timer.elapsed + (state.timer.startedAt === null ? 0 : Math.max(0,now-state.timer.startedAt))

export function initialState(slides,startSlide=1) {
  const page=Number.isInteger(startSlide)&&startSlide>=1&&startSlide<=slides.length ? startSlide-1 : 0
  return {page,stage:0,context:0,tool:'arrow',color:'#ef4444',width:4,pointer:null,drawing:null,blank:false,board:false,ink:{},undo:{},redo:{},timer:{elapsed:0,startedAt:null,target:16*60000}}
}
export function nextPosition(state,slides,direction=1) {
  const values=stages(slides,state.page),index=values.indexOf(state.stage)
  if(direction>0) {
    if(index<values.length-1)return {page:state.page,stage:values[index+1]}
    if(state.page<slides.length-1)return {page:state.page+1,stage:0}
  } else {
    if(index>0)return {page:state.page,stage:values[index-1]}
    if(state.page>0)return {page:state.page-1,stage:stages(slides,state.page-1).at(-1)}
  }
  return null
}
function validStroke(stroke) {
  if(!stroke||typeof stroke.id!=='string'||stroke.id.length>100||!['pen','highlighter'].includes(stroke.tool)||!colorOK(stroke.color)||!Number.isFinite(stroke.width)||stroke.width<1||stroke.width>32||!Array.isArray(stroke.points)||!stroke.points.length||stroke.points.length>4096)return null
  if(!stroke.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))return null
  return {id:stroke.id,tool:stroke.tool,color:stroke.color,width:stroke.width,points:stroke.points.map(([x,y])=>{const p=clampPoint({x,y});return [p.x,p.y]})}
}
function changeInk(state,ink) {
  const key=inkKey(state),old=currentInk(state)
  return {...state,drawing:null,ink:{...state.ink,[key]:ink},undo:{...state.undo,[key]:[...(state.undo[key]||[]),old].slice(-30)},redo:{...state.redo,[key]:[]}}
}
export function reducePresentation(state,action,slides,now=Date.now()) {
  if(!action||typeof action!=='object')return state
  if(contextualActions.has(action.type)&&action.context!==undefined&&action.context!==state.context)return state
  let destination
  switch(action.type) {
    case 'advance': if(state.board||state.blank)return state // Clicking a board should not leave it.
    case 'next': destination=nextPosition(state,slides);break
    case 'previous': destination=nextPosition(state,slides,-1);break
    case 'first': destination={page:0,stage:0};break
    case 'last': destination={page:slides.length-1,stage:stages(slides,slides.length-1).at(-1)};break
    case 'jump': if(Number.isInteger(action.page)&&action.page>=0&&action.page<slides.length)destination={page:action.page,stage:0};break
    case 'blank': return {...state,context:state.context+1,blank:!state.blank,pointer:null,drawing:null}
    case 'board': return {...state,context:state.context+1,board:!state.board,blank:false,pointer:null,drawing:null}
    case 'tool': return tools.includes(action.tool)?{...state,context:state.context+1,tool:action.tool,pointer:null,drawing:null}:state
    case 'color': return colorOK(action.color)?{...state,color:action.color}:state
    case 'width': return Number.isFinite(action.width)&&action.width>=1&&action.width<=32?{...state,width:action.width}:state
    case 'pointer': return state.blank?state:action.point===null?{...state,pointer:null}:pointOK(action.point)?{...state,pointer:clampPoint(action.point)}:state
    case 'drawing': {
      if(state.blank)return state
      if(action.stroke===null)return {...state,drawing:null}
      const drawing=validStroke(action.stroke);return drawing?{...state,drawing}:state
    }
    case 'stroke': {
      if(state.blank)return state
      const stroke=validStroke(action.stroke),ink=currentInk(state)
      if(!stroke)return state
      if(ink.length>=200||ink.some(item=>item.id===stroke.id))return {...state,drawing:null}
      return changeInk(state,[...ink,stroke])
    }
    case 'erase': {
      if(state.blank||!pointOK(action.point))return state
      const ink=currentInk(state),index=ink.findLastIndex(stroke=>hitStroke(stroke,action.point,18))
      return index<0?state:changeInk(state,ink.filter((_,i)=>i!==index))
    }
    case 'clear': return currentInk(state).length?changeInk(state,[]):state
    case 'undo': case 'redo': {
      const key=inkKey(state),from=action.type,to=from==='undo'?'redo':'undo',history=state[from][key]||[]
      if(!history.length)return state
      return {...state,drawing:null,ink:{...state.ink,[key]:history.at(-1)},[from]:{...state[from],[key]:history.slice(0,-1)},[to]:{...state[to],[key]:[...(state[to][key]||[]),currentInk(state)].slice(-30)}}
    }
    case 'timer-toggle': return {...state,timer:{...state.timer,elapsed:elapsedTime(state,now),startedAt:state.timer.startedAt===null?now:null}}
    case 'timer-reset': return {...state,timer:{...state.timer,elapsed:0,startedAt:null}}
    case 'target': return Number.isFinite(action.minutes)&&action.minutes>=1&&action.minutes<=480?{...state,timer:{...state.timer,target:action.minutes*60000}}:state
  }
  return destination?{...state,...destination,context:state.context+1,board:false,blank:false,pointer:null,drawing:null}:state
}

// Explicit allowlist keeps source, notes, edit tokens and undo history out of
// audience messages even if a caller adds private fields to its own state.
export function publicState(state) {
  const {page,stage,context,tool,color,width,pointer,drawing,blank,board,ink}=state
  return {page,stage,context,tool,color,width,pointer,drawing,blank,board,ink}
}
export function restoreState(raw,slides,startSlide=1) {
  let state=initialState(slides,startSlide)
  if(!raw||typeof raw!=='object')return state
  if(Number.isSafeInteger(raw.context)&&raw.context>=0)state.context=raw.context
  if(Number.isInteger(raw.page)&&raw.page>=0&&raw.page<slides.length)state.page=raw.page
  if(stages(slides,state.page).includes(raw.stage))state.stage=raw.stage
  if(tools.includes(raw.tool))state.tool=raw.tool
  if(colorOK(raw.color))state.color=raw.color
  if(Number.isFinite(raw.width)&&raw.width>=1&&raw.width<=32)state.width=raw.width
  for(const flag of ['blank','board'])state[flag]=raw[flag]===true
  for(const [key,ink] of Object.entries(raw.ink||{})) {
    if(key!=='board'&&!slides.some((_,i)=>key===`slide:${i}`))continue
    if(Array.isArray(ink))state.ink[key]=ink.slice(0,200).map(validStroke).filter(Boolean)
  }
  if(raw.timer&&Number.isFinite(raw.timer.elapsed)&&raw.timer.elapsed>=0) {
    state.timer.elapsed=raw.timer.elapsed
    if(Number.isFinite(raw.timer.startedAt)&&raw.timer.startedAt>=0)state.timer.startedAt=raw.timer.startedAt
    if(Number.isFinite(raw.timer.target)&&raw.timer.target>=60000&&raw.timer.target<=480*60000)state.timer.target=raw.timer.target
  }
  return state
}
