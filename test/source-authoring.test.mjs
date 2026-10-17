import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {normalizeEditPatch} from '../engine/edit-options.mjs'
import {patchSource,scanEditable,replaceContent,insertShape,deleteShape,insertText,deleteObject,SourceStore} from '../editor/source-store.mjs'
const text='---\r\nmarp: true\r\ntheme: nju-unofficial-v2\r\n---\r\n# First\r\n\r\n:::: panel id=p\r\n::: box id=words custom="keep me"\r\nOriginal **text**.\r\n:::\r\n::::\r\n\r\n---\r\n\r\n# Second\r\n'
test('font/style/stage options are typed, safely quoted and limited by kind',()=>{
 const patch={font_family:'Times New Roman, Songti SC, serif',bold:true,italic:false,underline:true,strike:true,color:'#abc',align:'center',stage:2}
 assert.equal(normalizeEditPatch(patch,'box').color,'#aabbcc')
 const changed=patchSource(text,'words',patch)
 assert.match(changed,/font_family="Times New Roman, Songti SC, serif"/)
 assert.match(changed,/bold=true/);assert.match(changed,/stage=2/);assert.ok(changed.includes('custom="keep me"'))
 assert.match(patchSource(changed,'words',{font_family:null,bold:null}),/id=words custom="keep me"/)
 for(const bad of [{font_family:'Arial; color:red'},{stage:1.5},{stage:-1},{bold:'true'},{stroke:'url(x)'},{color:'red;display:none'}])assert.throws(()=>normalizeEditPatch(bad,'box'))
 assert.throws(()=>normalizeEditPatch({font_family:'Arial'},'figure'))
})
test('leaf content replacement preserves enclosing source and CRLF; nesting cannot be flattened',()=>{
 const changed=replaceContent(text,'words','New *text* and <u>underline</u>.')
 assert.ok(changed.includes('custom="keep me"\r\nNew *text* and <u>underline</u>.\r\n'))
 assert.ok(changed.endsWith('---\r\n\r\n# Second\r\n'))
 assert.throws(()=>replaceContent(text,'words','Escape\n:::\n# Outside'))
 assert.throws(()=>replaceContent(text,'words','A\n\n---\n\nB'))
 const nested=':::: box id=outer\nText\n::: box id=inner\nInner\n:::\n::::\n'
 assert.equal(scanEditable(nested).find(o=>o.id==='outer').contentEditable,false)
 assert.throws(()=>replaceContent(nested,'outer','Flatten'))
 const safe=replaceContent(text,'words','```text\n::: box id=fake\n---\n```')
 assert.equal(scanEditable(safe).filter(o=>o.id==='fake').length,0)
})
test('shape insertion uses actual slide boundaries and deletion is exact apart from the inserted block',()=>{
 const {source,id}=insertShape(text,2,'arrow',{id:'new-arrow'})
 assert.ok(source.indexOf('shape id=new-arrow')>source.indexOf('# Second'))
 assert.equal(scanEditable(source).find(o=>o.id===id).slide,2)
 assert.ok(deleteShape(source,id).startsWith(text))
 assert.throws(()=>insertShape(text,3,'line'))
 assert.throws(()=>deleteShape(text,'words'))
 const tricky='# A\n\n```md\n---\n```\n\n<!--\n---\n-->\n\n---\n\n# B\n'
 const added=insertShape(tricky,2,'rect',{id:'r'}).source
 assert.ok(added.indexOf('shape id=r')>added.indexOf('# B'))
})
test('content, insertion and deletion share hash-guarded exact undo/redo',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'authoring-store-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const file=join(dir,'deck.md');await writeFile(file,text)
 const store=new SourceStore(file);const a=await store.read()
 const b=await store.content({hash:a.hash,id:'words',content:'Edited'})
 await assert.rejects(store.insert({hash:a.hash,slide:1,shape:'line'}),{code:'CONFLICT'})
 const c=await store.insert({hash:b.hash,slide:1,shape:'line'})
 assert.ok(c.selectedId)
 const d=await store.delete({hash:c.hash,id:c.selectedId})
 const e=await store.undo({hash:d.hash});assert.equal(e.source,c.source)
 const f=await store.undo({hash:e.hash});assert.equal(f.source,b.source)
 const g=await store.undo({hash:f.hash});assert.equal(g.source,text)
 assert.equal(await readFile(file,'utf8'),text)
})


test('inserted text is independent, editable and undoable without touching other slides',async t=>{
 const inserted=insertText(text,1,'New **text**',{id:'new-text'})
 const object=scanEditable(inserted.source).find(o=>o.id===inserted.id)
 assert.equal(object.slide,1);assert.equal(object.contentEditable,true)
 assert.match(inserted.source,/id=new-text position=absolute dx=480 dy=280 width=360/)
 assert.ok(inserted.source.indexOf('id=new-text')<inserted.source.indexOf('# Second'))
 assert.equal(object.content,'New **text**')
 assert.ok(deleteObject(inserted.source,inserted.id).endsWith('# Second\r\n'))
 const dir=await mkdtemp(join(tmpdir(),'authoring-text-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const file=join(dir,'deck.md');await writeFile(file,text);const store=new SourceStore(file)
 const a=await store.read();const b=await store.insert({hash:a.hash,slide:2,kind:'box',content:'New words'})
 const c=await store.content({hash:b.hash,id:b.selectedId,content:'Edited words'})
 const d=await store.delete({hash:c.hash,id:b.selectedId})
 const e=await store.undo({hash:d.hash});assert.equal(e.source,c.source)
 const f=await store.undo({hash:e.hash});assert.equal(f.source,b.source)
 const g=await store.undo({hash:f.hash});assert.equal(g.source,text)
})

test('text saves reject setext separators that would escape the layout preprocessor',()=>{
 const source='::: box id=x\nOld\n:::\n\n---\n# Second\n'
 assert.throws(()=>replaceContent(source,'x','A\n---\nB'),/separator|structure|fence/i)
 assert.throws(()=>insertText(source,1,'A\n---\nB'),/separator|structure|fence/i)
})
test('slide mapping follows container-aware separators even without blank lines',()=>{
 const source='# A\n::: box id=a\nA\n:::\n---\n# B\n::: box id=b\nB\n:::\n'
 assert.equal(scanEditable(source).find(o=>o.id==='b').slide,2)
 const added=insertShape(source,2,'line',{id:'new-line'}).source
 assert.ok(added.indexOf('id=new-line')>added.indexOf('# B'))
 const setext='# A\n\nA subtitle\n---\n\n::: box id=a\nContent\n:::\n'
 assert.throws(()=>insertShape(setext,2,'line'))
})
