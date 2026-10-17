import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceStore } from '../editor/source-store.mjs'
import { exportDeckPDF } from '../scripts/export.mjs'

const dir=await mkdtemp(join(tmpdir(),'marp-gui-export-'))
const file=join(dir,'presentation.md')
const source='---\nmarp: true\ntheme: nju-unofficial-v2\n---\n# Reveal\n\n::: box id=one stage=2\nSecond stage.\n:::\n\n::: box id=two stage=5\nThird stage.\n:::\n\n---\n# Last\n'
let server
try {
  await writeFile(file,source)
  const store=new SourceStore(file)
  const initial=await store.read()
  await assert.rejects(exportDeckPDF(store,{hash:'stale'}),{code:'CONFLICT'})
  const result=await exportDeckPDF(store,{hash:initial.hash})
  assert.equal(result.filename,'presentation.pdf')
  assert.equal(result.buffer.subarray(0,5).toString(),'%PDF-')
  assert.equal((result.buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,4)
  const boxes=[...result.buffer.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
  assert.equal(boxes.length,4)
  assert.ok(boxes.every(box=>Math.abs(Number(box[1])/Number(box[2])-16/9)<0.001),'Each PDF page must be 16:9')
  assert.equal(await readFile(file,'utf8'),source)
  assert.deepEqual((await store.read()).history,{canUndo:false,canRedo:false})
  assert.deepEqual(await readdir(dir),['presentation.md'],'Export must leave no temporary files')

  await writeFile(file,source+'\n::: figure id=missing\n![missing](does-not-exist.png)\n:::\n')
  await assert.rejects(exportDeckPDF(store,{hash:(await store.read()).hash}),{code:'INVALID'})

  let requested=false
  server=createServer(async(request,response)=>{
    requested=true
    await writeFile(file,'# External edit during export\n')
    response.writeHead(200,{'Content-Type':'image/svg+xml'})
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const port=server.address().port
  await writeFile(file,source+`\n![Wait for external edit](http://127.0.0.1:${port}/image.svg)\n`)
  await assert.rejects(exportDeckPDF(store,{hash:(await store.read()).hash}),{code:'CONFLICT'})
  assert.equal(requested,true)
  assert.equal(await readFile(file,'utf8'),'# External edit during export\n')
  console.log('GUI media export checks passed: guarded PDF download, four cumulative stage pages, 16:9 size, no source/history writes, missing assets, and conflict during render.')
} finally {
  if(server)await new Promise(resolve=>server.close(resolve))
  await rm(dir,{recursive:true,force:true})
}
