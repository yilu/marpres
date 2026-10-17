import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceStore } from '../editor/source-store.mjs'
import { PresentationStore } from '../editor/presentation-store.mjs'
import { renderSource } from '../scripts/render.mjs'

const source = '# First\n\n<!-- notes\nPRIVATE-TEST-NOTE **bold** <script>alert(1)</script>\n-->\n\n::: box id=body stage=3\nReveal\n:::\n\n---\n# Second\n\n::: box stage=8\nLast\n:::\n'
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'marpres-session-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'deck.md'); await writeFile(file, source)
  const store = new SourceStore(file), initial = await store.read()
  return { dir, file, store, initial }
}

test('immutable snapshots contain cumulative stage metadata and presenter-only safe notes', async t => {
  const { dir, file, store, initial } = await fixture(t)
  const sessions = new PresentationStore(store)
  const result = await sessions.create({ hash: initial.hash, slide: 2 })
  assert.match(result.presenterUrl, /^\/presenter\?session=/)
  assert.match(result.audienceUrl, /^\/audience\?session=/)
  const key = new URL(result.presenterUrl, 'http://localhost').hash.slice(5)
  assert.ok(key.length >= 32)
  assert.throws(() => sessions.get(result.id, 'presenter'), { code: 'FORBIDDEN' })
  assert.throws(() => sessions.get(result.id, 'presenter', 'wrong'), { code: 'FORBIDDEN' })
  const presenter = sessions.get(result.id, 'presenter', key), audience = sessions.get(result.id, 'audience')
  assert.equal(presenter.startSlide, 2)
  assert.deepEqual(presenter.slides, [{ slide: 1, title: 'First', stages: [0, 3] }, { slide: 2, title: 'Second', stages: [0, 8] }])
  assert.equal((audience.html.match(/data-marpit-svg=/g) || []).length, 2)
  assert.match(presenter.notes[0].html, /<strong>bold<\/strong>/)
  assert.doesNotMatch(presenter.notes[0].html, /<script>/)
  assert.deepEqual(Object.keys(audience).sort(), ['id', 'title', 'html', 'css', 'hash', 'startSlide', 'slides'].sort())
  assert.doesNotMatch(JSON.stringify(audience), /PRIVATE-TEST-NOTE|<!-- notes|sourcePath|editor-token/)
  assert.equal(await readFile(file, 'utf8'), source)
  assert.deepEqual((await store.read()).history, initial.history)
  assert.deepEqual(await readdir(dir), ['deck.md'])
  await store.edit({ hash: initial.hash, id: 'body', patch: { font: 30 } })
  assert.deepEqual(sessions.get(result.id, 'presenter', key), presenter)
  assert.throws(() => { presenter.slides[0].stages.push(99) }, TypeError)
  assert.throws(() => sessions.get(result.id, 'unknown'), { code: 'INVALID' })
})

test('snapshots reject stale hashes, missing slides, diagnostics, and a change during rendering', async t => {
  const { store, file, initial } = await fixture(t)
  const sessions = new PresentationStore(store)
  await assert.rejects(sessions.create({ hash: 'stale', slide: 1 }), { code: 'CONFLICT' })
  for (const slide of [0, 3, 1.5, '1']) await assert.rejects(sessions.create({ hash: initial.hash, slide }), { code: 'INVALID' })
  const bad = new PresentationStore(store, { render: async () => ({ diagnostics: [{ severity: 'error', message: 'Missing asset' }] }) })
  await assert.rejects(bad.create({ hash: initial.hash, slide: 1 }), /Missing asset/)
  const racing = new PresentationStore(store, { render: async (...args) => { const result = await renderSource(...args); await writeFile(file, '# External edit\n'); return result } })
  await assert.rejects(racing.create({ hash: initial.hash, slide: 1 }), { code: 'CONFLICT' })
  assert.equal(await readFile(file, 'utf8'), '# External edit\n')
})

test('snapshot limit preserves active sessions and ending frees a slot without altering source', async t => {
  const { store, initial } = await fixture(t), sessions = new PresentationStore(store, { limit: 2 })
  const first = await sessions.create({ hash: initial.hash, slide: 1 })
  const second = await sessions.create({ hash: initial.hash, slide: 2 })
  await assert.rejects(sessions.create({ hash: initial.hash, slide: 1 }), { code: 'SESSION_LIMIT' })
  assert.throws(() => sessions.end(first.id, 'wrong'), { code: 'FORBIDDEN' })
  const key = new URL(first.presenterUrl, 'http://localhost').hash.slice(5)
  assert.deepEqual(sessions.end(first.id, key), { ended: true })
  assert.throws(() => sessions.get(first.id, 'audience'), { code: 'ENDED', status: 410 })
  const third = await sessions.create({ hash: initial.hash, slide: 1 })
  assert.notEqual(second.id, third.id)
  assert.equal(sessions.get(second.id, 'audience').startSlide, 2)
  assert.deepEqual((await store.read()).history, initial.history)
})

test('snapshot reveals use effective rendered stages inherited from enclosing objects', async t => {
  const { store, file } = await fixture(t)
  await writeFile(file, '# A\n\n::: box id=parent stage=3\n::: shape id=child shape=rect stage=1\n:::\n:::\n\n---\n# Ordinary\n')
  const initial = await store.read(), sessions = new PresentationStore(store)
  const created = await sessions.create({ hash: initial.hash, slide: 1 })
  const snapshot = sessions.get(created.id, 'audience')
  assert.match(snapshot.html, /data-stages="0,1,3"/, 'Fixture has authored stage metadata that differs from the effective reveal sequence')
  assert.deepEqual(snapshot.slides.map(slide => slide.stages), [[0, 3], [0]])
})

test('rendered stage extraction handles nested sections and quoted HTML while skipping literal tag text', async t => {
  const { store, file } = await fixture(t)
  await writeFile(file, '# Raw HTML\n\n<section data-stage="2">\n<section data-stage=4><p title=\'data-stage="99" >\'>Nested</p></section>\n<p data-stage=6>After nested section</p>\n<script>const example = \'</section><p data-stage="88">\';</script>\n<style>.example:before { content: \'<p data-stage="77">\'; }</style>\n<!-- <p data-stage="66"> -->\n</section>\n\n---\n# Ordinary\n')
  const initial = await store.read(), sessions = new PresentationStore(store)
  const created = await sessions.create({ hash: initial.hash, slide: 1 })
  assert.deepEqual(sessions.get(created.id, 'audience').slides.map(slide => slide.stages), [[0, 2, 4, 6], [0]])
})
