import container from 'markdown-it-container'
import marpitPlugin from '@marp-team/marpit/plugin.js'

const BLOCKS = ['top', 'col', 'bottom', 'caption', 'ref', 'footer']
const ALIGNMENTS = new Set(['left', 'center', 'right'])
const VALIGNMENTS = new Set(['start', 'center', 'end', 'stretch'])

function parseLayout(value) {
  const source = String(value ?? '').trim()
  if (source === '') return {}

  const [kind, ...rest] = source.split(/\s+/)

  if (kind === 'single') {
    if (rest.length > 0) return {}
    return { layout: 'single' }
  }

  if (kind === 'cols') {
    if (rest.length === 0) return {}

    const widths = rest.map((part) => Number(part))

    if (widths.some((part) => !Number.isFinite(part) || part <= 0)) return {}

    return { layout: 'cols', layoutCols: widths.map((part) => `${part}fr`).join(' ') }
  }

  if (kind === 'grid') {
    if (rest.length < 1) return {}

    const match = /^(\d+)x(\d+)$/i.exec(rest[0] ?? '')

    if (!match) return {}

    const [, rows, cols] = match
    const rowCount = Number(rows)
    const colCount = Number(cols)

    if (rowCount <= 0 || colCount <= 0) return {}

    const args = rest.slice(1)
    const slashIndex = args.indexOf('/')
    const colArgs = slashIndex === -1 ? args : args.slice(0, slashIndex)
    const rowArgs = slashIndex === -1 ? [] : args.slice(slashIndex + 1)

    const result = {
      layout: 'grid',
      grid: `${rows}x${cols}`,
      layoutGridRows: rows,
      layoutGridCols: cols
    }

    if (colArgs.length > 0) {
      if (colArgs.length !== colCount) return {}
      const widths = colArgs.map((part) => Number(part))
      if (widths.some((w) => !Number.isFinite(w) || w <= 0)) return {}
      result.layoutCols = widths.map((w) => `${w}fr`).join(' ')
    }

    if (rowArgs.length > 0) {
      if (rowArgs.length !== rowCount) return {}
      const heights = rowArgs.map((part) => Number(part))
      if (heights.some((h) => !Number.isFinite(h) || h <= 0)) return {}
      result.layoutRows = heights.map((h) => `${h}fr`).join(' ')
    }

    return result
  }

  return {}
}

function parseCaptionAlign(value) {
  const source = String(value ?? '').trim().toLowerCase()
  if (!ALIGNMENTS.has(source)) return {}
  return { captionAlign: source }
}

function parseValign(value) {
  const source = String(value ?? '').trim().toLowerCase()
  if (!VALIGNMENTS.has(source)) return {}
  return { valign: source }
}

function createWrapperToken(state, type, tag, nesting, level, attrs = {}) {
  const token = new state.Token(type, tag, nesting)
  token.block = true
  token.level = level

  for (const [name, value] of Object.entries(attrs)) {
    token.attrSet(name, value)
  }

  return token
}

function findMatchingContainer(tokens, start) {
  if (!tokens[start]?.type?.endsWith('_open')) {
    throw new Error(`Expected container opening token at index ${start}`)
  }

  const openType = tokens[start].type
  const closeType = openType.replace(/_open$/, '_close')
  let depth = 0

  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].type === openType) depth += 1
    if (tokens[index].type === closeType) depth -= 1

    if (depth === 0) return index
  }

  throw new Error(`Unmatched container token: ${openType} at index ${start}`)
}

function findTopLevelColRegion(slideTokens, startLevel) {
  let firstCol = -1
  let lastCol = -1

  for (let index = 1; index < slideTokens.length - 1; index += 1) {
    const token = slideTokens[index]

    if (token.level !== startLevel) continue
    if (token.type !== 'container_col_open') continue

    if (firstCol === -1) {
      firstCol = index
    }

    lastCol = findMatchingContainer(slideTokens, index)
    index = lastCol
  }

  return { firstCol, lastCol }
}

function findLeadingTopRegion(slideTokens, startLevel, limit) {
  let firstTop = -1
  let lastTop = -1

  for (let index = 1; index < limit; index += 1) {
    const token = slideTokens[index]
    if (token.level !== startLevel) continue
    if (token.type !== 'container_top_open') continue

    if (firstTop === -1) firstTop = index
    lastTop = findMatchingContainer(slideTokens, index)
    index = lastTop
  }

  return { firstTop, lastTop }
}

function findTrailingSharedRegion(slideTokens, startLevel, start) {
  let firstShared = -1
  let lastShared = -1
  let cursor = start

  while (cursor < slideTokens.length - 1) {
    const token = slideTokens[cursor]
    if (token?.level !== startLevel) break
    if (
      token.type !== 'container_bottom_open' &&
      token.type !== 'container_caption_open' &&
      token.type !== 'container_ref_open'
    ) {
      break
    }

    if (firstShared === -1) firstShared = cursor
    lastShared = findMatchingContainer(slideTokens, cursor)
    cursor = lastShared + 1
  }

  return { firstShared, lastShared }
}

function isLayoutChildOpen(token) {
  return token?.type === 'container_caption_open' || token?.type === 'container_ref_open'
}

function isTopLevelLayoutBlockOpen(token, startLevel) {
  return (
    token?.level === startLevel &&
    (token.type === 'container_top_open' ||
      token.type === 'container_bottom_open' ||
      token.type === 'container_caption_open' ||
      token.type === 'container_ref_open' ||
      token.type === 'container_footer_open')
  )
}

function isStrayCloserParagraph(tokens, index) {
  return (
    tokens[index]?.type === 'paragraph_open' &&
    tokens[index + 1]?.type === 'inline' &&
    tokens[index + 1]?.content.trim() === ':::' &&
    tokens[index + 2]?.type === 'paragraph_close'
  )
}

function getFenceInstruction(line) {
  const trimmed = line.trim()
  const openMatch = /^:::\s*(top|col|bottom|caption|ref|footer)(?:\s+.+)?$/i.exec(trimmed)

  if (openMatch) {
    return { type: 'open', name: openMatch[1].toLowerCase() }
  }

  if (trimmed === ':::') {
    return { type: 'close' }
  }

  return null
}

function getContainerArgs(info, block) {
  const parts = String(info ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts[0]?.toLowerCase() !== block) return []
  return parts.slice(1).map((part) => part.toLowerCase())
}

export function parseRange(part) {
  const match = /^(\d+)(?:-(\d+))?$/.exec(part)
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] != null ? Number(match[2]) : start
  if (start <= 0 || end <= 0 || end < start) return null
  return { start, end }
}

export function parseColSpan(args) {
  const spanArg = args.find((arg) => /^\d+(?:-\d+)?,\d+(?:-\d+)?$/.test(arg))
  if (!spanArg) return null

  const [rowPart, colPart] = spanArg.split(',')
  const rowRange = parseRange(rowPart)
  const colRange = parseRange(colPart)

  if (!rowRange || !colRange) return null

  return { rowStart: rowRange.start, rowEnd: rowRange.end, colStart: colRange.start, colEnd: colRange.end }
}

export function buildIgnoredLineSet(tokens) {
  const ignored = new Set()

  for (const token of tokens) {
    if (!['fence', 'code_block', 'html_block'].includes(token.type)) continue
    if (!Array.isArray(token.map)) continue

    for (let lineIndex = token.map[0]; lineIndex < token.map[1]; lineIndex += 1) {
      ignored.add(lineIndex)
    }
  }

  return ignored
}

export function colIsStillOpenAtCandidateStart(lines, ignoredLines, colStartLine, candidateStartLine) {
  if (!Number.isInteger(colStartLine) || !Number.isInteger(candidateStartLine)) return false
  if (candidateStartLine <= colStartLine) return false

  const stack = []

  for (let lineIndex = colStartLine; lineIndex < candidateStartLine; lineIndex += 1) {
    if (ignoredLines.has(lineIndex)) continue

    const instruction = getFenceInstruction(lines[lineIndex] ?? '')

    if (!instruction) continue

    if (instruction.type === 'open') {
      stack.push(instruction.name)
      continue
    }

    if (instruction.type === 'close' && stack.length > 0) {
      stack.pop()
    }
  }

  return stack.at(-1) === 'col'
}

function appendStyle(token, declarations) {
  const current = token.attrGet('style')?.trim()
  const parts = []

  if (current) parts.push(current.replace(/;$/, ''))
  parts.push(...declarations.filter(Boolean).map((value) => value.replace(/;$/, '')))

  if (parts.length > 0) token.attrSet('style', `${parts.join('; ')};`)
}

function applySlideMetadata(token) {
  const directives = token.meta?.marpitDirectives ?? {}

  if (directives.layout) token.attrSet('data-layout', directives.layout)
  if (directives.grid) token.attrSet('data-grid', directives.grid)
  if (directives.captionAlign) token.attrSet('data-caption-align', directives.captionAlign)
  if (directives.valign) token.attrSet('data-valign', directives.valign)

  appendStyle(token, [
    directives.layoutCols ? `--layout-cols: ${directives.layoutCols}` : '',
    directives.layoutGridRows ? `--layout-grid-rows: ${directives.layoutGridRows}` : '',
    directives.layoutGridCols ? `--layout-grid-cols: ${directives.layoutGridCols}` : '',
    directives.layoutRows ? `--layout-rows: ${directives.layoutRows}` : '',
    directives.captionAlign ? `--layout-caption-align: ${directives.captionAlign}` : '',
    directives.valign ? `--layout-valign: ${directives.valign}` : ''
  ])
}

function repairColumnChildren(slideTokens, lines, ignoredLines) {
  for (let index = 1; index < slideTokens.length - 1; index += 1) {
    if (slideTokens[index].type !== 'container_col_open') continue

    const colOpen = slideTokens[index]
    const colClose = findMatchingContainer(slideTokens, index)
    let cursor = colClose + 1
    const candidateBlocks = []

    while (isLayoutChildOpen(slideTokens[cursor])) {
      const blockClose = findMatchingContainer(slideTokens, cursor)
      candidateBlocks.push({ start: cursor, end: blockClose })
      cursor = blockClose + 1
    }

    if (candidateBlocks.length === 0 && isStrayCloserParagraph(slideTokens, cursor)) {
      if (
        colIsStillOpenAtCandidateStart(
          lines,
          ignoredLines,
          colOpen.map?.[0],
          slideTokens[cursor].map?.[0]
        )
      ) {
        while (isStrayCloserParagraph(slideTokens, colClose + 1)) {
          slideTokens.splice(colClose + 1, 3)
        }
      }

      continue
    }

    if (candidateBlocks.length === 0 || !isStrayCloserParagraph(slideTokens, cursor)) continue
    if (
      !colIsStillOpenAtCandidateStart(
        lines,
        ignoredLines,
        colOpen.map?.[0],
        slideTokens[candidateBlocks[0].start].map?.[0]
      )
    ) continue

    const moved = []
    let removed = 0

    for (const { start, end } of candidateBlocks) {
      const adjustedStart = start - removed
      const adjustedEnd = end - removed
      const blockTokens = slideTokens.splice(adjustedStart, adjustedEnd - adjustedStart + 1)

      for (const blockToken of blockTokens) {
        blockToken.level += 1
      }

      moved.push(...blockTokens)
      removed += adjustedEnd - adjustedStart + 1
    }

    while (isStrayCloserParagraph(slideTokens, colClose + 1)) {
      slideTokens.splice(colClose + 1, 3)
    }

    slideTokens.splice(colClose, 0, ...moved)
    index = colClose + moved.length
  }
}

function wrapLayoutBody(state) {
  const wrapped = []
  const tokens = state.tokens
  const lines = state.src.split(/\r?\n/)
  const ignoredLines = buildIgnoredLineSet(tokens)

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token.type !== 'marpit_slide_open') {
      wrapped.push(token)
      continue
    }

    const slideLevel = token.level
    const slideTokens = [token]
    index += 1

    while (index < tokens.length) {
      slideTokens.push(tokens[index])
      if (tokens[index].type === 'marpit_slide_close') break
      index += 1
    }

    applySlideMetadata(slideTokens[0])
    repairColumnChildren(slideTokens, lines, ignoredLines)

    const startLevel = slideLevel + 1
    const { firstCol, lastCol } = findTopLevelColRegion(slideTokens, startLevel)

    if (firstCol === -1 || lastCol === -1) {
      wrapped.push(...slideTokens)
      continue
    }

    const { firstTop, lastTop } = findLeadingTopRegion(slideTokens, startLevel, firstCol)
    const { firstShared, lastShared } = findTrailingSharedRegion(slideTokens, startLevel, lastCol + 1)
    const stackStart = firstTop !== -1 ? firstTop : firstCol
    const stackEnd = lastShared !== -1 ? lastShared : lastCol

    const stackTokens = [
      createWrapperToken(state, 'layout_stack_open', 'div', 1, startLevel, {
        class: 'layout-stack'
      })
    ]
    let cursor = stackStart
    let bodyIsOpen = false

    const openBody = () => {
      stackTokens.push(
        createWrapperToken(state, 'layout_body_open', 'div', 1, startLevel, {
          class: 'layout-body'
        })
      )
      bodyIsOpen = true
    }

    const closeBody = () => {
      stackTokens.push(createWrapperToken(state, 'layout_body_close', 'div', -1, startLevel))
      bodyIsOpen = false
    }

    while (cursor <= stackEnd) {
      const token = slideTokens[cursor]

      if (isTopLevelLayoutBlockOpen(token, startLevel)) {
        if (bodyIsOpen) closeBody()

        do {
          const blockClose = findMatchingContainer(slideTokens, cursor)
          stackTokens.push(...slideTokens.slice(cursor, blockClose + 1))
          cursor = blockClose + 1
        } while (cursor <= stackEnd && isTopLevelLayoutBlockOpen(slideTokens[cursor], startLevel))

        if (cursor <= stackEnd) openBody()
        continue
      }

      if (!bodyIsOpen) openBody()
      stackTokens.push(token)
      cursor += 1
    }

    if (bodyIsOpen) closeBody()
    stackTokens.push(createWrapperToken(state, 'layout_stack_close', 'div', -1, startLevel))

    wrapped.push(...slideTokens.slice(0, stackStart), ...stackTokens, ...slideTokens.slice(stackEnd + 1))
  }

  state.tokens = wrapped
}

const layoutEngine = marpitPlugin((md) => {
  for (const block of BLOCKS) {
    md.use(container, block, {
      render(tokens, idx) {
        const token = tokens[idx]
        const classes = [`layout-${block}`]
        const styles = []

        if (token.nesting === 1 && (block === 'caption' || block === 'top' || block === 'bottom')) {
          const align = getContainerArgs(token.info, block).find((value) => ALIGNMENTS.has(value))
          if (align) classes.push(`align-${align}`)
        }

        if (token.nesting === 1 && block === 'col') {
          const args = getContainerArgs(token.info, block)
          const span = parseColSpan(args)
          if (span) {
            styles.push(`--col-row: ${span.rowStart} / ${span.rowEnd + 1}`)
            styles.push(`--col-col: ${span.colStart} / ${span.colEnd + 1}`)
          }
        }

        if (token.nesting !== 1) return '</div>'

        const styleAttr = styles.length > 0 ? ` style="${styles.join('; ')};"` : ''
        return `<div class="${classes.join(' ')}"${styleAttr}>`
      }
    })
  }

  md.marpit.customDirectives.local.layout = (value) => parseLayout(value)
  md.marpit.customDirectives.local.caption_align = (value) => parseCaptionAlign(value)
  md.marpit.customDirectives.local.valign = (value) => parseValign(value)

  md.core.ruler.after('marpit_directives_apply', 'marp_layout_body', (state) => {
    if (state.inlineMode) return
    wrapLayoutBody(state)
  })
})

export default layoutEngine
