import { shapeTypes } from './shapes.mjs'
// Shared typed options for authored fences and guarded editor mutations.
export const optionRanges={dx:[-10000,10000],dy:[-10000,10000],width:[1,10000],height:[1,10000],font:[1,400],rotate:[-360,360],stroke_width:[0.1,40],stage:[0,99],layer:[-99,99]}
const bools=new Set(['bold','italic','underline','strike'])
const textKeys=new Set(['font','font_family','bold','italic','underline','strike','color','align'])
const shapeKeys=new Set(['shape','rotate','stroke','stroke_width','fill'])
export const optionKeys=new Set([...Object.keys(optionRanges),...bools,'font_family','color','align','shape','stroke','fill','crop','position'])
const textKinds=new Set(['box','caption','ref'])
export function normalizeEditPatch(patch,kind) {
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Invalid edit patch.')
 const out={}
 for(const [key,value] of Object.entries(patch)) {
  if(!optionKeys.has(key))throw new Error(`Unsupported edit option "${key}".`)
  if(kind&&textKeys.has(key)&&!textKinds.has(kind))throw new Error(`Unsupported ${key}: only supported for text blocks.`)
  if(kind&&key==='position'&&!textKinds.has(kind)&&kind!=='figure')throw new Error('Position is only supported for text and figures.')
  if(kind&&shapeKeys.has(key)&&kind!=='shape')throw new Error(`${key} is only supported for shapes.`)
  if(kind&&key==='crop'&&kind!=='figure')throw new Error('Crop is only supported for figures.')
  if(value===null){out[key]=null;continue}
  if(kind==='figure'&&key==='height')throw new Error('Figure height is derived from the visible crop aspect ratio. Resize using width.')
  if(Object.hasOwn(optionRanges,key)) {
   const [min,max]=optionRanges[key]
   if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(['stage','layer'].includes(key)&&!Number.isInteger(value)))throw new Error(`Invalid ${key}. Use ${key==='stage'?'an integer':'a finite number'} from ${min} to ${max}.`)
   out[key]=Number(value.toFixed(4))
  } else if(bools.has(key)) {
   if(typeof value!=='boolean')throw new Error(`Invalid ${key}. Use true or false.`)
   out[key]=value
  } else if(key==='crop') {
   if(!Array.isArray(value)||value.length!==4||value.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error('Invalid crop. Use four finite percentages.')
   const [l,t,w,h]=value
   if(l<0||t<0||w<=0||h<=0||l+w>100+1e-8||t+h>100+1e-8)throw new Error('Invalid crop. The rectangle must fit inside the image (0–100%).')
   const c=value.map(v=>Number(v.toFixed(4)))
   if(c[2]<=0||c[3]<=0||c[0]+c[2]>100||c[1]+c[3]>100)throw new Error('Invalid crop. The rounded rectangle must have positive size and fit inside the image (0–100%).')
   out[key]=c
  } else if(key==='font_family') {
   if(typeof value!=='string'||value.length>256||!value.trim())throw new Error('Invalid font family.')
   const family=value.replace(/["']/g,'').trim()
   if(!/^[\p{L}\p{N} _,-]+$/u.test(family)||family.split(',').some(v=>!v.trim()))throw new Error('Invalid font family. Use font names separated by commas.')
   out[key]=family
  } else if(['color','stroke','fill'].includes(key)) {
   if(key==='fill'&&value==='none'){out[key]=value;continue}
   if(typeof value!=='string'||!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value))throw new Error(`Invalid ${key}. Use a hex colour.`)
   out[key]=(value.length===4?'#'+[...value.slice(1)].map(c=>c+c).join(''):value).toLowerCase()
  } else {
   const allowed=key==='align'?['left','center','right']:key==='position'?['flow','absolute']:shapeTypes
   if(!allowed.includes(value))throw new Error(`Invalid ${key}: ${value}`)
   out[key]=value
  }
 }
 return out
}
export function readEditOptions(raw,kind) {
 const options={},errors=[]
 for(const [key,rawValue] of Object.entries(raw)) {
  if(!optionKeys.has(key))continue
  let value=rawValue
  if(Object.hasOwn(optionRanges,key))value=Number(rawValue)
  else if(bools.has(key))value=rawValue==='true'?true:rawValue==='false'?false:rawValue
  else if(key==='crop')value=String(rawValue).split(',').map(Number)
  try{Object.assign(options,normalizeEditPatch({[key]:value},kind))}catch(error){errors.push({key,message:error.message})}
 }
 return {options,errors}
}

// Font families are strings in CSS, except its generic-family keywords.
export function fontFamilyCSS(stack) {
 const generic=new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','emoji','math','fangsong'])
 return stack.split(',').map(name=>name.trim()).map(name=>generic.has(name.toLowerCase())?name.toLowerCase():JSON.stringify(name)).join(', ')
}
