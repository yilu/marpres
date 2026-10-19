import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SourceStore, SourceError, mapSource } from './source-store.mjs'
import { getDeckDesign, getSlideAppearance, applyDeckDesign, setSlideAppearance } from './theme-store.mjs'
import { readNotes, patchNotes } from './notes.mjs'
import { PresentationStore } from './presentation-store.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const maxBodyBytes = 16 * 1024 * 1024

export async function jsonBody(request) {
  const chunks=[]
  let bytes=0
  for await(const chunk of request) {
    const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)
    bytes+=data.length
    if(bytes>maxBodyBytes)throw new SourceError('The edit request is too large.','INVALID',413)
    chunks.push(data)
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  catch{throw new SourceError('The edit request must contain JSON.')}
}

export async function createDraftServer({ file, port = 3030, renderer, ui='gui' } = {}) {
  if (!file) throw new Error('A deck Markdown file is required.')
  if(ui!=='gui')throw new Error('Unknown editor UI.')
  const store = new SourceStore(file)
  const presentations = new PresentationStore(store)
  await store.read()
  const renderFile = renderer ?? (await import('../scripts/render.mjs')).renderFile
  const token = randomBytes(32).toString('hex')
  let serial = Promise.resolve()
  const enqueue = operation => {
    const result = serial.then(operation)
    serial = result.catch(() => {})
    return result
  }
  let lastRendered
  const deck = async () => {
    const current = await store.read()
    if (!lastRendered || lastRendered.hash !== current.hash) {
      const rendered = await renderFile(store.file, { draft: true })
      const latest = await store.read()
      if (rendered.hash !== latest.hash) throw store.conflict()
      lastRendered = rendered
    }
    const latest = await store.read()
    if (latest.hash !== lastRendered.hash) throw store.conflict()
    let editingError = null, objects=[], slides=[], design
    try { const mapping=mapSource(latest.source),notes=readNotes(latest.source);objects=mapping.objects.map(({id,kind,content,contentEditable,slide,line,endLine})=>({id,kind,content,contentEditable,slide,line:line+1,endLine}));slides=mapping.slides.map(({slide,title,startLine,endLine})=>({slide,title,startLine:startLine+1,endLine,appearance:getSlideAppearance(latest.source,slide),notes:notes[slide-1]})) } catch (error) { editingError = error.message }
    try{design=getDeckDesign(latest.source)}catch(error){design=getDeckDesign('');editingError=editingError||error.message}
    return { ...lastRendered, history: latest.history, editingError, objects, slides, sourcePath:store.file, design, capabilities:{panelInsertion:true,themePreview:true,masterPositions:true,titleTypography:true,presenter:true,notes:true} }
  }
  const respond = (response, status, value, type = 'application/json; charset=utf-8', extraHeaders={}) => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extraHeaders })
    response.end(type.startsWith('application/json') ? JSON.stringify(value) : value)
  }
  const server = http.createServer(async (request, response) => {
    try {
      const actualPort = server.address()?.port
      const allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`])
      if (!allowedHosts.has(request.headers.host)) throw new SourceError('Use the editor’s local URL.', 'FORBIDDEN', 403)
      const url = new URL(request.url, `http://${request.headers.host}`)
      if (request.method === 'POST') {
        const endSession = /^\/api\/presentation\/([a-f\d-]+)\/end$/.exec(url.pathname)
        if (endSession) {
          if (request.headers.origin !== `http://${request.headers.host}` || !request.headers['content-type']?.startsWith('application/json')) throw new SourceError('End the presentation from its local presenter console.', 'FORBIDDEN', 403)
          await jsonBody(request)
          return respond(response, 200, await enqueue(() => presentations.end(endSession[1], request.headers['x-presenter-key'])))
        }
        const supplied = Buffer.from(String(request.headers['x-editor-token'] ?? ''))
        const validToken = supplied.length === token.length && timingSafeEqual(supplied, Buffer.from(token))
        const origin = request.headers.origin
        if (!validToken || origin !== `http://${request.headers.host}` || !request.headers['content-type']?.startsWith('application/json')) {
          throw new SourceError('Edits are accepted only from this local editor page.', 'FORBIDDEN', 403)
        }
        const operation = { '/api/edit': 'edit', '/api/undo': 'undo', '/api/redo': 'redo', '/api/content':'content', '/api/insert':'insert', '/api/delete':'delete', '/api/slide':'slide', '/api/batch':'batch', '/api/image':'image', '/api/export':'export', '/api/theme':'theme', '/api/theme-preview':'theme-preview', '/api/appearance':'appearance', '/api/notes':'notes', '/api/presentation':'presentation' }[url.pathname]
        if (!operation) throw new SourceError('Unknown endpoint.', 'NOT_FOUND', 404)
        const body = await jsonBody(request)
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SourceError('Invalid edit request.')
        if (operation === 'presentation') return respond(response, 200, await enqueue(() => presentations.create(body)))
        if(operation==='theme-preview') {
          const {previewTheme}=await import('./theme-preview.mjs')
          const preview=await enqueue(()=>previewTheme(store,body))
          respond(response,200,preview)
          return
        }
        if(operation==='export') {
          const {exportDeckPDF}=await import('./media.mjs')
          const {buffer,filename}=await enqueue(()=>exportDeckPDF(store,body))
          respond(response,200,buffer,'application/pdf',{'Content-Disposition':`attachment; filename="deck.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`})
          return
        }
        const result = await enqueue(async () => {
          const mutation=operation==='notes'?await store.mutate(body.hash,source=>patchNotes(source,body.slide,body.notes)):operation==='image'?await (await import('./media.mjs')).importImage(store,body):operation==='theme'?await store.mutate(body.hash,source=>applyDeckDesign(source,{theme:body.theme,css:body.css})):operation==='appearance'?await store.mutate(body.hash,source=>setSlideAppearance(source,body.slide,body.appearance)):await store[operation](body)
          return {...await deck(), ...(mutation.selectedId?{selectedId:mutation.selectedId}:{}), ...(mutation.selectedSlide?{selectedSlide:mutation.selectedSlide}:{})}
        })
        respond(response, 200, result)
        return
      }
      if (request.method !== 'GET') throw new SourceError('Method not allowed.', 'INVALID', 405)
      const presentation = /^\/api\/presentation\/([a-f\d-]+)$/.exec(url.pathname)
      if (presentation) return respond(response, 200, presentations.get(presentation[1], url.searchParams.get('role'), request.headers['x-presenter-key']))
      if(url.pathname==='/api/shapes')return respond(response,200,{groups:(await import('../engine/shapes.mjs')).shapeGroups})
      if (url.pathname === '/api/deck') return respond(response, 200, await enqueue(deck))
      if (url.pathname === '/api/status') {
        const { hash, history } = await store.read()
        return respond(response, 200, { hash, history })
      }
      const assets = {
        '/': ['web/index.html', 'text/html; charset=utf-8'],
        '/presenter': ['../presenter/index.html', 'text/html; charset=utf-8'],
        '/audience': ['../presenter/index.html', 'text/html; charset=utf-8'],
        '/client.js': ['web/client.js', 'text/javascript; charset=utf-8'],
        '/brand-mark.svg': ['../assets/brand/marpres-mark.svg', 'image/svg+xml'],
        '/favicon.ico': ['../assets/brand/marpres.ico', 'image/x-icon'],
        '/crop-editor.js': ['crop-editor.js', 'text/javascript; charset=utf-8'],
        '/client.css': ['web/client.css', 'text/css; charset=utf-8'],
        '/vendor/moveable.min.js': ['../node_modules/moveable/dist/moveable.min.js', 'text/javascript; charset=utf-8']
      }
      for (const name of ['client.js', 'view.js', 'overlay.js', 'layout.js', 'displays.js', 'model.mjs', 'geometry.mjs', 'presenter.css']) assets[`/presenter/${name}`] = [`../presenter/${name}`, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']
      const asset = assets[url.pathname] || (ui==='gui'&&/^\/[a-z][a-z0-9-]*\.js$/.test(url.pathname)?['web'+url.pathname,'text/javascript; charset=utf-8']:null)
      if (!asset) throw new SourceError('Not found.', 'NOT_FOUND', 404)
      let content = await readFile(resolve(here, asset[0]), asset[1] === 'image/x-icon' ? undefined : 'utf8')
      if (url.pathname === '/') content = content.replace('__EDITOR_TOKEN__', token)
      if (url.pathname === '/presenter' || url.pathname === '/audience') content = content.replaceAll('__PRESENTER_ROLE__', url.pathname.slice(1))
      respond(response, 200, content, asset[1])
    } catch (error) {
      if (![400,403,404,409,410].includes(error.status)) console.error(error)
      respond(response, error.status ?? 500, { error: error.message, code: error.code ?? 'SERVER_ERROR' })
    }
  })
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept) })
  return { server, store, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const portAt = args.indexOf('--port')
  const port = portAt === -1 ? 3030 : Number(args[portAt + 1])
  const file = args[0] && !args[0].startsWith('--') ? args[0] : 'slides/demo.md'
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Usage: node editor/server.mjs [slides/deck.md] [--port 3030]')
    process.exitCode = 1
  } else {
    const uiAt=args.indexOf('--ui');const ui=uiAt===-1?'gui':args[uiAt+1]
    const app = await createDraftServer({ file: resolve(file), port,ui })
    console.log(`Marpres: ${app.url}`)
    console.log(`Editing ${resolve(file)}`)
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.server.close(); process.exit() })
  }
}
