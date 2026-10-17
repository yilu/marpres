export function createSourcePane({ getDeck, getSelection, navigate }) {
  const pane = document.createElement('section')
  pane.id = 'source-pane'
  pane.hidden = true
  pane.setAttribute('aria-label', 'Markdown source')
  pane.innerHTML = '<div class="source-heading"><strong>Source</strong><span id="source-location"></span><a id="open-vscode">Open in VS Code ↗</a><button id="source-close" class="icon-button" aria-label="Close source">×</button></div><div id="source-lines" role="list" aria-label="Source lines"></div>'
  document.querySelector('.canvas-footer').before(pane)
  const toggle = document.createElement('button')
  toggle.id = 'toggle-source'
  toggle.className = 'quiet'
  toggle.textContent = 'Source'
  toggle.setAttribute('aria-expanded', 'false')
  document.querySelector('#toggle-inspector').before(toggle)
  const jump = document.createElement('button')
  jump.id = 'go-to-source'
  jump.className = 'quiet source-jump'
  jump.textContent = 'Show source'
  jump.title = 'Reveal the selected object in Markdown'
  document.querySelector('.selection-heading').append(jump)
  let selectedLine = 1
  const lines = pane.querySelector('#source-lines')
  const link = pane.querySelector('#open-vscode')
  function setLocation(line) {
    selectedLine = line || 1
    pane.querySelector('#source-location').textContent = `Line ${selectedLine}`
    const path = getDeck()?.sourcePath
    link.hidden = !path
    if (path) link.href = `vscode://file${encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')}:${selectedLine}:1`
  }
  function sync(scroll = true) {
    const ids = getSelection(), deck = getDeck()
    const objects = (deck?.objects ?? []).filter(object => ids.includes(object.id))
    for (const line of lines.children) line.classList.toggle('is-source-selected', objects.some(object => Number(line.dataset.line) >= object.line && Number(line.dataset.line) <= object.endLine))
    const line = objects[0]?.line ?? selectedLine
    setLocation(line)
    jump.disabled = !objects.some(object => object.line)
    if (!pane.hidden && scroll) lines.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' })
  }
  function open() { pane.hidden = false; toggle.setAttribute('aria-expanded', 'true'); sync() }
  function close() { pane.hidden = true; toggle.setAttribute('aria-expanded', 'false') }
  toggle.addEventListener('click', () => pane.hidden ? open() : close())
  pane.querySelector('#source-close').addEventListener('click', close)
  jump.addEventListener('click', open)
  lines.addEventListener('click', event => {
    const line = Number(event.target.closest('[data-line]')?.dataset.line)
    if (!line) return
    const deck = getDeck()
    const object = (deck.objects ?? []).filter(object => line >= object.line && line <= object.endLine).sort((a, b) => a.endLine - a.line - (b.endLine - b.line))[0]
    const slide = (deck.slides ?? []).find(slide => line >= slide.startLine && line <= slide.endLine)
    setLocation(line)
    navigate(object?.slide ?? slide?.slide ?? 1, object?.id)
    sync(false)
  })
  return {
    render() {
      const source = getDeck()?.source ?? ''
      lines.replaceChildren(...source.split(/\r?\n/).map((value, index) => {
        const row = document.createElement('button'), number = document.createElement('span'), text = document.createElement('code')
        row.type = 'button'
        row.className = 'source-line'
        row.dataset.line = String(index + 1)
        row.setAttribute('role', 'listitem')
        row.setAttribute('aria-label', `Line ${index + 1}: ${value}`)
        number.className = 'source-line-number'
        number.textContent = String(index + 1)
        text.textContent = value || ' '
        row.append(number, text)
        return row
      }))
      sync(false)
    }, sync, close
  }
}
