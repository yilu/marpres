import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright-chromium'
import {createDraftServer} from '../editor/server.mjs'

const dir=await mkdtemp(join(tmpdir(),'marp-arrangement-')),file=join(dir,'deck.md')
const source=`---
marp: true
theme: nju-unofficial-v2
---
# Explicit alignment
<!-- _layout: cols 1 1 -->

:::: panel id=left valign=center
::: box id=left-a width=200 dx=12 dy=6
First panel text
:::
::: box id=left-b width=160
Another text
:::
::: caption id=left-caption width=180
Panel caption
:::
::::

:::: panel id=right valign=center
::: box id=right-a width=180
Second panel text
:::
::::

::: box id=free position=absolute dx=900 dy=560 width=200
Free annotation
:::

---
# Nested placement

:::: panel id=nested-panel
:::: box id=outer dx=100 dy=50 width=400 height=200
::: box id=inner position=absolute dx=20 dy=30 width=100
Inner text
:::
::::
::::
`
await writeFile(file,source)
await writeFile(join(dir,'image.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#7a005f"/></svg>')
let app,browser
try {
 app=await createDraftServer({file,port:0,ui:'gui'})
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
 const page=await browser.newPage({viewport:{width:1500,height:980}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(app.url)
 const object=id=>page.locator(`#deck [data-edit-id="${id}"]`)
 const rect=selector=>page.locator(selector).boundingBox()
 const near=(a,b,label)=>assert.ok(Math.abs(a-b)<.8,`${label}: ${a} ≈ ${b}`)
 const saved=async action=>{
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/'))
  await action();const result=await response;assert.equal(result.status(),200,await result.text())
  await page.waitForFunction(()=>!document.body.classList.contains('saving'))
 }
 const select=async ids=>{await page.keyboard.press('Escape');await object(ids[0]).click();for(const id of ids.slice(1))await object(id).click({modifiers:['Shift']})}
 const align=direction=>saved(()=>page.click(`[data-align="${direction}"]`))
 const undo=()=>saved(()=>page.click('#undo'))
 const disabled=target=>page.locator(`#align-target option[value="${target}"]`).evaluate(option=>option.disabled)

 await select(['free'])
 assert.equal(await page.locator('#align-target').inputValue(),'content','A free object defaults explicitly to the content area')
 assert.equal(await disabled('selection'),true)
 assert.equal(await disabled('panel'),true)
 assert.equal(await page.locator('#position-x-label').textContent(),'X')
 assert.match(await page.locator('#position-mode').textContent(),/Free position/)
 let area=await rect('#deck .current-slide .deck-content')
 await align('right')
 let frame=await object('free').boundingBox();near(frame.x+frame.width,area.x+area.width,'Content right edge')
 assert.equal(await page.locator('#align-target').inputValue(),'content')
 await undo()
 await page.selectOption('#align-target','slide')
 const slide=await rect('#deck .current-slide section')
 await align('right')
 frame=await object('free').boundingBox();near(frame.x+frame.width,slide.x+slide.width,'Full slide right edge')
 assert.equal(await page.locator('#align-target').inputValue(),'slide','Saving keeps the explicit target')
 await undo()
 assert.equal(await page.locator('#align-target').inputValue(),'slide','Undo keeps the explicit target')
 assert.equal(await readFile(file,'utf8'),source)

 await object('left-a').click()
 assert.equal(await page.locator('#align-target').inputValue(),'panel')
 assert.equal(await disabled('panel'),false)
 assert.equal(await page.locator('#position-x-label').textContent(),'Offset X')
 assert.equal(await page.locator('#geometry-form [name="dx"]').inputValue(),'12')
 assert.match(await page.locator('#position-mode').textContent(),/Layout.*panel 1/)
 assert.equal(await page.locator('#reset-position').textContent(),'Reset layout offsets')
 const panel=await rect('#deck .current-slide [data-panel-id="left"]')
 await align('bottom')
 frame=await object('left-a').boundingBox();near(frame.y+frame.height,panel.y+panel.height,'Containing panel includes its caption track')
 await undo()

 await select(['left-a','left-b'])
 assert.equal(await page.locator('#align-target').inputValue(),'selection')
 assert.equal(await disabled('panel'),false,'Objects in one panel can share its target')
 await page.selectOption('#align-target','panel')
 await align('right')
 for(const id of ['left-a','left-b']){frame=await object(id).boundingBox();near(frame.x+frame.width,panel.x+panel.width,'Common panel right edge')}
 await undo()
 assert.equal(await readFile(file,'utf8'),source,'A panel batch aligns and undoes atomically')

 await select(['left-a','right-a'])
 assert.equal(await page.locator('#align-target').inputValue(),'selection')
 assert.equal(await disabled('panel'),true,'Different panels are not silently substituted')
 const left=await object('left-a').boundingBox(),right=await object('right-a').boundingBox()
 await align('center')
 const center=(Math.min(left.x,right.x)+Math.max(left.x+left.width,right.x+right.width))/2
 for(const id of ['left-a','right-a']){frame=await object(id).boundingBox();near(frame.x+frame.width/2,center,'Selected objects use their combined bounds')}
 await undo()
 await select(['left-a','free'])
 assert.equal(await disabled('panel'),true,'Free objects are not assigned to an overlapped panel')
 await select(['free'])
 assert.equal(await page.locator('#align-target').inputValue(),'content')
 assert.equal(await readFile(file,'utf8'),source)

 // Selecting a column object never silently changes the default free insertion.
 await select(['left-a'])
 assert.equal(await page.locator('#insertion-target').inputValue(),'')
 await saved(()=>page.click('#insert-text'))
 let inserted=await page.locator('#object-label').textContent()
 assert.equal(await object(inserted).evaluate(el=>el.closest('.panel')===null),true)
 assert.equal(await object(inserted).evaluate(el=>JSON.parse(el.dataset.editOptions).position),'absolute')
 await undo()
 await page.selectOption('#insertion-target','2')
 await select(['left-a'])
 assert.equal(await page.locator('#insertion-target').inputValue(),'2','Selection does not change the explicitly chosen insertion target')
 await saved(()=>page.click('#insert-text'))
 inserted=await page.locator('#object-label').textContent()
 assert.equal(await object(inserted).evaluate(el=>el.closest('.panel').dataset.panelId),'right')
 assert.equal(await object(inserted).evaluate(el=>JSON.parse(el.dataset.editOptions).position),undefined)
 await page.locator('#geometry-form [name="dx"]').fill('17')
 await saved(()=>page.locator('#geometry-form button[type="submit"]').click())
 assert.equal(await object(inserted).evaluate(el=>el.closest('.panel').dataset.panelId),'right','GUI adjustments retain column membership')
 assert.equal(await object(inserted).evaluate(el=>JSON.parse(el.dataset.editOptions).position),undefined)
 await undo();await undo()
 await page.selectOption('#insertion-target','1')
 await saved(()=>page.locator('#image-file').setInputFiles(join(dir,'image.svg')))
 inserted=await page.locator('#object-label').textContent()
 assert.equal(await object(inserted).evaluate(el=>el.closest('.panel').dataset.panelId),'left')
 assert.equal(await object(inserted).evaluate(el=>JSON.parse(el.dataset.editOptions).position),undefined)
 await undo()
 assert.equal(await readFile(file,'utf8'),source,'Panel inserts and adjustments undo without disturbing the deck')

 await select(['left-a','left-b','right-a'])
 await page.selectOption('#align-target','slide')
 let beforeRects=await Promise.all(['left-a','left-b','right-a'].map(id=>object(id).boundingBox()))
 await saved(()=>page.click('[data-distribute="horizontal"]'))
 const afterRects=(await Promise.all(['left-a','left-b','right-a'].map(id=>object(id).boundingBox()))).sort((a,b)=>a.x-b.x)
 near(afterRects[0].x,Math.min(...beforeRects.map(r=>r.x)),'Distribution preserves the first outer bound with Slide selected')
 near(afterRects[2].x+afterRects[2].width,Math.max(...beforeRects.map(r=>r.x+r.width)),'Distribution preserves the last outer bound')
 near(afterRects[1].x-afterRects[0].x-afterRects[0].width,afterRects[2].x-afterRects[1].x-afterRects[1].width,'Distribution uses equal gaps')
 await undo()
 await page.selectOption('#distribution-mode','centers')
 for(const direction of ['horizontal','vertical']) {
  const pos=direction==='horizontal'?'x':'y',size=direction==='horizontal'?'width':'height'
  beforeRects=await Promise.all(['left-a','left-b','right-a'].map(id=>object(id).boundingBox()))
  const centers=beforeRects.map(r=>r[pos]+r[size]/2).sort((a,b)=>a-b)
  await saved(()=>page.click(`[data-distribute="${direction}"]`))
  const arranged=(await Promise.all(['left-a','left-b','right-a'].map(id=>object(id).boundingBox()))).map(r=>r[pos]+r[size]/2).sort((a,b)=>a-b)
  near(arranged[0],centers[0],`${direction} preserves first centre`)
  near(arranged[2],centers[2],`${direction} preserves last centre`)
  near(arranged[1]-arranged[0],arranged[2]-arranged[1],`${direction} equal centre spacing with unequal object sizes`)
  await undo()
 }
 assert.equal(await readFile(file,'utf8'),source,'Either distribution mode is one undo transaction')

 await page.locator('.slide-item[data-slide="2"]').click()
 assert.equal(await page.locator('#insertion-target').inputValue(),'','A new slide starts with free insertion')
 await select(['inner'])
 assert.match(await page.locator('#position-mode').textContent(),/Free position.*parent box/)
 assert.equal(await page.locator('#reset-position').textContent(),'Move to parent origin')
 await saved(()=>page.click('#reset-position'))
 const parent=await object('outer').boundingBox(),child=await object('inner').boundingBox()
 near(child.x,parent.x,'Nested absolute reset uses its actual parent x')
 near(child.y,parent.y,'Nested absolute reset uses its actual parent y')
 await undo()
 assert.equal(await readFile(file,'utf8'),source)
 await page.locator('.slide-item[data-slide="1"]').click()

 // Revalidate an explicit target if source changes the selected object's mode.
 await select(['left-a'])
 assert.equal(await page.locator('#align-target').inputValue(),'panel')
 await writeFile(file,source.replace('id=left-a width=200','id=left-a position=absolute width=200'))
 await page.waitForSelector('body.conflicted')
 await page.click('#reload')
 await page.waitForFunction(()=>!document.body.classList.contains('saving')&&!document.body.classList.contains('conflicted'))
 assert.equal(await page.locator('#align-target').inputValue(),'content')
 assert.equal(await disabled('panel'),true)
 await writeFile(file,source)
 await page.waitForSelector('body.conflicted')
 await page.click('#reload')
 await page.waitForFunction(()=>!document.body.classList.contains('saving')&&!document.body.classList.contains('conflicted'))

 await object('left-a').click()
 if(process.env.ARRANGEMENT_SCREENSHOT)await page.screenshot({path:process.env.ARRANGEMENT_SCREENSHOT})
 await page.setViewportSize({width:900,height:700})
 await page.waitForTimeout(100)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 if(process.env.ARRANGEMENT_NARROW_SCREENSHOT)await page.screenshot({path:process.env.ARRANGEMENT_NARROW_SCREENSHOT})
 assert.deepEqual(errors,[])
 console.log('Arrangement browser checks passed: explicit alignment bounds, gap/centre distribution both axes, panel insertion with free default, nested origins, target revalidation and atomic undo.')
} finally {await browser?.close();await app?.close();await rm(dir,{recursive:true,force:true})}
