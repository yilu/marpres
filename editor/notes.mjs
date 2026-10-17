import MarkdownIt from 'markdown-it'
import { maskFrontMatter } from '../engine/source-syntax.mjs'
import { mapSource, SourceError } from './source-store.mjs'

const parser = new MarkdownIt({ html: true })
const noteParser = new MarkdownIt({ html: false, breaks: true })
const offsetsOf = source => {
  const offsets = [0]
  for (const line of source.split('\n')) offsets.push(offsets.at(-1) + line.length + 1)
  return offsets
}

function managedNotes(source) {
  const slides = mapSource(source).slides, offsets = offsetsOf(source), ranges = []
  // Markdown tokens exclude YAML, fenced/indented examples, and inline code.
  // Match whole comments so a marker quoted inside a generic comment stays literal.
  for (const token of parser.parse(maskFrontMatter(source), {})) {
    if (token.type !== 'html_block' || !token.map || !/^[ \t]*<!--/.test(token.content)) continue
    const start = offsets[token.map[0]], end = Math.min(source.length, offsets[token.map[1]])
    for (const match of source.slice(start, end).matchAll(/<!--(?:[\s\S]*?-->|[\s\S]*$)/g)) {
      const note = /^<!--[ \t]*notes[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*-->$/.exec(match[0])
      const at = start + match.index
      const lineStart = source.lastIndexOf('\n', at - 1) + 1
      if (!/^[ \t]*$/.test(source.slice(lineStart, at))) continue
      if (!note) {
        if (/^<!--[ \t]*notes(?:[ \t]*(?:\r?\n|-->|$))/.test(match[0])) throw new SourceError('A notes comment is incomplete. Use <!-- notes on its own line, notes text, then --> on its own line.')
        continue
      }
      const slide = slides.find(item => at >= offsets[item.startLine] && at < offsets[item.endLine])?.slide
      if (!slide) continue
      if (ranges.some(range => range.slide === slide)) throw new SourceError(`Slide ${slide} contains more than one notes comment. Combine them before editing notes.`)
      ranges.push({ slide, start: at, end: at + match[0].length, text: note[1].replaceAll('\r\n', '\n') })
    }
  }
  return { slides, offsets, ranges }
}

export function readNotes(source) {
  const { slides, ranges } = managedNotes(source)
  return slides.map(slide => ranges.find(range => range.slide === slide.slide)?.text ?? '')
}

export function patchNotes(source, slide, notes) {
  if (typeof notes !== 'string' || notes.length > 64000) throw new SourceError('Notes must be text of at most 64000 characters.')
  if (notes.includes('-->')) throw new SourceError('Notes cannot contain the HTML comment terminator -->.')
  const { slides, offsets, ranges } = managedNotes(source), target = slides[slide - 1]
  if (!Number.isInteger(slide) || !target) throw new SourceError('Choose a valid slide for notes.')
  const existing = ranges.find(range => range.slide === slide)
  const text = notes.replaceAll('\r\n', '\n'), eol = source.includes('\r\n') ? '\r\n' : '\n'
  const comment = text.trim() ? `<!-- notes${eol}${text.replaceAll('\n', eol)}${eol}-->` : ''
  if (existing) return source.slice(0, existing.start) + comment + source.slice(existing.end)
  if (!comment) return source
  const position = Math.min(source.length, offsets[target.endLine])
  const before = source.slice(0, position), after = source.slice(position)
  const spacing = before.endsWith(eol + eol) ? '' : before.endsWith(eol) ? eol : eol + eol
  const changed = before + spacing + comment + eol + eol + after
  if (readNotes(changed)[slide - 1] !== text) throw new SourceError('Close any unfinished code or HTML block before adding notes.')
  return changed
}

export function stripNotes(source) {
  const { ranges } = managedNotes(source)
  for (const range of ranges.reverse()) source = source.slice(0, range.start) + source.slice(range.start, range.end).replace(/[^\r\n]/g, ' ') + source.slice(range.end)
  return source
}

export const renderNotes = text => noteParser.render(text)
