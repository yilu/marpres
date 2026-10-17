import MarkdownIt from 'markdown-it'
import { maskFrontMatter } from '../engine/source-syntax.mjs'
import { designBlockStart, designBlockEnd } from '../engine/design-system.mjs'
const parser = new MarkdownIt({ html: true })
const offsetsOf = source => {
  const offsets = [0]
  for (const line of source.split('\n')) offsets.push(offsets.at(-1) + line.length + 1)
  return offsets
}
const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID', status: 400 }) }

export function findDeckDesignBlock(source) {
  const tokens = parser.parse(maskFrontMatter(source), {}), offsets = offsetsOf(source)
  const markers = tokens.filter(token => token.type === 'html_block' && [designBlockStart, designBlockEnd].includes(token.content.trim()))
  if (!markers.length) return null
  if (markers.length !== 2 || markers[0].content.trim() !== designBlockStart || markers[1].content.trim() !== designBlockEnd) invalid('The managed theme block is incomplete or duplicated. Restore its begin and end markers before editing the theme.')
  return { start: offsets[markers[0].map[0]], end: Math.min(source.length, offsets[markers[1].map[1]]) }
}
