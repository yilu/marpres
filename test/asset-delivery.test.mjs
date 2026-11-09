import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {renderFile,documentHTML} from '../scripts/render.mjs'
import {createDraftServer} from '../editor/server.mjs'
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000" fill="red"/></svg>'
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'marpres-assets-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'slides.md');await writeFile(join(dir,'plot.svg'),svg);await writeFile(file,'---\nmarp: true\ntheme: nju-unofficial-v2\n---\n# Assets\n\n![one](plot.svg)\n![two](plot.svg)\n');return {dir,file}}
test('editor serves unchanged full image bytes once through immutable cached URLs and refreshes asset edits',async t=>{const {dir,file}=await fixture(t);const app=await createDraftServer({file,port:0});t.after(()=>app.close());let deck=await (await fetch(app.url+'/api/deck')).json();assert.doesNotMatch(deck.html,/<img[^>]+src="data:image/);const src=deck.html.match(/<img[^>]+src="([^"]+)"/)[1];assert.ok(src.startsWith('/api/assets/'));let response=await fetch(app.url+src);assert.equal(await response.text(),svg);assert.match(response.headers.get('cache-control'),/immutable/);const changed=svg.replace('red','blue');await writeFile(join(dir,'plot.svg'),changed);deck=await (await fetch(app.url+'/api/deck')).json();assert.ok(!deck.html.includes(src));assert.equal(await (await fetch(app.url+src)).text(),svg,'old URLs retain their original bytes');const page=await (await fetch(app.url)).text();const token=page.match(/name="editor-token" content="([^"]+)"/)?.[1]||page.match(/content="([^"]+)" name="editor-token"/)?.[1];assert.ok(token);response=await fetch(app.url+'/api/notes',{method:'POST',headers:{'Content-Type':'application/json','Origin':app.url,'X-Editor-Token':token},body:JSON.stringify({hash:deck.hash,slide:1,notes:'Test notes'})});assert.equal(response.status,200);assert.doesNotMatch((await response.json()).html,/<img[^>]+src="data:image/);});
test('presenter snapshots keep embedded image bytes after local asset changes',async t=>{
 const {file,dir}=await fixture(t)
 const {SourceStore}=await import('../editor/source-store.mjs')
 const {PresentationStore}=await import('../editor/presentation-store.mjs')
 const store=new SourceStore(file),presentations=new PresentationStore(store)
 const session=await presentations.create({hash:(await store.read()).hash})
 const before=presentations.get(session.id,'audience')
 await writeFile(join(dir,'plot.svg'),svg.replace('red','blue'))
 const after=presentations.get(session.id,'audience')
 assert.equal(after.html,before.html)
 assert.ok(after.html.includes(Buffer.from(svg).toString('base64')))
 assert.doesNotMatch(after.html,/\/api\/assets\//)
})
test('portable HTML includes repeated full resolution payload once',async t=>{const {file}=await fixture(t);const deck=await renderFile(file);assert.equal(deck.html.split('data:image/svg+xml;base64,').length-1,2);const html=documentHTML(deck);assert.equal(html.split(Buffer.from(svg).toString('base64')).length-1,1);});
test('directory export shares byte-identical content-addressed files and supports single-file mode',async t=>{const {file,dir}=await fixture(t);const {exportHTML}=await import('../scripts/html-export.mjs');const {readFile,readdir}=await import('node:fs/promises');const output=join(dir,'dist','slides.html');await exportHTML(file,{output});const html=await readFile(output,'utf8');assert.match(html,/<img src="assets\/[a-f0-9]+\.svg"/);const assets=await readdir(join(dir,'dist','assets'));assert.equal(assets.length,1);assert.equal(await readFile(join(dir,'dist','assets',assets[0]),'utf8'),svg);await exportHTML(file,{output:join(dir,'dist','portable.html'),embedImages:true});const portable=await readFile(join(dir,'dist','portable.html'),'utf8');assert.ok(portable.includes(Buffer.from(svg).toString('base64')));assert.doesNotMatch(portable,/<img src="assets\//);});
