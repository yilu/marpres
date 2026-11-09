import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,readdir,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {chromium} from 'playwright-chromium'
import {createDraftServer} from '../editor/server.mjs'

const dir=await mkdtemp(join(tmpdir(),'marpres-ui-performance-')),file=join(dir,'slides.md')
const original=process.env.MARPRES_PROFILE_SOURCE
const fixture='---\nmarp: true\ntheme: marpres\n---\n'+Array.from({length:12},(_,i)=>`# Slide ${i+1}\n\n::: box id=words-${i} position=absolute dx=120 dy=180 width=400\nText on slide ${i+1}\n:::\n\n::: figure id=picture-${i} position=absolute dx=700 dy=200 width=240 crop=25,0,50,100\n![](picture.svg)\n:::\n`).join('\n---\n')
await writeFile(file,original?await readFile(original,'utf8'):fixture)
if(original){for(const entry of await readdir(dirname(original),{withFileTypes:true})){if(entry.name!=='slides.md'&&entry.name!=='.marpres'&&!entry.name.startsWith('.'))await symlink(join(dirname(original),entry.name),join(dir,entry.name))}}
else await writeFile(join(dir,'picture.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000" fill="red"/></svg>')
const metrics={source:original||'fixture',actions:[],functions:[],responses:[]}
let app,browser
try{
 app=await createDraftServer({file,port:0})
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
 await page.addInitScript(()=>{window.__decodedSlides=[];const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){const slide=this.closest('#deck section')?.dataset.sourceSlide;if(slide)window.__decodedSlides.push(Number(slide));return decode.call(this)}})
 page.on('pageerror',e=>errors.push(e.message))
 page.on('response',async response=>{if(response.url().includes('/api/')){const body=await response.body().catch(()=>null);metrics.responses.push({path:new URL(response.url()).pathname,bytes:body?.length,status:response.status()})}})
 await page.route('**/client.js',async route=>{const response=await route.fetch();let code=process.env.MARPRES_PROFILE_CLIENT?await readFile(process.env.MARPRES_PROFILE_CLIENT,'utf8'):await response.text();code='window.__uiProfile=[];\n'+code;for(const name of ['render','refreshNavigator','fitThumbnails','showPage','setSelection','refreshInspector','updateControls']){const async=name==='render';code=code.replace(`${async?'async ':''}function ${name}(`,`${async?'async ':''}function profiled_${name}(`);code+=`\n${async?'async ':''}function ${name}(...args){const start=performance.now();try{return ${async?'await ':''}profiled_${name}(...args)}finally{window.__uiProfile.push({name:'${name}',ms:performance.now()-start})}}\n`}await route.fulfill({response,body:code})})
 const action=async(name,fn)=>{await page.evaluate(()=>{window.__uiProfile=[]});const start=performance.now();await fn();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));metrics.actions.push({name,ms:performance.now()-start});metrics.functions.push({action:name,samples:await page.evaluate(()=>window.__uiProfile)})}
 const start=performance.now();await page.goto(app.url);await page.waitForFunction(()=>document.querySelector('#status').textContent==='Select an object to edit');metrics.actions.push({name:'initial-load',ms:performance.now()-start});metrics.functions.push({action:'initial-load',samples:await page.evaluate(()=>window.__uiProfile)})
 metrics.initialDecodedSlides=await page.evaluate(()=>window.__decodedSlides)
 const deck=await (await fetch(app.url+'/api/deck')).json();const text=deck.objects.find(o=>o.slide===1&&o.contentEditable),figure=deck.objects.find(o=>o.slide===1&&o.kind==='figure')
 const select=async id=>{await page.locator(`#deck [data-edit-id="${id}"]`).dispatchEvent('pointerdown',{button:0});assert.equal(await page.locator('#object-label').textContent(),id)}
 const saved=async(fn,path='edit')=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/'+path)&&r.request().method()==='POST');await fn();assert.equal((await response).status(),200);await page.waitForFunction(()=>!document.body.classList.contains('saving'))}
 await action('slide-next',()=>page.click('#next'))
 await action('slide-previous',()=>page.click('#previous'))
 await action('select-text',()=>select(text.id))
 await page.locator('#content-editor').fill('Retained unsaved performance draft')
 await action('select-figure',()=>select(figure.id))
 await action('crop-open-cancel',async()=>{await page.click('#toolbar-crop');assert.equal(await page.locator('#crop-session').isVisible(),true);await page.click('#cancel-direct-crop')})
 await select(text.id);assert.equal(await page.locator('#content-editor').inputValue(),'Retained unsaved performance draft')
 await page.evaluate(()=>{window.__oldThumbs=[...document.querySelectorAll('.slide-item')];window.__oldSlideNodes=[...document.querySelectorAll('#deck .marpit > svg')]})
 await action('geometry-save',()=>saved(async()=>{await page.locator('#geometry-form input[name="dx"]').fill('125');await page.locator('#geometry-form').evaluate(form=>form.requestSubmit())}))
 const retained=await page.evaluate(()=>({thumbnails:[...document.querySelectorAll('.slide-item')].filter((node,i)=>node===window.__oldThumbs[i]).length,slides:[...document.querySelectorAll('#deck .marpit > svg')].filter((node,i)=>node===window.__oldSlideNodes[i]).length}))
 metrics.retained=retained
 assert.equal(await page.locator('.slide-item[aria-selected="true"]').getAttribute('data-slide'),'1')
 assert.equal(await page.locator('#object-label').textContent(),text.id)
 const originalCrop=JSON.parse(await page.locator(`#deck [data-edit-id="${figure.id}"]`).getAttribute('data-edit-options')).crop
 assert.equal(await page.locator('#content-editor').inputValue(),'Retained unsaved performance draft')
 await action('drag-release',()=>saved(async()=>{
  const rect=await page.locator(`#deck [data-edit-id="${text.id}"]`).boundingBox()
  await page.mouse.move(rect.x+Math.min(40,rect.width/2),rect.y+rect.height/2)
  await page.mouse.down();await page.mouse.move(rect.x+Math.min(40,rect.width/2)+15,rect.y+rect.height/2+10,{steps:4});await page.mouse.up()
 }))
 await action('resize-release',()=>saved(async()=>{
  const handle=page.locator('.moveable-control.moveable-se').first(),rect=await handle.boundingBox()
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+12,rect.y+rect.height/2+8,{steps:4});await page.mouse.up()
 }))
 await action('style-save',()=>saved(()=>page.locator('#style-form input[name="bold"]').click()))
 await action('text-save',()=>saved(()=>page.click('#save-content'),'content'))
 await action('undo',()=>saved(()=>page.click('#undo'),'undo'))
 await action('redo',()=>saved(()=>page.click('#redo'),'redo'))
 await action('theme-preview-open',async()=>{await page.click('#theme-toggle');await page.waitForFunction(()=>document.querySelector('#theme-preview-frame').dataset.previewVersion!==undefined);await page.click('#theme-close')})
 assert.deepEqual(JSON.parse(await page.locator(`#deck [data-edit-id="${figure.id}"]`).getAttribute('data-edit-options')).crop,originalCrop)
 // Navigate through retained buttons, including keyboard focus after a save.
 await page.locator('.slide-item[data-slide="2"]').click()
 await page.keyboard.press('ArrowDown')
 assert.equal(await page.locator('.slide-item[aria-selected="true"]').getAttribute('data-slide'),'3')
 assert.equal(await page.locator('.slide-item[data-slide="3"]').evaluate(el=>el===document.activeElement),true)
 await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp')
 assert.equal(await page.locator('#page-label').textContent(),`1 / ${deck.slides.length}`)
 assert.deepEqual(errors,[])
 const report=process.env.MARPRES_PROFILE_REPORT||'/tmp/marpres-ui-performance.json';await writeFile(report,JSON.stringify(metrics,null,2));console.log(JSON.stringify({report,actions:metrics.actions,retained}))
 assert.ok(metrics.initialDecodedSlides.length>0&&metrics.initialDecodedSlides.every(slide=>slide===1),'Initial rendering must wait only for images on the displayed slide')
 assert.ok(retained.thumbnails>=deck.slides.length-1,'Unchanged slide thumbnails must retain DOM identity after an object edit')
}finally{if(browser)await browser.close();if(app)await app.close();await rm(dir,{recursive:true,force:true})}
