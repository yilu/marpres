import test from 'node:test'
import assert from 'node:assert/strict'
import { Marp } from '@marp-team/marp-core'
import layout from '../engine/layout.mjs'
import { fileURLToPath } from 'node:url'
const baseDir = fileURLToPath(new URL('./fixtures/', import.meta.url))
function render(source) {
  const diagnostics=[]
  const marp=new Marp({html:true}).use(layout,{baseDir,onDiagnostic:d=>diagnostics.push(d)})
  return {...marp.render(source),diagnostics}
}
test('v2 gives panels real body/caption/ref regions and stable semantic placement',()=>{
 const {html}=render('# Title\n<!-- _layout: cols 1 1 -->\n::: col\n![w:200](wide.svg)\n\n- Below image\n::: caption\nCaption\n:::\n:::\n\nBetween panels\n\n::: panel\nRight\n:::\n')
 assert.equal((html.match(/class="panel"/g)||[]).length,2)
 assert.match(html,/class="panel-body"/)
 assert.match(html,/class="panel-caption"/)
 assert.match(html,/data-panel-index="2"[^>]*grid-column:2 \/ 3/)
 assert.doesNotMatch(html,/<p>:::<\/p>/)
})
test('named and spaced positional spans agree, out of bounds is diagnosed',()=>{
 for(const args of ['2, 1','row=2 col=1']) {
 const {html,diagnostics}=render(`# T\n<!-- _layout: grid 2x2 -->\n::: panel ${args}\nBody\n:::`)
 assert.match(html,/grid-row:2 \/ 3/);assert.equal(diagnostics.length,0)
 }
 assert.ok(render('# T\n<!-- _layout: grid 2x2 -->\n::: panel row=3 col=1\nBad\n:::').diagnostics.some(d=>d.code==='panel-placement'))
})
test('crop uses intrinsic dimensions, marks the visible frame and rejects invalid crops',()=>{
 const {html,diagnostics}=render('# Crop\n::: figure id=crop width=300 crop=10,20,60,50\n![](wide.svg)\n:::')
 assert.equal(diagnostics.length,0)
 assert.match(html,/class="figure-frame editable-object"/)
 assert.match(html,/--crop-ratio:3/)
 assert.match(html,/width:300px/)
 assert.match(html,/data-edit-kind="figure"/)
 assert.ok(render('# Crop\n::: figure id=crop crop=80,0,40,100\n![](wide.svg)\n:::').diagnostics.some(d=>d.code==='invalid-crop'))
})
test('headings and footer occupy explicit independent flow regions',()=>{
 const {html}=render('# Title\n\n## Subtitle\n\nBody\n\n::: footer\nCitation\n:::')
 assert.match(html,/<header class="deck-heading"><h1[\s\S]*<h2[\s\S]*<\/header>/)
 assert.match(html,/<main class="deck-content">/)
 assert.match(html,/<footer class="deck-footer">/)
})
test('duplicate IDs are diagnosed, code fences never become layout objects',()=>{
 const {html,diagnostics}=render('::: box id=a\nA\n:::\n::: box id=a\nB\n:::\n\n```text\n::: box id=fake\n```')
 assert.ok(diagnostics.some(d=>d.code==='duplicate-id'))
 assert.doesNotMatch(html,/data-edit-id="fake"/)
})

test('spaced options render and source edits keep the same identity and syntax', async()=>{
 const {patchSource}=await import('../editor/source-store.mjs')
 const source='::: box id = "demo" width  =  "200"\nText\n:::\n'
 const changed=patchSource(source,'demo',{width:250})
 assert.equal(changed,source.replace('"200"','"250"'))
 const {html,diagnostics}=render(changed)
 assert.equal(diagnostics.length,0)
 assert.match(html,/data-edit-id="demo"/)
 assert.match(html,/width:250px/)
})
