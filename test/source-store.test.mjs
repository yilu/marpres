import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceStore, patchSource, scanEditable, hashSource } from '../editor/source-store.mjs'
import { createDraftServer } from '../editor/server.mjs'

const example = '<!-- hidden\n::: box id=hidden\n-->\n\n````md\n::: box id=code\n```\n::: box id=still-code\n````\n\n    ::: box id=indented\n\n:::: col\n::: figure id=plot width=420 crop=10,20,60,50 custom="a b"\n![plot](figures/a.png)\n:::\n\n::: caption id=note\nCaption with **formatting**.\n:::\n::::\n'

test('finds real editable opening fences and ignores comments, code and closers', () => {
  assert.deepEqual(scanEditable(example).map(x => x.id), ['plot', 'note'])
})

test('container-like closing markers inside code cannot expose fake editable fences', () => {
  const source = '::: col\n```md\n:::\n::: box id=fake\nText\n```\n\n::: box id=real\nText\n:::\n:::\n'
  assert.deepEqual(scanEditable(source).map(x => x.id), ['real'])
})

test('patches only requested opening-fence options and preserves all other bytes', () => {
  const changed = patchSource(example, 'plot', { dx: 12.25, dy: -8, width: 444, crop: [5, 10, 70, 60] })
  assert.equal(changed, example.replace('width=420 crop=10,20,60,50 custom="a b"', 'width=444 crop=5,10,70,60 custom="a b" dx=12.25 dy=-8'))
  assert.equal(patchSource(changed, 'plot', { dx: null, crop: null }), changed.replace(' crop=5,10,70,60', '').replace(' dx=12.25', ''))
})

test('retains CRLF, long fences, quote style and unknown options', () => {
  const source = ':::::: box id="label" width="160" extra=keep\r\nHello\r\n::::::\r\n'
  assert.equal(patchSource(source, 'label', { width: 200 }), source.replace('width="160"', 'width="200"'))
})

test('accepts whitespace around equals while preserving key spacing and quotes', () => {
  const source = ':::::: box id = "label" width  =  "160" extra = keep\r\nHello\r\n::::::\r\n'
  assert.deepEqual(scanEditable(source).map(object => object.id), ['label'])
  assert.equal(patchSource(source, 'label', { width: 200 }), source.replace('"160"', '"200"'))
  assert.equal(patchSource(source, 'label', { width: null }), source.replace(' width  =  "160"', ''))
})

test('rejects duplicate IDs, unknown targets, unsafe values and invalid crops', () => {
  assert.throws(() => patchSource(example + '\n::: box id=plot\nX\n:::\n', 'plot', { dx: 1 }), /duplicate/i)
  assert.throws(() => patchSource(example + '\n::: col id=plot\nX\n:::\n', 'plot', { dx: 1 }), /duplicate/i)
  assert.throws(() => patchSource(example, 'code', { dx: 1 }), /not found/i)
  for (const patch of [{ dx: Infinity }, { dy: 10001 }, { width: 0 }, { font: 401 }, { css: 'bad' }, { crop: [90, 0, 20, 100] }, { crop: [0, 0, 0, 100] }, { crop: '0,0,100,100' }]) {
    assert.throws(() => patchSource(example, 'plot', patch), /invalid|unsupported/i)
  }
  assert.throws(() => patchSource(example, 'plot', { height: 100 }), /height.*derived/i)
  assert.throws(() => patchSource(example, 'note', { crop: [0, 0, 100, 100] }), /only supported for figures/i)
  assert.throws(() => patchSource(example, 'plot', JSON.parse('{"__proto__":1}')), /unsupported/i)
})

test('crop bounds remain valid after numeric rounding', () => {
  assert.throws(() => patchSource(example, 'plot', { crop: [0.00025, 0, 99.99975, 100] }), /invalid crop/i)
  assert.match(patchSource(example, 'plot', { crop: [0.00005, 0, 99.99995, 100] }), /crop=0.0001,0,99.9999,100/)
})

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'marp-source-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'slides.md')
  await writeFile(file, example)
  return { store: new SourceStore(file), file, dir }
}

test('one edit makes one undo record, undo/redo restores exact source atomically', async t => {
  const { store, file, dir } = await fixture(t)
  const initial = await store.read()
  const edited = await store.edit({ hash: initial.hash, id: 'plot', patch: { dx: 21, dy: 9, width: 450 } })
  assert.equal(edited.history.canUndo, true)
  const undone = await store.undo({ hash: edited.hash })
  assert.equal(undone.source, example)
  assert.equal(undone.history.canUndo, false)
  assert.equal(undone.history.canRedo, true)
  const redone = await store.redo({ hash: undone.hash })
  assert.equal(redone.source, edited.source)
  assert.equal(await readFile(file, 'utf8'), edited.source)
  assert.deepEqual(await readdir(dir), ['slides.md'])
})

test('no-op edits create no history; a new edit clears redo', async t => {
  const { store } = await fixture(t)
  const a = await store.read()
  const unchanged = await store.edit({ hash: a.hash, id: 'plot', patch: { width: 420 } })
  assert.equal(unchanged.history.canUndo, false)
  const b = await store.edit({ hash: a.hash, id: 'plot', patch: { dx: 1 } })
  const c = await store.undo({ hash: b.hash })
  const d = await store.edit({ hash: c.hash, id: 'note', patch: { font: 18 } })
  assert.equal(d.history.canRedo, false)
})

test('serialized concurrent edits reject a stale hash without losing the first edit', async t => {
  const { store } = await fixture(t)
  const a = await store.read()
  const results = await Promise.allSettled([
    store.edit({ hash: a.hash, id: 'plot', patch: { dx: 1 } }),
    store.edit({ hash: a.hash, id: 'plot', patch: { dx: 2 } })
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[1].reason.code, 'CONFLICT')
  assert.match((await store.read()).source, /dx=1\n/)
})

test('external edits reject stale writes and undo even after reading the new hash', async t => {
  const { store, file } = await fixture(t)
  const a = await store.read()
  const b = await store.edit({ hash: a.hash, id: 'plot', patch: { dx: 1 } })
  const outside = b.source + '\nExternal paragraph.\n'
  await writeFile(file, outside)
  await assert.rejects(store.edit({ hash: b.hash, id: 'plot', patch: { dx: 2 } }), { code: 'CONFLICT' })
  await assert.rejects(store.undo({ hash: b.hash }), { code: 'CONFLICT' })
  const fresh = await store.read()
  assert.equal(fresh.history.canUndo, false)
  await assert.rejects(store.undo({ hash: fresh.hash }), { code: 'CONFLICT' })
  assert.equal(await readFile(file, 'utf8'), outside)
  const resumed = await store.edit({ hash: fresh.hash, id: 'plot', patch: { dx: 3 } })
  const undoResumed = await store.undo({ hash: resumed.hash })
  assert.equal(undoResumed.source, outside)
})

test('HTTP writes require the local UI token and origin, and return guarded history', async t => {
  const { file } = await fixture(t)
  const app = await createDraftServer({ file, port: 0, renderer: async path => {
    const source = await readFile(path, 'utf8')
    return { source, hash: hashSource(source), html: '', css: '', diagnostics: [] }
  } })
  t.after(() => app.close())
  const initial = await (await fetch(app.url + '/api/deck')).json()
  const body = JSON.stringify({ hash: initial.hash, id: 'plot', patch: { dx: 10 } })
  const rejected = await fetch(app.url + '/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body })
  assert.equal(rejected.status, 403)
  assert.equal(await readFile(file, 'utf8'), example)
  const html = await (await fetch(app.url)).text()
  const token = /name="editor-token" content="([^"]+)"/.exec(html)[1]
  const headers = { 'Content-Type': 'application/json', Origin: app.url, 'X-Editor-Token': token }
  const edited = await (await fetch(app.url + '/api/edit', { method: 'POST', headers, body })).json()
  assert.equal(edited.history.canUndo, true)
  assert.match(edited.source, /dx=10/)
  const stale = await fetch(app.url + '/api/edit', { method: 'POST', headers, body })
  assert.equal(stale.status, 409)
  const undone = await (await fetch(app.url + '/api/undo', { method: 'POST', headers, body: JSON.stringify({ hash: edited.hash }) })).json()
  assert.equal(undone.source, example)
  const wrongOriginWithToken = await fetch(app.url + '/api/edit', { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body })
  assert.equal(wrongOriginWithToken.status, 403)
  assert.equal((await fetch(app.url + '/vendor/moveable.min.js')).status, 200)
})
