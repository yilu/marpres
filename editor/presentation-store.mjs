import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import { renderSource } from '../scripts/render.mjs'
import { mapSource, SourceError } from './source-store.mjs'
import { readNotes, renderNotes, stripNotes } from './notes.mjs'

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function renderedStages(html) {
  const sections = [], rawText = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'])
  // Keep quoted > characters, comments, and raw-text contents out of tag parsing.
  // Section depth allows authored nested sections without truncating a slide.
  const tags = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\/?([a-z][\w:-]*)(?=[\s/>])((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi
  let match, current, depth = 0
  while ((match = tags.exec(html))) {
    if (!match[1]) continue
    const name = match[1].toLowerCase(), closing = match[0].startsWith('</')
    if (closing) {
      if (name === 'section' && current && --depth === 0) current = null
      continue
    }
    const attributes = new Map()
    for (const attribute of match[2].matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const key = attribute[1].toLowerCase()
      if (!attributes.has(key)) attributes.set(key, attribute[2] ?? attribute[3] ?? attribute[4] ?? '')
    }
    if (current && attributes.has('data-stage')) {
      const stage = Number(attributes.get('data-stage'))
      if (Number.isInteger(stage) && stage >= 0) current.stages.add(stage)
    }
    if (name === 'section') {
      if (current) depth++
      else if (attributes.has('data-source-slide')) {
        current = { slide: Number(attributes.get('data-source-slide')), stages: new Set([0]) }
        sections.push(current); depth = 1
      }
    }
    if (rawText.has(name)) {
      const end = new RegExp(`</${name}\\s*>`, 'gi')
      end.lastIndex = tags.lastIndex
      tags.lastIndex = end.exec(html) ? end.lastIndex : html.length
    }
  }
  return sections.map(section => ({ slide: section.slide, stages: [...section.stages].sort((a, b) => a - b) }))
}

export class PresentationStore {
  constructor(store, { render = renderSource, limit = 12 } = {}) {
    this.store = store
    this.render = render
    this.limit = limit
    this.sessions = new Map()
  }

  create({ hash, slide = 1 }) {
    return this.store.serialize(async () => {
      const current = await this.store.guarded(hash)
      if ([...this.sessions.values()].filter(session => !session.ended).length >= this.limit) throw new SourceError('Too many active presentations. End a presenter session before starting another.', 'SESSION_LIMIT', 409)
      const mapping = mapSource(current.source)
      if (!Number.isInteger(slide) || !mapping.slides[slide - 1]) throw new SourceError('Choose a valid starting slide.')
      const notes = readNotes(current.source).map(text => ({ text, html: renderNotes(text) }))
      const rendered = await this.render(stripNotes(current.source), { baseDir: dirname(this.store.file), draft: false })
      await this.store.guarded(current.hash)
      const errors = (rendered.diagnostics ?? []).filter(item => item.severity === 'error')
      if (errors.length) throw new SourceError(`Cannot present this deck: ${errors.map(item => item.message).join('; ')}`)
      // Use effective descendant stages, as the editor and PDF do. Authored
      // section data-stages can include a child stage hidden by its parent.
      const sections = renderedStages(rendered.html)
      if (sections.length !== mapping.slides.length || sections.some((section, index) => section.slide !== index + 1)) throw new SourceError('Rendered slides do not match the source. Reload and check the deck.')
      const slides = mapping.slides.map(({ slide, title }, index) => ({ slide, title, stages: sections[index].stages }))
      const id = randomUUID()
      const key = randomBytes(32).toString('hex')
      const audience = freeze({ id, title: slides[0]?.title ?? 'Presentation', html: rendered.html.replace(/<!--[\s\S]*?-->/g, ''), css: rendered.css, hash: current.hash, startSlide: slide, slides })
      this.sessions.set(id, { key, audience, presenter: freeze({ ...audience, notes }) })
      return { id, presenterUrl: `/presenter?session=${id}#key=${key}`, audienceUrl: `/audience?session=${id}` }
    })
  }

  session(id) {
    const session = this.sessions.get(id)
    if (!session) throw new SourceError('This presentation is no longer available. Start a new session from the editor.', 'NOT_FOUND', 404)
    if (session.ended) throw new SourceError('This presentation has ended. Start a new session from the editor.', 'ENDED', 410)
    return session
  }

  authorize(session, key) {
    const supplied = Buffer.from(String(key ?? '')), expected = Buffer.from(session.key)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new SourceError('Open the presenter console from its private editor link.', 'FORBIDDEN', 403)
  }

  get(id, role, key) {
    if (!['presenter', 'audience'].includes(role)) throw new SourceError('Choose the presenter or audience role.')
    const session = this.session(id)
    if (role === 'presenter') this.authorize(session, key)
    return session[role]
  }

  end(id, key) {
    const session = this.session(id)
    this.authorize(session, key)
    this.sessions.set(id, { ended: true })
    return { ended: true }
  }
}
