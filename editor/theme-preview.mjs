import { dirname } from 'node:path'
import { applyDeckDesign } from './theme-store.mjs'
import { renderSource } from '../scripts/render.mjs'

export function previewTheme(store, { hash, theme, css }) {
  return store.serialize(async () => {
    const snapshot = await store.guarded(hash)
    const proposed = applyDeckDesign(snapshot.source, { theme, css })
    const rendered = await renderSource(proposed, { baseDir: dirname(store.file), draft: true })
    await store.guarded(snapshot.hash)
    return { html: rendered.html, css: rendered.css, diagnostics: rendered.diagnostics, hash: snapshot.hash }
  })
}
