import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDraftServer } from '../editor/server.mjs'

const source = '---\nmarp: true\ntheme: nju-unofficial-v2\npaginate: true\n---\n# Preview deck\n\n::: box id=body\nBody text\n:::\n\n::: figure id=plot width=250\n![plot](plot.svg)\n:::\n\n::: footer\nFooter text\n:::\n'
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'marp-theme-preview-'))
  const file = join(dir, 'deck.md')
  await writeFile(file, source)
  await writeFile(join(dir, 'plot.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#abcdef"/></svg>')
  const app = await createDraftServer({ file, port: 0, ui: 'gui' })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const initial = await (await fetch(app.url + '/api/deck')).json()
  const html = await (await fetch(app.url)).text()
  const token = /name="editor-token" content="([^"]+)"/.exec(html)[1]
  const headers = { 'Content-Type': 'application/json', Origin: app.url, 'X-Editor-Token': token }
  const post = (path, body, overrides = {}) => fetch(app.url + path, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(body) })
  return { app, file, dir, initial, post }
}

test('theme preview renders proposed settings without changing source, history or cached deck', async t => {
  const { app, file, dir, initial, post } = await fixture(t)
  assert.deepEqual(initial.capabilities, { panelInsertion: true, themePreview: true, masterPositions: true, presenter: true, notes: true })
  const edited = await (await post('/api/edit', { hash: initial.hash, id: 'body', patch: { font: 30 } })).json()
  const baseline = await (await post('/api/undo', { hash: edited.hash })).json()
  assert.equal(baseline.history.canRedo, true)
  const history = structuredClone({ undo: app.store.undoStack, redo: app.store.redoStack })
  const response = await post('/api/theme-preview', { hash: baseline.hash, theme: { title_size: 65, title_dx: 33, footer_dy: -12, page_number_dx: -24 }, css: 'section .layout-box { color: #123456; }' })
  assert.equal(response.status, 200)
  const preview = await response.json()
  assert.deepEqual(Object.keys(preview).sort(), ['css', 'diagnostics', 'hash', 'html'])
  assert.equal(preview.hash, baseline.hash)
  assert.deepEqual(preview.diagnostics, [])
  assert.match(preview.css, /--deck-title-size:\s*65px/)
  assert.match(preview.css, /--deck-title-dx:\s*33px/)
  assert.match(preview.css, /color:\s*#123456/)
  assert.match(preview.html, /data:image\/svg\+xml;base64,/)
  assert.equal(await readFile(file, 'utf8'), source)
  assert.deepEqual({ undo: app.store.undoStack, redo: app.store.redoStack }, history)
  assert.deepEqual((await readdir(dir)).sort(), ['deck.md', 'plot.svg'])
  const after = await (await fetch(app.url + '/api/deck')).json()
  assert.equal(after.hash, baseline.hash)
  assert.equal(after.css, baseline.css)
  assert.equal(after.html, baseline.html)
  assert.deepEqual(after.design, baseline.design)
  assert.deepEqual(after.history, baseline.history)
  const redone = await (await post('/api/redo', { hash: after.hash })).json()
  assert.equal(redone.source, edited.source)
})

test('theme preview rejects stale hashes, invalid CSS, invalid offsets and foreign origins', async t => {
  const { app, file, initial, post } = await fixture(t)
  const body = { hash: initial.hash, theme: { title_dx: 0 }, css: '' }
  for (const overrides of [{ Origin: 'https://example.com' }, { 'X-Editor-Token': '' }]) {
    assert.equal((await post('/api/theme-preview', body, overrides)).status, 403)
  }
  for (const patch of [{ css: 'section {' }, { css: '</style><script>alert(1)</script>' }, { theme: { title_dy: 721 } }]) {
    assert.equal((await post('/api/theme-preview', { ...body, ...patch })).status, 400)
  }
  assert.equal(await readFile(file, 'utf8'), source)
  assert.deepEqual((await app.store.read()).history, { canUndo: false, canRedo: false })
  await writeFile(file, source + '\nExternal edit\n')
  const stale = await post('/api/theme-preview', body)
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).code, 'CONFLICT')
  assert.equal(await readFile(file, 'utf8'), source + '\nExternal edit\n')
})

test('theme preview rechecks source after rendering and rejects an external edit during the snapshot', async t => {
  const { app, file, initial, post } = await fixture(t)
  const guarded = app.store.guarded.bind(app.store)
  let checks = 0
  app.store.guarded = async hash => {
    const snapshot = await guarded(hash)
    if (++checks === 1) await writeFile(file, source + '\nConcurrent external edit\n')
    return snapshot
  }
  const response = await post('/api/theme-preview', { hash: initial.hash, theme: { title_size: 56 }, css: '' })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'CONFLICT')
  assert.equal(await readFile(file, 'utf8'), source + '\nConcurrent external edit\n')
  assert.deepEqual(app.store.undoStack, [])
  assert.deepEqual(app.store.redoStack, [])
})
