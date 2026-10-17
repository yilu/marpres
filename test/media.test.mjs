import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceStore, scanEditable, hashSource } from '../editor/source-store.mjs'
import { importImage } from '../editor/media.mjs'
import { renderSource } from '../scripts/render.mjs'

const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400"><rect width="1000" height="400" fill="#7a005f"/></svg>')
const source='---\nmarp: true\ntheme: nju-unofficial-v2\n---\n# First\n\n---\n# Second\n'
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'marp-media-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const file=join(dir,'slides.md')
  await writeFile(file,source)
  const store=new SourceStore(file)
  return {dir,file,store,initial:await store.read()}
}

test('image import preserves bytes, centers an independent figure and is undoable',async t=>{
  const {dir,store,initial}=await fixture(t)
  const imported=await importImage(store,{hash:initial.hash,slide:2,name:'diagram.svg',data:svg.toString('base64')})
  const object=scanEditable(imported.source).find(item=>item.id===imported.selectedId)
  assert.equal(object.slide,2)
  assert.equal(object.kind,'figure')
  const options=Object.fromEntries(object.options.map(({key,value})=>[key,value]))
  assert.equal(options.position,'absolute')
  assert.equal(options.width,'500')
  assert.equal(options.dx,'390')
  assert.equal(options.dy,'260')
  const expectedPath=`figures/imported/${hashSource(svg)}.svg`
  assert.ok(object.content.includes(expectedPath))
  assert.deepEqual(await readFile(join(dir,expectedPath)),svg)
  const duplicate=await importImage(store,{hash:imported.hash,slide:2,name:'another.svg',data:svg.toString('base64')})
  assert.notEqual(duplicate.selectedId,imported.selectedId)
  assert.deepEqual(await readdir(join(dir,'figures/imported')),[`${hashSource(svg)}.svg`])
  const once=await store.undo({hash:duplicate.hash})
  assert.equal(once.source,imported.source)
  const undone=await store.undo({hash:once.hash})
  assert.equal(undone.source,initial.source)
  assert.deepEqual(await readFile(join(dir,expectedPath)),svg,'Undo retains bytes needed by redo')
  const redone=await store.redo({hash:undone.hash})
  assert.equal(redone.source,imported.source)
  const deck=await renderSource(redone.source,{baseDir:dir})
  assert.deepEqual(deck.diagnostics,[])
  assert.match(deck.html,/data:image\/svg\+xml;base64,/)
})

test('import validates image format, canonical base64, size and slide before creating assets',async t=>{
  const {dir,store,initial}=await fixture(t)
  const base={hash:initial.hash,slide:1,name:'diagram.svg',data:svg.toString('base64')}
  for(const patch of [
    {data:'data:image/svg+xml;base64,'+base.data},
    {data:base.data+'?'},
    {data:''},
    {data:Buffer.from('not an image').toString('base64')},
    {name:'text.txt'},
    {name:'diagram.png'},
    {data:Buffer.alloc(10*1024*1024+1).toString('base64')},
    {slide:0},{slide:3},{slide:1.5},
  ])await assert.rejects(importImage(store,{...base,...patch}),{code:'INVALID'})
  assert.deepEqual(await readdir(dir),['slides.md'])
  assert.equal((await store.read()).source,initial.source)
})

test('stale image imports leave no assets or Markdown edits',async t=>{
  const {dir,file,store,initial}=await fixture(t)
  const external=initial.source+'\nExternal edit.\n'
  await writeFile(file,external)
  await assert.rejects(importImage(store,{hash:initial.hash,slide:1,name:'diagram.svg',data:svg.toString('base64')}),{code:'CONFLICT'})
  assert.deepEqual(await readdir(dir),['slides.md'])
  assert.equal(await readFile(file,'utf8'),external)
})

test('snapshot renderer does not reread deck Markdown and resolves relative image assets',async t=>{
  const {dir,file}=await fixture(t)
  await writeFile(join(dir,'plot.svg'),svg)
  const snapshot=source+'\n::: figure id=snapshot width=250\n![plot](plot.svg)\n:::\n'
  await writeFile(file,'# Different current content\n')
  const rendered=await renderSource(snapshot,{baseDir:dir,draft:true})
  assert.equal(rendered.source,snapshot)
  assert.equal(rendered.hash,hashSource(snapshot))
  assert.equal(rendered.draft,true)
  assert.deepEqual(rendered.diagnostics,[])
  assert.match(rendered.html,/data:image\/svg\+xml;base64,/)
  assert.doesNotMatch(rendered.html,/Different current content/)
})
