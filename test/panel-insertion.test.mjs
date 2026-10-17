import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceStore, mapSource, insertText, insertShape, hashSource } from '../editor/source-store.mjs'
import { importImage } from '../editor/media.mjs'
import { createDraftServer } from '../editor/server.mjs'
import { renderSource } from '../scripts/render.mjs'

const source=`---
marp: true
theme: nju-unofficial-v2
---
# First

\`\`\`md
::: panel id=code
Literal panel.
:::
\`\`\`

<!--
::: panel id=comment
Literal panel.
:::
-->

    ::: panel id=indented
    Literal panel.
    :::

::::: box id=outer-box
:::: panel id=inside-box
Nested panel.
::::
:::::

::::: panel id=left custom="keep me"
::: box id=old-left
Left content.
:::
:::: col id=inside-left
Nested column.
::::
:::::

:::: col id=right custom="keep this too"
::: box id=old-right
Right **content**.
:::
::: caption id=right-caption
Keep caption.
:::
::::

---
# Second

::: panel id=second
Second slide content.
:::
`
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400"><rect width="1000" height="400"/></svg>')
const image={name:'plot.svg',data:svg.toString('base64')}

async function fixture(t,initial=source) {
  const dir=await mkdtemp(join(tmpdir(),'marp-panel-insert-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const file=join(dir,'deck.md')
  await writeFile(file,initial)
  const store=new SourceStore(file)
  return {dir,file,store,initial:await store.read()}
}
function objectAndParents(source,id) {
  const map=mapSource(source),object=map.objects.find(item=>item.id===id)
  assert.ok(object,`Missing inserted object ${id}`)
  return {object,parents:map.blocks.filter(block=>block.line<object.line&&block.endLine>object.endLine)}
}
function assertFlow(object) {
  const options=Object.fromEntries(object.options.map(({key,value})=>[key,value]))
  for(const key of ['position','dx','dy','width','height'])assert.equal(options[key],undefined,`Panel insertion must not pin ${key}`)
}

test('text insertion targets only top-level panels on its slide and preserves LF/CRLF source',()=>{
  for(const eol of ['\n','\r\n'])for(const [slide,panel,parent] of [[1,1,'left'],[1,2,'right'],[2,1,'second']]) {
    const original=source.replaceAll('\n',eol)
    const result=insertText(original,slide,'New **text**',{id:'inserted',panel})
    const {object,parents}=objectAndParents(result.source,result.id)
    assert.equal(object.slide,slide)
    assert.equal(object.content,'New **text**')
    assert.deepEqual(parents.map(item=>item.id),[parent])
    assertFlow(object)
    const target=mapSource(original).blocks.find(item=>item.id===parent)
    const beforeClosing=original.split('\n').slice(0,target.endLine-1).join('\n')+'\n'
    assert.ok(result.source.startsWith(beforeClosing),'All original bytes before the panel closing fence are preserved')
    assert.ok(result.source.endsWith(original.slice(beforeClosing.length)),'All original bytes from the panel closing fence are preserved')
    if(eol==='\r\n')assert.doesNotMatch(result.source,/(?<!\r)\n/)
  }
})

test('omitted and null panel preserve free text and shape placement',()=>{
  for(const panel of [undefined,null]) {
    const result=insertText(source,1,'Free text',{id:'free',panel})
    const {object,parents}=objectAndParents(result.source,result.id)
    assert.deepEqual(parents,[])
    assert.match(result.source,/id=free position=absolute dx=480 dy=280 width=360/)
    assert.equal(object.slide,1)
    assert.doesNotThrow(()=>insertShape(source,1,'rect',{panel}))
  }
})

test('panel indices exclude panels nested in Markdown lists',async()=>{
  const source='# Test\n\n- List item\n\n  ::: panel id=in-list\n  Nested panel.\n  :::\n\n::: panel id=real\nReal panel.\n:::\n'
  const rendered=await renderSource(source)
  assert.deepEqual([...rendered.html.matchAll(/data-panel-id="([^"]+)"/g)].map(match=>match[1]),['real'])
  const inserted=insertText(source,1,'Added',{id:'added',panel:1})
  assert.deepEqual(objectAndParents(inserted.source,inserted.id).parents.map(item=>item.id),['real'])
  assert.throws(()=>insertText(source,1,'Added',{panel:2}),{code:'INVALID'})
})

test('panel numbering agrees with rendered adjacent panels after lists and quotes',async()=>{
  for(const content of ['- Item','1. Item','> Quote'])for(const third of [false,true])for(const eol of ['\n','\r\n']) {
    const source=(`::: panel id=p\n${content}\n:::\n::: col id=q\nSecond\n:::\n`+(third?'\n::: panel id=r\nThird\n:::\n':'')).replaceAll('\n',eol)
    const rendered=await renderSource(source)
    assert.deepEqual(rendered.diagnostics,[])
    const renderedIds=[...rendered.html.matchAll(/data-panel-id="([^"]+)"/g)].map(match=>match[1])
    assert.deepEqual(renderedIds,third?['p','q','r']:['p','q'])
    const mappedIds=mapSource(source).blocks.filter(block=>block.depth===0&&['panel','col'].includes(block.kind)).map(block=>block.id)
    assert.deepEqual(mappedIds,renderedIds,`Top-level panel mapping after ${content}`)
    for(const [index,id] of renderedIds.entries()) {
      const inserted=insertText(source,1,'Added',{id:'added',panel:index+1})
      assert.deepEqual(objectAndParents(inserted.source,inserted.id).parents.map(item=>item.id),[id])
      if(eol==='\r\n')assert.doesNotMatch(inserted.source,/(?<!\r)\n/)
    }
  }
})

test('image insertion targets the second adjacent panel after lists and quotes',async t=>{
  for(const content of ['- Item','1. Item','> Quote']) {
    const source=`::: panel id=p\n${content}\n:::\n::: panel id=q\nSecond\n:::\n\n::: panel id=r\nThird\n:::\n`
    const {store,initial}=await fixture(t,source)
    const inserted=await importImage(store,{hash:initial.hash,slide:1,panel:2,...image})
    assert.deepEqual(objectAndParents(inserted.source,inserted.selectedId).parents.map(item=>item.id),['q'])
    assert.equal((await store.undo({hash:inserted.hash})).source,source)
  }
})

test('invalid panel indices and shape panel requests reject without changing source or history',async t=>{
  const {store,initial,file}=await fixture(t)
  for(const panel of [0,-1,1.5,'1',true,{},[],3]) {
    assert.throws(()=>insertText(source,1,'Text',{panel}),{code:'INVALID'})
    await assert.rejects(store.insert({hash:initial.hash,slide:1,kind:'box',panel}),{code:'INVALID'})
  }
  assert.throws(()=>insertText(source,2,'Text',{panel:2}),{code:'INVALID'})
  assert.throws(()=>insertText(source,3,'Text',{panel:1}),{code:'INVALID'})
  assert.throws(()=>insertText('# No panel\n',1,'Text',{panel:1}),{code:'INVALID'})
  assert.throws(()=>insertShape(source,1,'rect',{panel:1}),{code:'INVALID'})
  for(const kind of [undefined,'shape'])await assert.rejects(store.insert({hash:initial.hash,slide:1,kind,shape:'rect',panel:1}),{code:'INVALID'})
  assert.equal(await readFile(file,'utf8'),source)
  assert.deepEqual((await store.read()).history,{canUndo:false,canRedo:false})
})

test('panel text insertion is one guarded undo operation',async t=>{
  const original=source.replaceAll('\n','\r\n')
  const {store,initial}=await fixture(t,original)
  const inserted=await store.insert({hash:initial.hash,slide:1,kind:'box',content:'Panel text',panel:2})
  assert.deepEqual(objectAndParents(inserted.source,inserted.selectedId).parents.map(item=>item.id),['right'])
  await assert.rejects(store.insert({hash:initial.hash,slide:1,kind:'box',panel:1}),{code:'CONFLICT'})
  const undone=await store.undo({hash:inserted.hash})
  assert.equal(undone.source,original)
  assert.equal(undone.history.canUndo,false)
  assert.equal((await store.redo({hash:undone.hash})).source,inserted.source)
})

test('panel image import keeps natural flow, immutable assets, CRLF and exact undo',async t=>{
  for(const eol of ['\n','\r\n']) {
    const original=source.replaceAll('\n',eol)
    const {dir,store,initial}=await fixture(t,original)
    const inserted=await importImage(store,{hash:initial.hash,slide:1,panel:2,...image})
    const {object,parents}=objectAndParents(inserted.source,inserted.selectedId)
    assert.deepEqual(parents.map(item=>item.id),['right'])
    assertFlow(object)
    if(eol==='\r\n')assert.doesNotMatch(inserted.source,/(?<!\r)\n/)
    const asset=join(dir,`figures/imported/${hashSource(svg)}.svg`)
    assert.deepEqual(await readFile(asset),svg)
    const undone=await store.undo({hash:inserted.hash})
    assert.equal(undone.source,original)
    assert.equal(undone.history.canUndo,false)
    assert.deepEqual(await readFile(asset),svg)
    assert.equal((await store.redo({hash:undone.hash})).source,inserted.source)
  }
})

test('invalid image panel targets create no assets and no source or history edits',async t=>{
  const {dir,file,store,initial}=await fixture(t)
  for(const panel of [0,-1,1.5,'1',true,{},[],3])await assert.rejects(importImage(store,{hash:initial.hash,slide:1,panel,...image}),{code:'INVALID'})
  await assert.rejects(importImage(store,{hash:initial.hash,slide:2,panel:2,...image}),{code:'INVALID'})
  await assert.rejects(importImage(store,{hash:initial.hash,slide:3,panel:1,...image}),{code:'INVALID'})
  assert.deepEqual(await readdir(dir),['deck.md'])
  assert.equal(await readFile(file,'utf8'),source)
  assert.deepEqual((await store.read()).history,{canUndo:false,canRedo:false})
  const external=source+'\nOutside change\n'
  await writeFile(file,external)
  await assert.rejects(importImage(store,{hash:initial.hash,slide:1,panel:1,...image}),{code:'CONFLICT'})
  assert.deepEqual(await readdir(dir),['deck.md'])
  assert.equal(await readFile(file,'utf8'),external)
})

test('explicit null image panel preserves free placement',async t=>{
  const {store,initial}=await fixture(t)
  const inserted=await importImage(store,{hash:initial.hash,slide:1,panel:null,...image})
  const {object,parents}=objectAndParents(inserted.source,inserted.selectedId)
  assert.deepEqual(parents,[])
  assert.match(inserted.source,new RegExp(`id=${object.id} position=absolute dx=390 dy=260 width=500`))
})

test('HTTP deck responses advertise panel insertion and route text/image panel requests',async t=>{
  const {file}=await fixture(t)
  const app=await createDraftServer({file,port:0,renderer:async file=>{
    const source=await readFile(file,'utf8')
    return {source,hash:hashSource(source),html:'',css:'',diagnostics:[]}
  }})
  t.after(()=>app.close())
  const initial=await (await fetch(app.url+'/api/deck')).json()
  assert.equal(initial.capabilities?.panelInsertion,true)
  const html=await (await fetch(app.url)).text()
  const token=/name="editor-token" content="([^"]+)"/.exec(html)[1]
  const headers={'Content-Type':'application/json',Origin:app.url,'X-Editor-Token':token}
  const post=async(path,body)=>fetch(app.url+path,{method:'POST',headers,body:JSON.stringify(body)})
  const textResponse=await post('/api/insert',{hash:initial.hash,slide:1,kind:'box',content:'API text',panel:2})
  assert.equal(textResponse.status,200)
  const inserted=await textResponse.json()
  assert.equal(inserted.capabilities.panelInsertion,true)
  assert.deepEqual(objectAndParents(inserted.source,inserted.selectedId).parents.map(item=>item.id),['right'])
  const imageResponse=await post('/api/image',{hash:inserted.hash,slide:2,panel:1,...image})
  assert.equal(imageResponse.status,200)
  const imported=await imageResponse.json()
  assert.equal(imported.capabilities.panelInsertion,true)
  assert.deepEqual(objectAndParents(imported.source,imported.selectedId).parents.map(item=>item.id),['second'])
  const invalid=await post('/api/insert',{hash:imported.hash,slide:1,kind:'shape',shape:'rect',panel:1})
  assert.equal(invalid.status,400)
  assert.equal(await readFile(file,'utf8'),imported.source)
})
