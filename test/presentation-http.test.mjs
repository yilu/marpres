import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDraftServer } from '../editor/server.mjs'

const source = '# First\n\n<!-- notes\nHTTP-PRIVATE-NOTE\n-->\n\n---\n# Second\n'
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'marpres-session-http-')), file = join(dir, 'deck.md')
  await writeFile(file, source)
  const app = await createDraftServer({ file, port: 0 })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const html = await (await fetch(app.url)).text()
  const token = /name="editor-token" content="([^"]+)"/.exec(html)[1]
  const headers = { 'Content-Type': 'application/json', Origin: app.url, 'X-Editor-Token': token }
  const post = (path, body, extra = {}) => fetch(app.url + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
  const deck = await (await fetch(app.url + '/api/deck')).json()
  return { app, file, deck, post }
}

test('notes and presentation creation use editor guards; audience cannot read presenter notes', async t => {
  const { app, file, deck, post } = await fixture(t)
  assert.equal(deck.capabilities.presenter, true); assert.equal(deck.capabilities.notes, true)
  assert.equal(deck.slides[0].notes, 'HTTP-PRIVATE-NOTE')
  for (const path of ['/api/notes', '/api/presentation']) {
    for (const headers of [{ Origin: 'http://foreign.example' }, { 'X-Editor-Token': '' }]) assert.equal((await post(path, { hash: deck.hash, slide: 1, notes: 'new' }, headers)).status, 403)
    assert.equal((await post(path, { hash: 'stale', slide: 1, notes: 'new' })).status, 409)
  }
  const savedResponse = await post('/api/notes', { hash: deck.hash, slide: 2, notes: 'Second note' })
  assert.equal(savedResponse.status, 200)
  const saved = await savedResponse.json()
  assert.equal(saved.slides[1].notes, 'Second note'); assert.equal(saved.history.canUndo, true)
  const before = await readFile(file, 'utf8')
  const createdResponse = await post('/api/presentation', { hash: saved.hash, slide: 2 })
  assert.equal(createdResponse.status, 200)
  const created = await createdResponse.json(), key = new URL(created.presenterUrl, app.url).hash.slice(5)
  const path = `/api/presentation/${created.id}`
  const audience = await (await fetch(app.url + path + '?role=audience')).json()
  assert.doesNotMatch(JSON.stringify(audience), /HTTP-PRIVATE-NOTE|Second note|presenterKey|sourcePath|history|token/)
  assert.equal(audience.startSlide, 2)
  assert.equal((await fetch(app.url + path + '?role=presenter')).status, 403)
  assert.equal((await fetch(app.url + path + '?role=presenter', { headers: { 'X-Presenter-Key': key } })).status, 200)
  assert.equal((await fetch(app.url + path + '?role=unknown')).status, 400)
  assert.equal(await readFile(file, 'utf8'), before)
  const ended = await post(path + '/end', {}, { 'X-Editor-Token': '', 'X-Presenter-Key': key })
  assert.equal(ended.status, 200); assert.deepEqual(await ended.json(), { ended: true })
  assert.equal((await fetch(app.url + path + '?role=audience')).status, 410)
  assert.equal(await readFile(file, 'utf8'), before)
})

test('ending a session requires its presenter key and a same-origin JSON request', async t => {
  const { deck, post } = await fixture(t)
  const created = await (await post('/api/presentation', { hash: deck.hash, slide: 1 })).json()
  const path = `/api/presentation/${created.id}/end`, key = new URL(created.presenterUrl, 'http://localhost').hash.slice(5)
  for (const headers of [{}, { 'X-Presenter-Key': 'wrong' }, { 'X-Presenter-Key': key, Origin: 'http://foreign.example' }, { 'X-Presenter-Key': key, 'Content-Type': 'text/plain' }]) {
    assert.equal((await post(path, {}, headers)).status, 403)
  }
})

test('presenter routes serve explicit assets and malformed notes never write the source', async t => {
  const { app, file, deck, post } = await fixture(t)
  for (const role of ['presenter', 'audience']) {
    const response = await fetch(app.url + '/' + role), html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, new RegExp(`data-role="${role}"`))
    assert.doesNotMatch(html, /editor-token|HTTP-PRIVATE-NOTE|__PRESENTER_ROLE__/)
  }
  for (const name of ['client.js', 'view.js', 'model.mjs', 'geometry.mjs', 'overlay.js', 'presenter.css']) assert.equal((await fetch(app.url + '/presenter/' + name)).status, 200)
  assert.equal((await fetch(app.url + '/presenter/../editor/server.mjs')).status, 404)
  assert.equal((await fetch(app.url + '/presenter/%2e%2e%2feditor%2fserver.mjs')).status, 404)
  assert.equal((await fetch(app.url + '/presenter/unknown.js')).status, 404)
  assert.equal((await post('/api/notes', { hash: deck.hash, slide: 1, notes: 'Bad --> text' })).status, 400)
  assert.equal(await readFile(file, 'utf8'), source)
})
