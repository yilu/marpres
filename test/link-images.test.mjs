import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {exportHTML} from '../scripts/html-export.mjs'

test('linked export encodes original relative paths without copying image bytes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'marpres-linked-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const name='图 plot 50% #&.svg',file=join(dir,'slides.md'),output=join(dir,'dist','linked.html')
 const bytes='<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"/>'
 await writeFile(join(dir,name),bytes)
 await writeFile(file,`---\nmarp: true\n---\n![plot](${encodeURIComponent(name)})`)
 const {deck}=await exportHTML(file,{output,linkImages:true})
 assert.deepEqual(deck.diagnostics,[])
 assert.ok((await readFile(output,'utf8')).includes(`src="../${encodeURIComponent(name)}"`))
 assert.deepEqual(await readdir(join(dir,'dist')),['linked.html'])
 assert.equal(await readFile(join(dir,name),'utf8'),bytes)
 await assert.rejects(exportHTML(file,{output,linkImages:true,embedImages:true}),/cannot.*together/i)
})
