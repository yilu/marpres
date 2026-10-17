import test from 'node:test'
import assert from 'node:assert/strict'
import {jsonBody} from '../editor/server.mjs'
test('request decoding preserves Chinese and emoji across every byte boundary',async()=>{
 const value={content:'中文测试 😀',title:'图与文字'}
 const bytes=Buffer.from(JSON.stringify(value))
 for(let split=1;split<bytes.length;split++) {
  const chunks={async *[Symbol.asyncIterator](){yield bytes.subarray(0,split);yield bytes.subarray(split)}}
  assert.deepEqual(await jsonBody(chunks),value)
 }
})
