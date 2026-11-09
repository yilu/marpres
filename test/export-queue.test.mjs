import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDraftServer } from '../editor/server.mjs'

test('PDF generation leaves deck reads and mutations available and preserves export conflicts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'marpres-export-queue-')), file = join(dir, 'deck.md')
  await writeFile(file, '# First\n\n::: box id=body\nText\n:::\n')
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const app = await createDraftServer({ file, port: 0, exporter: async (store, { hash }) => {
    const snapshot = await store.read()
    if (snapshot.hash !== hash) throw store.conflict()
    entered()
    await blocked
    await store.guarded(snapshot.hash)
    return { buffer: Buffer.from('%PDF fixture'), filename: 'deck.pdf' }
  } })
  t.after(async () => { release(); await app.close(); await rm(dir, { recursive: true, force: true }) })
  const home = await (await fetch(app.url)).text(), token = home.match(/name="editor-token" content="([^"]+)"/)[1]
  const headers = { 'Content-Type': 'application/json', Origin: app.url, 'X-Editor-Token': token }
  const post = (path, body) => fetch(app.url + path, { method: 'POST', headers, body: JSON.stringify(body) })
  const deck = await (await fetch(app.url + '/api/deck')).json()
  const exporting = post('/api/export', { hash: deck.hash })
  await started
  let timeout
  const work = (async () => {
    assert.equal((await fetch(app.url + '/api/deck')).status, 200)
    assert.equal((await fetch(app.url + '/api/status')).status, 200)
    assert.equal((await post('/api/edit', { hash: deck.hash, id: 'body', patch: { font: 28 } })).status, 200)
  })()
  try { await Promise.race([work, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Editor requests blocked behind export')), 1500) })]) }
  finally { clearTimeout(timeout); release() }
  const response = await exporting
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'CONFLICT')
})
