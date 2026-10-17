import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState, reducePresentation, nextPosition, elapsedTime, restoreState, currentInk, publicState } from '../presenter/model.mjs'

const slides = [{stages:[0,2,5]},{stages:[0]},{stages:[0,3]}]
const stroke = id => ({id,tool:'pen',color:'#ef4444',width:4,points:[[100,100],[200,200]]})
const step = (state, action, now=1000) => reducePresentation(state,action,slides,now)

test('navigation uses actual reveal values and crosses slides reversibly', () => {
  let s=initialState(slides)
  assert.deepEqual(nextPosition(s,slides),{page:0,stage:2})
  for(const [page,stage] of [[0,2],[0,5],[1,0],[2,0],[2,3]]) {
    s=step(s,{type:'next'});assert.deepEqual({page:s.page,stage:s.stage},{page,stage})
  }
  assert.equal(nextPosition(s,slides),null)
  assert.equal(step(s,{type:'next'}),s)
  s=step(step(s,{type:'previous'}),{type:'previous'})
  assert.equal(s.page,1);assert.equal(s.stage,0)
  s=step(s,{type:'previous'});assert.equal(s.stage,5)
  s=step(s,{type:'jump',page:2});assert.equal(s.stage,0)
  assert.equal(step(s,{type:'jump',page:99}),s)
})

test('slide ink persists across reveals and navigation; board ink stays separate', () => {
  let s=step(initialState(slides),{type:'stroke',stroke:stroke('a')})
  s=step(s,{type:'next'});assert.equal(currentInk(s).length,1)
  s=step(s,{type:'jump',page:1});assert.equal(currentInk(s).length,0)
  s=step(s,{type:'jump',page:0});assert.equal(currentInk(s)[0].id,'a')
  s=step(s,{type:'board'});s=step(s,{type:'stroke',stroke:stroke('b')})
  assert.equal(currentInk(s)[0].id,'b')
  s=step(s,{type:'board'});assert.equal(currentInk(s)[0].id,'a')
})

test('undo and redo restore strokes erased or cleared in one action', () => {
  let s=step(initialState(slides),{type:'stroke',stroke:stroke('a')})
  s=step(s,{type:'erase',point:{x:150,y:150},radius:18});assert.equal(currentInk(s).length,0)
  s=step(s,{type:'undo'});assert.equal(currentInk(s).length,1)
  s=step(s,{type:'redo'});assert.equal(currentInk(s).length,0)
  s=step(s,{type:'undo'});s=step(s,{type:'clear'});assert.equal(currentInk(s).length,0)
  s=step(s,{type:'undo'});assert.equal(currentInk(s).length,1)
})

test('invalid commands and points do not corrupt state or leak private data', () => {
  const s=initialState(slides)
  for(const action of [{type:'tool',tool:'javascript:bad'},{type:'pointer',point:{x:NaN,y:0}},{type:'stroke',stroke:{...stroke('x'),color:'url(x)'}},{type:'target',minutes:-2},{type:'jump',page:1.5}])assert.equal(step(s,action),s)
  const raw={...s,page:900,stage:NaN,ink:{board:[stroke('safe'),{points:[]}],evil:[stroke('x')]},notes:'secret',timer:{elapsed:NaN}}
  const restored=restoreState(raw,slides,2)
  assert.equal(restored.page,1);assert.equal(restored.stage,0)
  assert.deepEqual(Object.keys(restored.ink),['board'])
  assert.equal(restored.ink.board.length,1)
  assert.ok(!JSON.stringify(publicState({...s,notes:'secret',source:'secret'})).includes('secret'))
})

test('timer survives pause/resume and preview does not start it', () => {
  let s=initialState(slides)
  assert.equal(elapsedTime(s,5000),0)
  s=step(s,{type:'timer-toggle'},1000)
  assert.equal(elapsedTime(s,6000),5000)
  s=step(s,{type:'timer-toggle'},6000)
  assert.equal(elapsedTime(s,9000),5000)
  s=step(s,{type:'timer-toggle'},9000)
  assert.equal(elapsedTime(s,11000),7000)
  s=step(s,{type:'timer-reset'},11000)
  assert.equal(elapsedTime(s,12000),0)
})

test('navigation and blanking clear transient pointers and drawing', () => {
  let s=step(initialState(slides),{type:'pointer',point:{x:200,y:300}})
  s=step(s,{type:'drawing',stroke:stroke('temporary')})
  s=step(s,{type:'blank'});assert.equal(s.pointer,null);assert.equal(s.drawing,null)
  assert.equal(step(s,{type:'stroke',stroke:stroke('hidden')}),s)
  s=step(s,{type:'next'});assert.equal(s.blank,false)
})

test('queued audience ink cannot cross a navigation or board context', () => {
  const original=initialState(slides)
  for(const action of [{type:'next'},{type:'board'},{type:'blank'},{type:'tool',tool:'laser'}]) {
    const changed=step(original,action)
    assert.ok(changed.context>original.context)
    for(const late of [{type:'stroke',stroke:stroke('late')},{type:'drawing',stroke:stroke('late')},{type:'pointer',point:{x:1,y:2}},{type:'erase',point:{x:1,y:2}},{type:'clear'},{type:'advance'}]) {
      assert.equal(step(changed,{...late,context:original.context}),changed)
    }
  }
  let state=step(original,{type:'next'})
  state=step(state,{type:'previous'})
  assert.equal(state.page,original.page);assert.equal(state.stage,original.stage)
  assert.equal(step(state,{type:'stroke',stroke:stroke('late'),context:original.context}),state)
})
