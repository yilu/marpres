import test from 'node:test'
import assert from 'node:assert/strict'
import { Marp } from '@marp-team/marp-core'
import layout from '../engine/layout.mjs'

function render(source) {
  const diagnostics=[]
  const marp=new Marp({html:true,inlineSVG:true}).use(layout,{onDiagnostic:d=>diagnostics.push(d)})
  return {...marp.render(source),diagnostics}
}
const options = (html,id) => JSON.parse(html.match(new RegExp(`data-edit-id="${id}"[^>]*data-edit-options="([^"]*)"`))[1].replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&'))

test('text rendering keeps explicit typed styles and leaves inherited values absent',()=>{
  const {html,diagnostics}=render('::: box id=styled font=31 font_family="Georgia, serif" bold=true italic=false underline=true strike=true color=#123456 align=right stage=2\nStyle **content**\n:::\n::: caption id=inherited\nCaption\n:::')
  assert.deepEqual(diagnostics,[])
  assert.deepEqual(options(html,'styled'),{id:'styled',font:31,font_family:'Georgia, serif',bold:true,italic:false,underline:true,strike:true,color:'#123456',align:'right',stage:2})
  assert.deepEqual(options(html,'inherited'),{id:'inherited'})
  assert.match(html,/font-family:&quot;Georgia&quot;, serif/)
  assert.match(html,/font-weight:700/)
  assert.match(html,/font-style:normal/)
  assert.match(html,/text-decoration-line:underline line-through/)
  assert.match(html,/color:#123456/)
  assert.match(html,/text-align:right/)
  assert.match(html,/data-stages="0,2"/)
})

test('all authored containers can carry stages, and slide metadata maps insertion lines',()=>{
  const source='---\nmarp: true\n---\n# First\n::: panel stage=3\n::: box id=a stage=1\nA\n:::\n:::\n::: footer stage=4\nFooter\n:::\n\n---\n# Second\n'
  const {html,diagnostics}=render(source)
  assert.deepEqual(diagnostics,[])
  assert.match(html,/<section[^>]*data-source-slide="1"[^>]*data-source-end-line="14"/)
  assert.match(html,/<section[^>]*data-source-slide="2"[^>]*data-source-end-line="16"/)
  assert.match(html,/class="panel"[^>]*data-stage="3"/)
  assert.match(html,/class="layout-footer"[^>]*data-stage="4"/)
  assert.match(html,/data-stages="0,1,3,4"/)
})

test('shapes render as slide-positioned SVG frames with typed metadata',()=>{
  for(const shape of ['line','arrow','rect','ellipse']) {
    const {html,diagnostics}=render(`# Diagram\n::: shape id=shape shape=${shape} dx=125 dy=260 width=240 height=90 rotate=25 stroke=#7a005f stroke_width=3 fill=none stage=2\n:::`)
    assert.deepEqual(diagnostics,[])
    assert.match(html,/class="shape-frame editable-object"/)
    assert.match(html,/data-edit-kind="shape"/)
    assert.match(html,/transform:translate\(125px,260px\) rotate\(25deg\)/)
    assert.match(html,/vector-effect="non-scaling-stroke"/)
    assert.equal(options(html,'shape').shape,shape)
    assert.equal(options(html,'shape').rotate,25)
    assert.equal(options(html,'shape').stroke_width,3)
  }
})

test('invalid authoring values are diagnosed without injecting CSS or invalid shape markup',()=>{
  const {html,diagnostics}=render('::: box id=bad font_family="Arial;position:absolute" bold=perhaps stage=-1\nBad\n:::\n::: shape id=badshape shape=polygon\nUnexpected body\n:::')
  assert.ok(diagnostics.some(d=>d.code==='invalid-option'))
  assert.ok(diagnostics.some(d=>d.code==='shape-content'))
  assert.doesNotMatch(html,/font-family:Arial;position/)
  assert.doesNotMatch(html,/data-stage="-1"/)
})

test('inserted text can be slide-positioned while normal text remains in flow',()=>{
  const {html,diagnostics}=render('::: box id=absolute position=absolute dx=480 dy=280 width=360\nInserted text.\n:::\n::: box id=flow\nFlow text.\n:::')
  assert.deepEqual(diagnostics,[])
  assert.equal(options(html,'absolute').position,'absolute')
  assert.equal(options(html,'flow').position,undefined)
  assert.match(html,/data-edit-id="absolute"[^>]*style="[^"]*position:absolute;left:0;top:0/)
})

test('shape defaults identify the shape type, and invalid stage values are excluded from slide stages',()=>{
  const {html,diagnostics}=render('::: shape id=default\n:::\n::: box id=invalid stage=100\nText\n:::')
  assert.ok(diagnostics.some(d=>d.code==='invalid-option'))
  assert.equal(options(html,'default').shape,'rect')
  assert.match(html,/data-stages="0"/)
})


test('font names containing numeric tokens are quoted as CSS family strings',()=>{
 const {html,diagnostics}=render('::: box id=numeric font_family="DIN 2014, serif"\nFont sample\n:::')
 assert.deepEqual(diagnostics,[])
 assert.match(html,/font-family:&quot;DIN 2014&quot;, serif/)
 assert.equal(options(html,'numeric').font_family,'DIN 2014, serif')
})

test('absolute figures inherit their original panel reveal stage after hoisting',()=>{
 const {html,diagnostics}=render(':::: panel stage=3\n::: figure id=pic position=absolute width=200\n![](test/fixtures/wide.svg)\n:::\n::::\n')
 assert.deepEqual(diagnostics,[])
 assert.match(html,/data-edit-id="pic"[^>]*data-stage="3"/)
})
