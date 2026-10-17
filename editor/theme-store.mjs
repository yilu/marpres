import { findDeckDesignBlock } from './design-block.mjs'
export { findDeckDesignBlock } from './design-block.mjs'
import MarkdownIt from 'markdown-it'
import { mapSource, SourceError } from './source-store.mjs'
import { maskFrontMatter } from '../engine/source-syntax.mjs'
import { designBlockStart, designBlockEnd, designMetadataPrefix, designSchemaVersion, normalizeDeckDesign, generateDesignCSS } from '../engine/design-system.mjs'

const parser = new MarkdownIt({ html: true })
const frontMatter = source => source.match(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || ''
const offsetsOf = source => {
  const offsets = [0]
  for (const line of source.split('\n')) offsets.push(offsets.at(-1) + line.length + 1)
  return offsets
}
const fail = message => { throw new SourceError(message) }


export function getDeckDesign(source) {
  const range = findDeckDesignBlock(source)
  if (!range) return normalizeDeckDesign()
  const block = source.slice(range.start, range.end)
  const metadata = block.split(/\r?\n/).find(line => line.startsWith(designMetadataPrefix))
  if (!metadata?.endsWith(' -->')) fail('The managed theme metadata is missing or invalid.')
  try {
    const saved = JSON.parse(metadata.slice(designMetadataPrefix.length, -4))
    if (saved.version !== designSchemaVersion) fail('This theme uses an unsupported design schema version.')
    return normalizeDeckDesign({ theme: saved.theme, css: saved.css })
  } catch (error) { fail(`Cannot read the managed theme: ${error.message}`) }
}

export function applyDeckDesign(source, input) {
  let design
  try { design = normalizeDeckDesign(input) } catch (error) { fail(error.message) }
  const range = findDeckDesignBlock(source), eol = source.includes('\r\n') ? '\r\n' : '\n'
  const saved = JSON.stringify({ version: designSchemaVersion, ...design }).replace(/[<>&]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const css = generateDesignCSS(design.theme) + design.css
  const block = [designBlockStart, `${designMetadataPrefix}${saved} -->`, '<style>', css.replace(/\r?\n/g, eol), '</style>', designBlockEnd, ''].join(eol)
  if (range) return source.slice(0, range.start) + block + source.slice(range.end)
  const position = frontMatter(source).length
  const prefix = source.slice(0, position)
  return prefix + (prefix && !prefix.endsWith('\n') ? eol : '') + block + source.slice(position)
}

function appearanceDirectives(source, slide) {
  const mapping = mapSource(source), target = mapping.slides[slide - 1]
  if (!Number.isInteger(slide) || !target) fail('Slide does not exist.')
  const offsets = offsetsOf(source), directives = []
  const start = offsets[target.startLine], end = Math.min(source.length, offsets[target.endLine])
  for (const token of parser.parse(maskFrontMatter(source), {})) {
    if (token.type !== 'html_block' || !token.map) continue
    const tokenStart = offsets[token.map[0]]
    if (tokenStart < start || tokenStart >= end) continue
    const raw = source.slice(tokenStart, Math.min(source.length, offsets[token.map[1]]))
    // Only complete comment tokens are directives; HTML, CSS and fenced examples remain literal.
    if (!/^\s*<!--[\s\S]*-->\s*$/.test(raw)) continue
    for (const comment of raw.matchAll(/<!--([\s\S]*?)-->/g)) {
      const body = comment[1], bodyStart = tokenStart + comment.index + 4
      const pattern = /(^|\n)([ \t]*_appearance[ \t]*:[ \t]*)([^\r\n]*?)([ \t]*\r?)(?=\n|$)/g
      for (const match of body.matchAll(pattern)) {
        const value = match[3].trim().replace(/^(['"])(.*)\1$/, '$2')
        directives.push({ value, valueStart: bodyStart + match.index + match[1].length + match[2].length, valueEnd: bodyStart + match.index + match[1].length + match[2].length + match[3].length,
          lineStart: bodyStart + match.index + match[1].length, lineEnd: bodyStart + match.index + match[0].length + (body[match.index + match[0].length] === '\n' ? 1 : 0),
          commentStart: tokenStart + comment.index, commentEnd: tokenStart + comment.index + comment[0].length,
          onlyDirective: body.replace(match[0], '').trim() === '',
        })
      }
    }
  }
  return { target, offsets, directives }
}

export function getSlideAppearance(source, slide) {
  const { directives } = appearanceDirectives(source, slide)
  const value = directives.at(-1)?.value || 'inherit'
  return ['light', 'dark'].includes(value) ? value : 'inherit'
}

export function setSlideAppearance(source, slide, appearance = 'inherit') {
  if (!['inherit', 'light', 'dark'].includes(appearance)) fail('Choose inherit, light, or dark appearance.')
  const { target, offsets, directives } = appearanceDirectives(source, slide)
  if (directives.length > 1) fail('This slide has multiple appearance directives. Keep one appearance directive before editing it.')
  const directive = directives[0]
  if (directive) {
    if (appearance !== 'inherit') return source.slice(0, directive.valueStart) + appearance + source.slice(directive.valueEnd)
    if (!directive.onlyDirective) return source.slice(0, directive.lineStart) + source.slice(directive.lineEnd)
    let end = directive.commentEnd
    if (source.slice(end, end + 2) === '\r\n') end += 2
    else if (source[end] === '\n') end++
    return source.slice(0, directive.commentStart) + source.slice(end)
  }
  if (appearance === 'inherit') return source
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  let position = target.slide === 1 ? frontMatter(source).length : offsets[target.startLine]
  const managed = findDeckDesignBlock(source)
  if (target.slide === 1 && managed && managed.start === position) position = managed.end
  const prefix = source.slice(0, position)
  return prefix + (prefix && !prefix.endsWith('\n') ? eol : '') + `<!-- _appearance: ${appearance} -->${eol}` + source.slice(position)
}
