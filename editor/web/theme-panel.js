const typeFields = [['title_size', 'Slide title'], ['body_size', 'Body text'], ['caption_size', 'Captions'], ['reference_size', 'References'], ['footer_size', 'Footers'], ['page_number_size', 'Page numbers']]
const paletteFields = [['background', 'Background'], ['text', 'Text'], ['title', 'Title'], ['muted', 'Secondary text'], ['accent', 'Accent'], ['rule', 'Dividers']]
const positionRoles = [['title', 'Slide title'], ['footer', 'Footer'], ['page_number', 'Page number']]
const positionFields = positionRoles.flatMap(([role]) => [`${role}_dx`, `${role}_dy`])

export function createThemePanel({ getDeck, canMutate, mutate }) {
  const button = document.createElement('button')
  button.id = 'theme-toggle'
  button.className = 'command'
  button.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1 1 0 0 1 .5-1.8h2a4.5 4.5 0 0 0 4.5-4.5A8 8 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="11" cy="6.5" r=".8"/><circle cx="16" cy="8" r=".8"/></svg><span>Theme</span>'
  document.querySelector('#play').before(button)
  const dialog = document.createElement('dialog')
  dialog.id = 'theme-dialog'
  dialog.innerHTML = `
    <form id="theme-editor" novalidate>
      <div class="theme-heading"><div><h2>Theme & master styles</h2><p>Shape your presentation. Preview changes before applying.</p></div><button id="theme-close" type="button" class="icon-button" aria-label="Close theme editor">×</button></div>
      <div class="theme-workbench">
        <div class="theme-controls">
          <nav class="theme-tabs" aria-label="Theme sections">
            <button type="button" data-theme-tab="type" aria-selected="true">Typography</button><button type="button" data-theme-tab="colours" aria-selected="false">Colours</button><button type="button" data-theme-tab="positions" aria-selected="false" hidden>Positions</button><button type="button" data-theme-tab="advanced" aria-selected="false">Advanced</button>
          </nav>
          <div class="theme-control-content">
            <div class="theme-panel" data-theme-panel="type"><label class="theme-font">Font family<input name="font_family" list="font-families" spellcheck="false"></label><div id="theme-type-fields" class="theme-type-grid"></div><label class="theme-checkbox"><input name="show_page_numbers" type="checkbox"> Show page numbers</label><p class="muted">Objects with an individual style keep their overrides.</p></div>
            <div class="theme-panel" data-theme-panel="colours" hidden><label class="theme-appearance">Default appearance<select name="appearance"><option value="light">Light</option><option value="dark">Dark</option></select></label><div id="theme-palettes"></div><p class="muted">Each slide can follow the theme or use its own light/dark appearance.</p></div>
            <div class="theme-panel" data-theme-panel="positions" hidden><p class="theme-position-note">Move these elements across the deck, relative to their template positions. Their original layout space stays reserved.</p><div id="theme-position-fields"></div><p class="muted">Offsets use slide pixels. Positive X moves right; positive Y moves down. Footers and page numbers appear only on slides that include them.</p></div>
            <div class="theme-panel" data-theme-panel="advanced" hidden><label>Custom CSS<textarea id="theme-css" aria-label="Custom theme CSS" spellcheck="false" rows="10" placeholder="/* Additional shared slide styles */"></textarea></label><p class="muted">Shared styles and CSS travel together in a theme preset.</p></div>
            <p id="theme-error" role="alert" hidden></p>
          </div>
        </div>
        <aside id="theme-preview" aria-label="Live theme preview" hidden>
          <div class="theme-preview-heading"><strong>Live preview</strong><select id="theme-preview-slide" aria-label="Preview slide"></select></div>
          <div class="theme-preview-stage"><div id="theme-preview-viewport"><iframe id="theme-preview-frame" title="Live slide preview" sandbox="" tabindex="-1"></iframe></div></div>
          <div class="theme-preview-caption"><span id="theme-preview-status" role="status">Current slide</span><span>16:9 · All reveals</span></div>
          <p id="theme-preview-error" role="alert" hidden></p>
          <p class="theme-preview-unsaved">Preview only — your deck changes when you choose Apply.</p>
        </aside>
      </div>
      <div class="theme-actions"><button id="theme-import" type="button" class="quiet">Import preset</button><input id="theme-file" type="file" accept="application/json,.json" hidden><button id="theme-export" type="button" class="quiet">Save preset</button><span></span><button id="theme-apply" type="submit" class="primary">Apply to deck</button></div>
    </form>`
  document.body.append(dialog)
  const form = dialog.querySelector('form'), error = dialog.querySelector('#theme-error')
  const preview = dialog.querySelector('#theme-preview'), previewFrame = dialog.querySelector('#theme-preview-frame')
  const previewViewport = dialog.querySelector('#theme-preview-viewport'), previewSlide = dialog.querySelector('#theme-preview-slide')
  const previewStatus = dialog.querySelector('#theme-preview-status'), previewError = dialog.querySelector('#theme-preview-error')
  const token = document.querySelector('meta[name="editor-token"]').content
  let capabilities = {}, baseHash, currentPage = 0, version = 0, timer, pending, lastValid, requestedDesign, applying = false

  for (const [key, label] of typeFields) {
    const field = document.createElement('label'), input = document.createElement('input')
    field.textContent = label
    input.type = 'number'; input.min = '8'; input.max = '200'; input.step = 'any'; input.name = key
    field.append(input)
    dialog.querySelector('#theme-type-fields').append(field)
  }
  for (const mode of ['light', 'dark']) {
    const section = document.createElement('section'), heading = document.createElement('h3')
    section.className = `theme-palette theme-palette-${mode}`
    heading.textContent = mode === 'light' ? 'Light palette' : 'Dark palette'
    section.append(heading)
    for (const [key, label] of paletteFields) {
      const field = document.createElement('label'), input = document.createElement('input')
      field.textContent = label
      input.type = 'color'; input.name = `${mode}.${key}`; input.setAttribute('aria-label', `${mode} ${label}`)
      field.append(input); section.append(field)
    }
    dialog.querySelector('#theme-palettes').append(section)
  }
  for (const [role, label] of positionRoles) {
    const section = document.createElement('section')
    section.className = 'theme-position-role'
    const heading = document.createElement('div'), title = document.createElement('h3'), reset = document.createElement('button'), fields = document.createElement('div')
    heading.className = 'theme-position-heading'; fields.className = 'theme-position-pair'
    title.textContent = label
    reset.type = 'button'; reset.className = 'quiet'; reset.dataset.resetPosition = role; reset.textContent = 'Reset'; reset.setAttribute('aria-label', `Reset ${label.toLowerCase()} position`)
    reset.addEventListener('click', () => { form.elements[`${role}_dx`].value = 0; form.elements[`${role}_dy`].value = 0; schedulePreview() })
    heading.append(title, reset)
    for (const axis of ['x', 'y']) {
      const field = document.createElement('label'), input = document.createElement('input')
      field.textContent = `${axis.toUpperCase()} offset`
      input.type = 'number'; input.name = `${role}_d${axis}`; input.step = 'any'; input.min = axis === 'x' ? '-1280' : '-720'; input.max = axis === 'x' ? '1280' : '720'; input.setAttribute('aria-label', `${label} ${axis.toUpperCase()} offset`)
      field.append(input); fields.append(field)
    }
    section.append(heading, fields)
    dialog.querySelector('#theme-position-fields').append(section)
  }
  const appearance = document.createElement('select')
  appearance.id = 'slide-appearance'
  appearance.setAttribute('aria-label', 'Slide appearance')
  appearance.title = 'Slide appearance'
  appearance.innerHTML = '<option value="inherit">Theme</option><option value="light">Light</option><option value="dark">Dark</option>'
  document.querySelector('#slide-title').after(appearance)

  function showTab(name) {
    for (const tab of dialog.querySelectorAll('[data-theme-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.themeTab === name))
    for (const panel of dialog.querySelectorAll('[data-theme-panel]')) panel.hidden = panel.dataset.themePanel !== name
  }
  function populate(design) {
    if (!design?.theme) return
    const theme = design.theme
    for (const key of ['font_family', 'appearance', ...typeFields.map(([key]) => key)]) form.elements[key].value = theme[key]
    for (const key of positionFields) form.elements[key].value = theme[key] ?? 0
    form.elements.show_page_numbers.checked = theme.show_page_numbers
    for (const mode of ['light', 'dark']) for (const [key] of paletteFields) form.elements[`${mode}.${key}`].value = theme.palettes[mode][key]
    dialog.querySelector('#theme-css').value = design.css ?? ''
  }
  function numberValue(key, label, min, max) {
    const value = form.elements[key].value.trim(), number = Number(value)
    if (!value || !Number.isFinite(number) || number < min || number > max) throw new Error(`${label} must be a number from ${min} to ${max}.`)
    return number
  }
  function values() {
    const theme = { font_family: form.elements.font_family.value.trim(), appearance: form.elements.appearance.value, show_page_numbers: form.elements.show_page_numbers.checked, palettes: { light: {}, dark: {} } }
    for (const [key, label] of typeFields) theme[key] = numberValue(key, label, 8, 200)
    if (capabilities.masterPositions) for (const [role, label] of positionRoles) for (const axis of ['x', 'y']) {
      const bound = axis === 'x' ? 1280 : 720
      theme[`${role}_d${axis}`] = numberValue(`${role}_d${axis}`, `${label} ${axis.toUpperCase()} offset`, -bound, bound)
    }
    for (const mode of ['light', 'dark']) for (const [key] of paletteFields) theme.palettes[mode][key] = form.elements[`${mode}.${key}`].value
    return { theme, css: dialog.querySelector('#theme-css').value }
  }
  function stopPreview() {
    version++
    clearTimeout(timer)
    pending?.abort()
    pending = null
    preview.removeAttribute('aria-busy')
  }
  function fitPreview() {
    const scale = previewViewport.clientWidth / 1280
    previewFrame.style.transform = `scale(${scale})`
  }
  function paintPreview(rendered) {
    const slide = Math.max(1, Number(previewSlide.value) || 1)
    // CSS and authored HTML stay inside an opaque-origin, scriptless iframe.
    // Retain all SVG siblings so slide-specific nth-of-type CSS stays correct.
    const css = String(rendered.css ?? '').replace(/</g, '\\3c ')
    const frameCSS = `html,body{margin:0!important;padding:0!important;width:1280px!important;height:720px!important;overflow:hidden!important;background:transparent}.marpit{margin:0!important;padding:0!important;width:1280px!important;height:720px!important}.marpit>svg{display:none!important;width:1280px!important;height:720px!important;margin:0!important;padding:0!important}.marpit>svg:nth-of-type(${slide}){display:block!important}`
    previewFrame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: http: https:; style-src 'unsafe-inline' http: https:; font-src data: http: https:; base-uri 'none'; form-action 'none'"><style>${css}\n${frameCSS}</style></head><body>${rendered.html ?? ''}</body></html>`
    previewFrame.dataset.sourceHash = rendered.hash ?? baseHash
    previewFrame.dataset.previewVersion = String(version)
    fitPreview()
  }
  function previewProblem(message) {
    previewError.textContent = message
    previewError.hidden = false
    previewStatus.textContent = lastValid ? 'Showing the last valid preview' : 'Preview unavailable'
  }
  async function requestPreview(requestVersion) {
    if (!dialog.open || !capabilities.themePreview || applying || requestVersion !== version) return
    let design
    try { design = values() } catch (caught) { previewProblem(caught.message); return }
    if (baseHash !== getDeck()?.hash) { previewProblem('The source changed. Close the theme dialog and reload before applying.'); return }
    const controller = new AbortController()
    pending = controller
    preview.setAttribute('aria-busy', 'true')
    previewStatus.textContent = 'Updating preview…'
    try {
      const response = await fetch('/api/theme-preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Token': token }, body: JSON.stringify({ hash: baseHash, ...design }), signal: controller.signal })
      const result = await response.json()
      if (!dialog.open || requestVersion !== version || controller.signal.aborted || applying || baseHash !== getDeck()?.hash) return
      if (!response.ok) throw new Error(result.error ?? 'The preview could not be rendered.')
      if (result.hash !== baseHash) throw new Error('The source changed. Close the theme dialog and reload before applying.')
      const failures = (result.diagnostics ?? []).filter(item => item.severity === 'error')
      if (failures.length) throw new Error(failures.map(item => item.message).join(' '))
      lastValid = result
      paintPreview(result)
      previewError.hidden = true
      const warnings = (result.diagnostics ?? []).filter(item => item.severity === 'warning')
      previewStatus.textContent = warnings.length ? warnings[0].message : 'Preview up to date'
    } catch (caught) {
      if (dialog.open && requestVersion === version && caught.name !== 'AbortError' && !controller.signal.aborted) previewProblem(caught.message)
    } finally {
      if (requestVersion === version) { pending = null; preview.removeAttribute('aria-busy') }
    }
  }
  function schedulePreview(delay = 220) {
    if (!dialog.open || !capabilities.themePreview || applying) return
    let signature
    try { signature = JSON.stringify(values()) } catch (caught) { stopPreview(); requestedDesign = null; previewProblem(caught.message); return }
    if (signature === requestedDesign) return
    stopPreview()
    requestedDesign = signature
    const requestVersion = version
    previewError.hidden = true
    previewStatus.textContent = 'Updating preview…'
    timer = setTimeout(() => requestPreview(requestVersion), delay)
  }
  new ResizeObserver(fitPreview).observe(previewViewport)
  form.addEventListener('input', event => { if (event.target !== previewSlide) schedulePreview() })
  form.addEventListener('change', event => { if (event.target !== previewSlide && event.target.id !== 'theme-file') schedulePreview() })
  previewSlide.addEventListener('change', () => { if (lastValid) paintPreview(lastValid) })

  button.addEventListener('click', () => {
    if (!canMutate()) return
    const deck = getDeck()
    stopPreview()
    baseHash = deck.hash
    requestedDesign = null
    capabilities = deck.capabilities ?? {}
    preview.hidden = !capabilities.themePreview
    dialog.classList.toggle('has-theme-preview', !!capabilities.themePreview)
    dialog.querySelector('[data-theme-tab="positions"]').hidden = !capabilities.masterPositions
    for (const key of positionFields) form.elements[key].disabled = !capabilities.masterPositions
    if (!capabilities.masterPositions && dialog.querySelector('[data-theme-tab="positions"]').getAttribute('aria-selected') === 'true') showTab('type')
    populate(deck.design)
    error.hidden = previewError.hidden = true
    previewSlide.replaceChildren(...(deck.slides ?? []).map(slide => {
      const option = document.createElement('option')
      option.value = String(slide.slide); option.textContent = `${slide.slide} · ${slide.title || 'Untitled slide'}`
      return option
    }))
    previewSlide.value = String(currentPage + 1)
    lastValid = deck
    dialog.showModal()
    if (capabilities.themePreview) { paintPreview(deck); schedulePreview(0) }
  })
  dialog.querySelector('#theme-close').addEventListener('click', () => dialog.close())
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close() })
  dialog.addEventListener('close', stopPreview)
  dialog.addEventListener('cancel', stopPreview)
  for (const tab of dialog.querySelectorAll('[data-theme-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.themeTab))
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (!canMutate() || applying) return
    let design
    try { design = values() } catch (caught) { error.textContent = caught.message; error.hidden = false; return }
    stopPreview()
    applying = true
    error.hidden = true
    dialog.querySelector('#theme-apply').disabled = true
    try {
      const result = await mutate('/api/theme', design, undefined, 'Theme updated')
      if (result) dialog.close()
      else { error.textContent = 'The theme was not saved. Check the editor status, then try again.'; error.hidden = false }
    } finally { applying = false; dialog.querySelector('#theme-apply').disabled = false }
  })
  dialog.querySelector('#theme-export').addEventListener('click', () => {
    let design
    try { design = values() } catch (caught) { error.textContent = caught.message; error.hidden = false; return }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, ...design }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'slide-theme.json'; document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  })
  dialog.querySelector('#theme-import').addEventListener('click', () => dialog.querySelector('#theme-file').click())
  dialog.querySelector('#theme-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''
    if (!file) return
    const importVersion = version
    try {
      if (file.size > 256 * 1024) throw new Error('Choose a theme preset smaller than 256 KB.')
      const design = JSON.parse(await file.text())
      if (!dialog.open || importVersion !== version) return
      if (!design.theme?.palettes?.light || !design.theme?.palettes?.dark) throw new Error('This file does not contain a Marpres theme preset.')
      populate(design); error.hidden = true; schedulePreview(0)
    } catch (caught) { if (dialog.open && importVersion === version) { error.textContent = caught.message; error.hidden = false } }
  })
  appearance.addEventListener('change', async () => {
    if (!canMutate()) return
    const slide = Number(document.querySelector('#deck .current-slide section')?.dataset.sourceSlide ?? 1)
    await mutate('/api/appearance', { slide, appearance: appearance.value }, undefined, 'Slide appearance updated')
  })
  return { sync(page) {
    currentPage = page
    const deck = getDeck()
    button.disabled = !canMutate() || !deck?.design
    appearance.disabled = !canMutate() || !deck?.design
    const section = document.querySelector('#deck .current-slide section')
    appearance.value = deck?.slides?.find(slide => slide.slide === page + 1)?.appearance ?? section?.dataset.appearance ?? 'inherit'
  } }
}
