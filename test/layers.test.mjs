import assert from 'node:assert/strict'
import { test } from 'node:test'

test('layer moves preserve relative order and move one step across ties', async () => {
  const module = await import('../editor/web/layers.js').catch(() => ({}))
  assert.equal(typeof module.reorderLayerIds, 'function', 'Layer ordering is implemented')
  const move = module.reorderLayerIds
  const ids = ['a', 'b', 'c', 'd', 'e'] // back to front
  assert.deepEqual(move(ids, ['b', 'd'], 'front'), ['a', 'c', 'e', 'b', 'd'])
  assert.deepEqual(move(ids, ['b', 'd'], 'back'), ['b', 'd', 'a', 'c', 'e'])
  assert.deepEqual(move(ids, ['b', 'c'], 'forward'), ['a', 'd', 'b', 'c', 'e'])
  assert.deepEqual(move(ids, ['c', 'd'], 'backward'), ['a', 'c', 'd', 'b', 'e'])
  assert.deepEqual(move(ids, ['a', 'c'], 'forward'), ['b', 'a', 'd', 'c', 'e'])
  assert.deepEqual(move(ids, ['b', 'd'], 'backward'), ['b', 'a', 'd', 'c', 'e'])
  assert.deepEqual(move(ids, ['e'], 'forward'), ids)
  assert.deepEqual(move(ids, ['a'], 'backward'), ids)
  assert.deepEqual(move(ids, ids, 'front'), ids)
  assert.deepEqual(move(ids, [], 'back'), ids)
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e'], 'Input order stays untouched')
})
