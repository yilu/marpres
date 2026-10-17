import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SourceStore,mapSource,changeSlide,patchBatch} from '../editor/source-store.mjs'
import {applyDeckDesign,getDeckDesign,findDeckDesignBlock} from '../editor/theme-store.mjs'
const source='---\nmarp: true\ntheme: nju-unofficial-v2\n---\n\n# First\n\n::: box id=a\nA\n:::\n\n---\n\n# Second\n\n::: box id=b\nB\n:::\n'
test('slide operations preserve the single frontmatter and unique editable identities',()=>{
 assert.deepEqual(mapSource(source).slides.map(s=>s.title),['First','Second'])
 const added=changeSlide(source,'add',1,{title:'Middle'});assert.equal(added.selectedSlide,2)
 assert.deepEqual(mapSource(added.source).slides.map(s=>s.title),['First','Middle','Second'])
 const dup=changeSlide(source,'duplicate',1);const ids=mapSource(dup.source).objects.map(o=>o.id)
 assert.equal(new Set(ids).size,3);assert.equal((dup.source.match(/theme: nju-unofficial-v2/g)||[]).length,1)
 const moved=changeSlide(source,'move-up',2);assert.deepEqual(mapSource(moved.source).slides.map(s=>s.title),['Second','First'])
 assert.ok(moved.source.startsWith('---\nmarp: true\ntheme: nju-unofficial-v2\n---'))
 const renamed=changeSlide(source,'rename',2,{title:'A new title'});assert.equal(mapSource(renamed.source).slides[1].title,'A new title')
 const removed=changeSlide(source,'delete',1);assert.deepEqual(mapSource(removed.source).slides.map(s=>s.title),['Second'])
 assert.throws(()=>changeSlide(removed.source,'delete',1),/last slide/i)
})
test('batch alignment is all-or-nothing and one undo transaction',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'gui-batch-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const file=join(dir,'slides.md');await writeFile(file,source);const store=new SourceStore(file)
 const initial=await store.read()
 await assert.rejects(store.batch({hash:initial.hash,edits:[{id:'a',patch:{dx:20}},{id:'missing',patch:{dx:30}}]}))
 assert.equal((await store.read()).source,source)
 const changed=await store.batch({hash:initial.hash,edits:[{id:'a',patch:{dx:20,dy:50}},{id:'b',patch:{dx:30,dy:50}}]})
 assert.match(changed.source,/id=a dx=20 dy=50/);assert.match(changed.source,/id=b dx=30 dy=50/)
 assert.equal((await store.undo({hash:changed.hash})).source,source)
 assert.throws(()=>patchBatch(source,[{id:'a',patch:{dx:1}},{id:'a',patch:{dx:2}}]),/duplicate/i)
})


test('shared deck CSS remains outside slide duplication, deletion and reordering',()=>{
 const design='<!-- marp-v2-design:begin -->\n<style>section { --deck-title-size:52px; }</style>\n<!-- marp-v2-design:end -->\n'
 const withTheme=source.replace('# First',design+'\n# First')
 for(const [action,slide] of [['duplicate',1],['delete',1],['move-down',1]]) {
  const changed=changeSlide(withTheme,action,slide).source
  assert.equal((changed.match(/marp-v2-design:begin/g)||[]).length,1)
  assert.ok(changed.indexOf('marp-v2-design:end')<changed.indexOf('# '))
 }
 const noHeading=design+'\nParagraph only\n'
 const renamed=changeSlide(noHeading,'rename',1,{title:'Title'}).source
 assert.ok(renamed.indexOf('marp-v2-design:end')<renamed.indexOf('# Title'))
})

test('renaming a YAML-only deck inserts the title after closing frontmatter at EOF',()=>{
 for(const eol of ['\n','\r\n']) {
  const source=['---','marp: true','---'].join(eol)
  const changed=changeSlide(source,'rename',1,{title:'中文标题'}).source
  assert.ok(changed.startsWith(source+eol))
  assert.equal(mapSource(changed).slides[0].title,'中文标题')
 }
})

test('slide operations preserve a managed theme after comments or inside a later slide',()=>{
 for(const eol of ['\n','\r\n']) {
  const original=source.replaceAll('\n',eol)
  const themed=applyDeckDesign(original,{theme:{body_size:33},css:'section .custom { color:#123456; }'})
  const range=findDeckDesignBlock(themed),block=themed.slice(range.start,range.end)
  const variants=[themed.replace('<!-- marp-v2-design:begin -->','<!-- Before -->'+eol+'<!-- marp-v2-design:begin -->'),original.replace('# Second',block+'# Second')]
  for(const input of variants)for(const [action,slide] of [['duplicate',1],['duplicate',2],['delete',1],['delete',2],['move-down',1],['add',1]]) {
   const changed=changeSlide(input,action,slide).source
   assert.deepEqual(getDeckDesign(changed),getDeckDesign(input),`${action} slide ${slide}`)
   assert.equal((changed.match(/marp-v2-design:begin/g)||[]).length,1)
   if(eol==='\r\n')assert.doesNotMatch(changed,/(?<!\r)\n/)
  }
 }
})
