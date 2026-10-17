import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-chromium'

const server = createServer(async (request, response) => {
  if (['/presenter/overlay.js', '/presenter/geometry.mjs'].includes(request.url)) {
    try {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(await readFile(new URL(`..${request.url}`, import.meta.url)))
    } catch { response.writeHead(404).end() }
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><style>body{margin:0;padding:20px}#host{position:relative;width:640px;height:360px;background:#fff;box-shadow:0 0 0 1px #aaa}</style><div id="host"><div id="slide">Slide content</div></div><button id="outside">Outside control</button><script type="module">
    import { createOverlay } from '/presenter/overlay.js';
    window.actions = []; window.sync = true;
    window.state = { tool:'arrow',color:'#ef4444',width:4,pointer:null,strokes:[],drawing:null,blank:false };
    window.overlay = createOverlay({host:document.querySelector('#host'),onAction(action){
      actions.push(structuredClone(action));
      if (!sync) return;
      if(action.type==='pointer') state.pointer=action.point;
      if(action.type==='drawing') state.drawing=action.stroke;
      if(action.type==='stroke'){ state.strokes=[...state.strokes,action.stroke];state.drawing=null; }
      overlay.update(state);
    }});
    overlay.update(state);
    window.configure = patch => {Object.assign(state,patch);overlay.update(state)};
    window.outsideClicks=0;document.querySelector('#outside').onclick=()=>outsideClicks++;
  </script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => Boolean(window.overlay))
  const host = page.locator('#host')
  const svg = page.locator('[data-presenter-overlay]')
  assert.equal(await svg.count(), 1)
  assert.equal(await page.locator('#slide').textContent(), 'Slide content')

  for (const width of [320, 640, 1280]) {
    await host.evaluate((element, width) => { element.style.width=`${width}px`;element.style.height=`${width*9/16}px` }, width)
    await page.evaluate(() => { configure({ tool:'pen',strokes:[],drawing:null,pointer:null });actions.length=0 })
    const box = await host.boundingBox()
    await page.mouse.move(box.x + width / 4, box.y + box.height / 4)
    await page.mouse.down()
    await page.mouse.move(box.x + width / 2, box.y + box.height / 2, { steps: 4 })
    assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 1, 'Local drawing survives synchronous state echoes')
    await page.mouse.up()
    const strokes = await page.evaluate(() => actions.filter(action => action.type === 'stroke'))
    assert.equal(strokes.length, 1)
    assert.deepEqual(strokes[0].stroke.points[0], [320, 180])
    assert.deepEqual(strokes[0].stroke.points.at(-1), [640, 360])
    assert.equal(await svg.locator('[data-layer="strokes"] path').count(), 1)
    assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 0)
  }

  await host.evaluate(element => { element.style.width='640px';element.style.height='360px' })
  const box = await host.boundingBox()
  const at = (x, y) => [box.x + x / 2, box.y + y / 2]
  await page.evaluate(() => { configure({ tool:'highlighter',width:24,strokes:[],drawing:null });actions.length=0 })
  await page.mouse.click(...at(100, 100))
  assert.equal(await page.evaluate(() => actions.find(action => action.type==='stroke').stroke.tool), 'highlighter')
  assert.equal(await svg.locator('[data-layer="strokes"] path').getAttribute('stroke-opacity'), '0.3')
  assert.ok(Number(await svg.locator('[data-layer="strokes"] path').evaluate(path => path.getTotalLength())) > 0, 'Single-point taps must visibly render')

  await page.evaluate(() => { configure({tool:'pen',width:4,strokes:[],drawing:null});actions.length=0 })
  await page.mouse.move(...at(100,100)); await page.mouse.down()
  for (let batch = 0; batch < 2; batch++) {
    await svg.evaluate((element, batch) => {
      const rect = element.getBoundingClientRect()
      const samples = Array.from({length:4300}, (_, offset) => {
        const index = batch * 4300 + offset + 1
        return {clientX:rect.left + (100 + (index * .15) % 1000) * rect.width / 1280,clientY:rect.top + (200 + Math.sin(index / 40) * 100) * rect.height / 720}
      })
      const event = new PointerEvent('pointermove', {pointerId:1,isPrimary:true,buttons:1,bubbles:true,...samples.at(-1)})
      Object.defineProperty(event, 'getCoalescedEvents', {value:() => samples})
      element.dispatchEvent(event)
    }, batch)
  }
  await page.mouse.move(...at(900,600)); await page.mouse.up()
  const longStroke = await page.evaluate(() => actions.filter(action => action.type==='stroke'))
  assert.equal(longStroke.length, 1)
  assert.ok(longStroke[0].stroke.points.length <= 4096, 'Long strokes remain within the controller point limit')
  assert.deepEqual(longStroke[0].stroke.points[0], [100,100], 'Decimation retains the original starting point')
  assert.deepEqual(longStroke[0].stroke.points.at(-1), [900,600], 'Drawing continues to the newest endpoint after decimation')
  assert.equal(await page.evaluate(() => actions.filter(action => action.type==='drawing' && action.stroke).every(action => action.stroke.points.length <= 4096)), true, 'Live drawing messages also stay bounded')
  const longPath = await svg.locator('[data-layer="strokes"] path').evaluate(path => {
    const length = path.getTotalLength(), start = path.getPointAtLength(0), end = path.getPointAtLength(length)
    return {length,start:[start.x,start.y],end:[end.x,end.y]}
  })
  assert.ok(Number.isFinite(longPath.length) && longPath.length > 0, 'The decimated SVG remains a valid visible path')
  assert.deepEqual(longPath.start, [100,100])
  assert.deepEqual(longPath.end, [900,600])

  await page.evaluate(() => { configure({ tool:'pen',drawing:null });actions.length=0 })
  await page.mouse.move(...at(100, 100))
  await page.mouse.down()
  await page.mouse.move(...at(200, 200))
  await svg.evaluate(element => element.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})))
  await page.mouse.up()
  assert.equal(await page.evaluate(() => actions.filter(action => action.type==='stroke').length), 0, 'Canceled strokes never commit')
  assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 0)
  assert.equal(await page.evaluate(() => actions.filter(action => action.type==='drawing').at(-1).stroke), null)

  await page.evaluate(() => { configure({ tool:'pen',drawing:null });actions.length=0 })
  await page.mouse.move(...at(100, 100))
  await page.mouse.down()
  await page.mouse.move(...at(200, 200))
  await page.evaluate(() => configure({ tool:'laser',drawing:null }))
  await page.mouse.up()
  assert.equal(await page.evaluate(() => actions.filter(action => action.type==='stroke').length), 0, 'Changing tools cancels transient ink')

  await page.evaluate(() => { configure({ tool:'pen',drawing:null });actions.length=0 })
  await page.mouse.move(...at(100, 100)); await page.mouse.down()
  await page.mouse.move(...at(200, 200))
  await page.evaluate(() => configure({drawing:null,strokes:[]}))
  await page.mouse.move(...at(300, 300)); await page.mouse.up()
  assert.equal(await page.evaluate(() => actions.filter(action => action.type==='stroke').length), 0, 'Navigation clearing the echoed drawing cancels the physical gesture')
  assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 0)

  for (const [index, transition] of ['navigation', 'board'].entries()) {
    const context = 100 + index * 2
    await page.evaluate(context => {
      sync=false; configure({tool:'pen',strokes:[],drawing:null,context});actions.length=0
    }, context)
    await page.mouse.move(...at(100,100)); await page.mouse.down()
    await page.mouse.move(...at(200,200))
    assert.equal(await page.evaluate(() => state.drawing), null, 'The audience gesture has not received a controller echo')
    await page.evaluate(context => {
      overlay.update({color:'#ef4444'})
      overlay.update({context})
    }, context)
    assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 1, 'Omitted or unchanged context preserves local drawing')
    await page.evaluate(context => configure({context,drawing:null,strokes:[]}), context + 1)
    assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 0, `${transition} clears local ink before an echo`)
    await page.mouse.move(...at(300,300)); await page.mouse.up()
    assert.equal(await page.evaluate(() => actions.filter(action => action.type==='stroke').length), 0, `${transition} never commits the preceding audience gesture`)
    await page.evaluate(() => { actions.length=0 })
    await page.mouse.move(...at(400,100)); await page.mouse.down()
    await page.mouse.move(...at(600,300)); await page.mouse.up()
    const committed = await page.evaluate(() => actions.filter(action => action.type==='stroke'))
    assert.equal(committed.length, 1, `New ink still commits after ${transition}`)
    assert.deepEqual(committed[0].stroke.points[0], [400,100])
    assert.deepEqual(committed[0].stroke.points.at(-1), [600,300])
  }
  await page.evaluate(() => { sync=true; configure({drawing:null,strokes:[]}) })

  await page.evaluate(() => { configure({ tool:'pen',drawing:null });actions.length=0 })
  await page.mouse.move(...at(100, 100)); await page.mouse.down()
  await host.evaluate(element => {element.style.width='320px';element.style.height='180px'})
  await page.mouse.move(box.x + 160, box.y + 90); await page.mouse.up()
  assert.deepEqual(await page.evaluate(() => actions.find(action => action.type==='stroke').stroke.points.at(-1)), [640,360], 'A resize during capture uses the current visible slide dimensions')
  await host.evaluate(element => {element.style.width='640px';element.style.height='360px'})

  await page.evaluate(() => { configure({ tool:'pen',drawing:null });actions.length=0 })
  await page.mouse.move(...at(100, 100)); await page.mouse.down()
  await page.mouse.move(...at(1500, 900)); await page.mouse.up()
  assert.deepEqual(await page.evaluate(() => actions.find(action => action.type==='stroke').stroke.points.at(-1)), [1280,720], 'Captured ink clamps to the slide edge')
  assert.equal(await page.evaluate(() => actions.filter(action => action.type==='pointer').at(-1).point), null)

  await page.evaluate(() => {
    configure({tool:'pen',strokes:[],drawing:{id:'remote',tool:'pen',color:'#3366ff',width:6,points:[[100,100],[400,300]]}});actions.length=0
  })
  assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 1, 'Remote ink renders without a gesture')
  await page.mouse.move(...at(700, 400))
  assert.equal(await svg.locator('[data-layer="drawing"] path').getAttribute('data-stroke-id'), 'remote')
  assert.equal(await page.evaluate(() => actions.filter(action => action.type==='drawing'||action.type==='stroke').length), 0, 'Passive rendering never creates local drawing actions')
  await page.evaluate(() => configure({drawing:null}))
  assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 0)
  await page.evaluate(() => {
    overlay.update({drawing:{id:'remote',tool:'pen',color:'#3366ff',width:6,points:[[100,100],[400,300]]}})
    overlay.update({tool:'hand'})
  })
  assert.equal(await svg.locator('[data-layer="drawing"] path').count(), 0, 'A tool change clears passive transient ink even with partial updates')

  await page.evaluate(() => {
    configure({tool:'pen',drawing:null}); actions.length=0
    const host=document.querySelector('#host');host.style.width='0';host.style.height='0'
    document.querySelector('[data-presenter-overlay]').dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,button:0,clientX:25,clientY:25,bubbles:true}))
    host.style.width='640px';host.style.height='360px'
  })
  assert.equal(await page.evaluate(() => actions.length), 0, 'Zero-size hidden previews never emit invalid coordinates')

  for (const tool of ['arrow','hand','laser','spotlight']) {
    await page.evaluate(tool => { configure({tool,width:4,blank:false});actions.length=0 },tool)
    await page.mouse.move(...at(640, 360))
    assert.deepEqual(await page.evaluate(() => actions.filter(action => action.type==='pointer').at(-1).point), { x:640,y:360 })
    assert.equal(await svg.locator('[data-layer="pointer"]').getAttribute('data-tool'), tool)
    await page.mouse.click(...at(640, 360))
    assert.equal(await page.evaluate(() => actions.filter(action => action.type==='advance').length), 1)
    await page.evaluate(() => { actions.length=0 })
    await page.mouse.move(...at(300,300)); await page.mouse.down()
    await page.mouse.move(...at(450,300)); await page.mouse.up()
    assert.equal(await page.evaluate(() => actions.filter(action => action.type==='advance').length), 0, 'Pointer drag never advances')
    await page.mouse.move(10,10)
    assert.equal(await page.evaluate(() => actions.filter(action => action.type==='pointer').at(-1).point), null)
  }
  await page.evaluate(() => { configure({tool:'eraser'});actions.length=0 })
  await page.mouse.click(...at(400,300))
  assert.deepEqual(await page.evaluate(() => actions.find(action => action.type==='erase')), {type:'erase',point:{x:400,y:300},radius:18})
  assert.equal(await page.evaluate(() => actions.some(action => action.type==='advance')), false)

  await page.evaluate(() => { configure({tool:'pen'});actions.length=0 })
  await page.mouse.move(...at(100,100)); await page.mouse.down()
  await page.mouse.move(...at(300,300))
  await page.evaluate(() => configure({blank:true}))
  await page.mouse.up()
  assert.equal(await page.evaluate(() => actions.some(action => action.type==='stroke')), false, 'Blanking cancels active ink')
  await page.evaluate(() => { actions.length=0 })
  await page.mouse.click(...at(640,360))
  assert.equal(await page.evaluate(() => actions.length), 0, 'Blanking disables every overlay gesture')
  await page.click('#outside')
  assert.equal(await page.evaluate(() => outsideClicks), 1, 'Outside controls remain available')
  await page.evaluate(() => overlay.destroy())
  assert.equal(await svg.count(), 0)
  assert.equal(await page.locator('#slide').count(), 1)
  assert.deepEqual(errors, [])
  console.log('Presenter overlay browser checks passed: 320/640/1280px scaling, resize during capture, bounded/zero-size coordinates, live state echo, tap ink, 8,600 coalesced samples bounded with endpoints preserved, pointer/tool/navigation/blank cancellation, asynchronous navigation/board context cancellation and fresh ink, passive drawing, all pointer tools, click/drag, eraser, external controls, teardown.')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
