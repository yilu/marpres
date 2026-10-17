import assert from 'node:assert/strict'
import test from 'node:test'
import { boundPoint, hitStroke } from '../presenter/geometry.mjs'

test('presentation geometry exports bounded points and stroke hit testing', () => {
  assert.equal(typeof boundPoint, 'function')
  assert.equal(typeof hitStroke, 'function')
})

test('points are clamped to the 1280×720 slide and invalid input is rejected', () => {
  assert.deepEqual(boundPoint({ x: -12, y: 999 }), { x: 0, y: 720 })
  assert.deepEqual(boundPoint({ x: 640.5, y: 360.25 }), { x: 640.5, y: 360.25 })
  for (const point of [null, {}, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '4', y: 2 }]) assert.equal(boundPoint(point), null)
})

test('eraser hits the full line segment rather than only sampled points', () => {
  const stroke = { tool: 'pen', width: 4, points: [[100, 100], [500, 100]] }
  assert.equal(hitStroke(stroke, { x: 300, y: 119 }, 18), true)
  assert.equal(hitStroke(stroke, { x: 300, y: 121 }, 18), false)
  assert.equal(hitStroke(stroke, { x: 80, y: 100 }, 18), true)
  assert.equal(hitStroke(stroke, { x: 79, y: 100 }, 18), false)
})

test('diagonal and highlighter width contribute to the hit distance', () => {
  assert.equal(hitStroke({ width: 2, points: [[0, 0], [100, 100]] }, { x: 50, y: 50 }, 0), true)
  assert.equal(hitStroke({ tool: 'highlighter', width: 30, points: [[100, 200], [500, 200]] }, { x: 300, y: 232 }, 18), true)
  assert.equal(hitStroke({ tool: 'highlighter', width: 30, points: [[100, 200], [500, 200]] }, { x: 300, y: 234 }, 18), false)
})

test('short taps and repeated points remain erasable', () => {
  for (const points of [[[400, 300]], [[400, 300], [400, 300]]]) {
    assert.equal(hitStroke({ width: 6, points }, { x: 420, y: 300 }, 18), true)
    assert.equal(hitStroke({ width: 6, points }, { x: 422, y: 300 }, 18), false)
  }
})

test('outside-view and malformed eraser input cannot remove strokes', () => {
  const stroke = { width: 10, points: [[0, 0], [1280, 720]] }
  for (const point of [{ x: -1, y: 0 }, { x: 1281, y: 720 }, { x: 0, y: -1 }, { x: 0, y: 721 }, null, { x: NaN, y: 4 }]) assert.equal(hitStroke(stroke, point, 18), false)
  assert.equal(hitStroke(stroke, { x: 0, y: 0 }, -1), false)
  assert.equal(hitStroke(stroke, { x: 0, y: 0 }, NaN), false)
  for (const bad of [null, {}, { points: [] }, { points: [[NaN, 1]] }, { width: Infinity, points: [[1, 1]] }]) assert.equal(hitStroke(bad, { x: 0, y: 0 }, 18), false)
})
