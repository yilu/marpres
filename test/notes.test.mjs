import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readNotes, patchNotes, stripNotes } from '../editor/notes.mjs'
import { SourceStore, mapSource } from '../editor/source-store.mjs'

const source = '---\nmarp: true\n---\n# First\n\n<!-- _class: lead -->\n<!-- Ordinary comment -->\n<!-- notes\nFirst **private** note\n\n---\nNot a slide\n-->\n\n```md\n<!-- notes\nLiteral example\n-->\n---\n```\n\n---\n# Second\n'

test('notes follow logical slide boundaries while fenced examples and generic comments stay literal', () => {
  assert.deepEqual(readNotes(source), ['First **private** note\n\n---\nNot a slide', ''])
  const changed = patchNotes(source, 1, 'Replacement\n\n- next')
  assert.equal(changed, source.replace('First **private** note\n\n---\nNot a slide', 'Replacement\n\n- next'))
  assert.equal(mapSource(changed).slides.length, 2)
  assert.match(stripNotes(source), /Literal example/)
  assert.doesNotMatch(stripNotes(source), /First \*\*private\*\* note/)
})

test('adding and removing notes preserves unrelated bytes and CRLF', () => {
  const original = source.replaceAll('\n', '\r\n')
  const added = patchNotes(original, 2, 'Second note\nmore')
  assert.ok(added.startsWith(original))
  assert.deepEqual(readNotes(added), ['First **private** note\n\n---\nNot a slide', 'Second note\nmore'])
  assert.doesNotMatch(added, /(?<!\r)\n/)
  const removed = patchNotes(original, 1, '')
  assert.equal(removed, original.replace('<!-- notes\r\nFirst **private** note\r\n\r\n---\r\nNot a slide\r\n-->', ''))
  assert.equal(patchNotes(source, 2, ''), source)
  assert.throws(() => patchNotes(source, 2, 'Escape --> comment'), /terminator/i)
  assert.throws(() => patchNotes(source, 0, 'bad'), /slide/i)
  assert.throws(() => patchNotes(source, 3, 'bad'), /slide/i)
})

test('note writes are guarded atomic mutations with one undo and redo', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'marpres-notes-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'deck.md'); await writeFile(file, source)
  const store = new SourceStore(file), initial = await store.read()
  const changed = await store.mutate(initial.hash, text => patchNotes(text, 2, 'New note'))
  assert.deepEqual(readNotes(changed.source), [readNotes(source)[0], 'New note'])
  await assert.rejects(store.mutate(initial.hash, text => patchNotes(text, 1, 'Stale')), { code: 'CONFLICT' })
  assert.equal((await store.undo({ hash: changed.hash })).source, source)
  assert.equal((await store.redo({ hash: initial.hash })).source, changed.source)
})

test('notes inside YAML, code blocks, and ordinary comments are never managed', () => {
  const literal = '---\nmarp: true\nexample: |\n  <!-- notes\n  YAML\n  -->\n---\n# Slide\n\n    <!-- notes\n    Indented code\n    -->\n\n<!-- ordinary\n<!-- notes\nNested example\n-->\n'
  assert.deepEqual(readNotes(literal), [''])
  assert.equal(stripNotes(literal), literal)
})

test('duplicate or incomplete managed notes fail without guessing which comment to edit', () => {
  for (const notes of ['<!-- notes\nUnclosed', '<!-- notes -->', '<!-- notes\nWrong ending -->', '<!-- notes\nOne\n-->\n\n<!-- notes\nTwo\n-->']) {
    assert.throws(() => readNotes('# Slide\n\n' + notes), /notes/i)
  }
})

test('notes cannot be appended inside an unclosed literal block', () => {
  assert.throws(() => patchNotes('# Slide\n\n```text\nUnclosed example\n', 1, 'Private note'), /notes|close/i)
  const html = '# Slide\n\n<pre>\n<!-- notes\nHTML example\n-->\n</pre>\n'
  assert.deepEqual(readNotes(html), [''])
  assert.equal(stripNotes(html), html)
})
