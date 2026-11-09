const roles = [['background', 'Background'], ['text', 'Text'], ['title', 'Title'], ['muted', 'Secondary text'], ['accent', 'Accent'], ['rule', 'Dividers']]
const standardColours = [
  ['Black', '#000000'], ['Charcoal', '#333333'], ['Grey', '#666666'], ['Silver', '#999999'],
  ['Light grey', '#cccccc'], ['Pale grey', '#e6e6e6'], ['Off white', '#f2f2f2'], ['White', '#ffffff'],
  ['Red', '#b8361f'], ['Orange', '#d55e00'], ['Amber', '#e69f00'], ['Green', '#009e73'],
  ['Blue', '#0072b2'], ['Deep blue', '#1f4e9c'], ['Plum', '#7a005f'], ['Pink', '#cc79a7'],
  ['Light red', '#f5d5cf'], ['Light orange', '#f9dfc2'], ['Light amber', '#fff0b3'], ['Light green', '#ccebdd'],
  ['Light blue', '#d8eef7'], ['Pale blue', '#dbe6f5'], ['Light plum', '#ead9e7'], ['Light pink', '#f2ddea']
]

export function createColourPicker({ getDeck, getAppearance }) {
  const picker = document.createElement('div')
  picker.id = 'colour-picker'
  picker.className = 'colour-picker'
  picker.setAttribute('popover', 'auto')
  picker.setAttribute('role', 'dialog')
  picker.setAttribute('aria-label', 'Choose colour')
  picker.innerHTML = '<div class="colour-section"><h3>Deck colours</h3><div class="colour-grid" data-colour-group="deck" role="group" aria-label="Deck colours"></div></div><div class="colour-section"><h3>Standard colours</h3><div class="colour-grid" data-colour-group="standard" role="group" aria-label="Standard colours"></div></div><button type="button" class="colour-none" hidden>No fill</button><label class="colour-custom"><input type="color" aria-label="Custom colour"><span>More colours…</span></label>'
  document.body.append(picker)
  const custom = picker.querySelector('input'), none = picker.querySelector('.colour-none')
  const fill = document.querySelector('#shape-form [name="fill"]')
  const fillButton = document.createElement('button')
  fillButton.type = 'button'
  fillButton.className = 'colour-fill-trigger'
  fillButton.setAttribute('aria-label', 'Choose fill colour')
  fillButton.title = 'Choose fill colour'
  fillButton.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5"/></svg>'
  fill.after(fillButton)
  let target, trigger
  for (const control of [...document.querySelectorAll('input[type="color"]')].filter(input => input !== custom).concat(fillButton)) {
    control.setAttribute('aria-haspopup', 'dialog')
    control.setAttribute('aria-controls', picker.id)
    control.setAttribute('aria-expanded', 'false')
  }

  function close(restoreFocus = true) {
    if (picker.matches(':popover-open')) picker.hidePopover()
    trigger?.setAttribute('aria-expanded', 'false')
    if (restoreFocus) trigger?.focus({ preventScroll: true })
  }
  function choose(value) {
    const field = target
    close()
    if (!field || field.disabled) return
    field.value = value
    sync()
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function swatch(label, colour) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'colour-swatch'
    button.dataset.colour = colour
    button.title = `${label} ${colour.toUpperCase()}`
    button.setAttribute('aria-label', button.title)
    button.setAttribute('aria-pressed', String(target.value.toLowerCase() === colour))
    button.style.setProperty('--swatch', colour)
    const rgb = [1, 3, 5].map(i => Number.parseInt(colour.slice(i, i + 2), 16))
    const linear = rgb.map(value => {
      const channel = value / 255
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
    })
    const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
    button.style.setProperty('--swatch-ink', luminance > .179 ? '#000000' : '#ffffff')
    button.addEventListener('click', () => choose(colour))
    return button
  }
  function deckColours(input) {
    const themeForm = input.closest('#theme-editor')
    const mode = themeForm ? input.name.startsWith('dark.') ? 'dark' : 'light' : getAppearance()
    const palette = getDeck()?.design?.theme?.palettes?.[mode] ?? {}
    const colours = new Map()
    for (const [key, label] of roles) {
      const colour = (themeForm?.elements[`${mode}.${key}`]?.value ?? palette[key] ?? '').toLowerCase()
      if (!/^#[0-9a-f]{6}$/.test(colour)) continue
      colours.set(colour, colours.has(colour) ? `${colours.get(colour)} / ${label}` : label)
    }
    return [...colours].map(([colour, label]) => swatch(label, colour))
  }
  function open(input, opener = input) {
    if (input.disabled || opener.disabled) return
    close(false)
    target = input
    trigger = opener
    // A picker opened from the modal theme editor must belong to that dialog
    // to remain interactive. The popover itself escapes scrolling ancestors.
    const host = input.closest('dialog[open]') ?? document.body
    host.append(picker)
    picker.querySelector('[data-colour-group="deck"]').replaceChildren(...deckColours(input))
    picker.querySelector('[data-colour-group="standard"]').replaceChildren(...standardColours.map(([label, colour]) => swatch(label, colour)))
    none.hidden = input !== fill
    custom.value = /^#[0-9a-f]{6}$/i.test(input.value) ? input.value : '#ffffff'
    picker.showPopover()
    trigger.setAttribute('aria-expanded', 'true')
    const rect = opener.getBoundingClientRect(), width = picker.offsetWidth, height = picker.offsetHeight
    const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8))
    const top = rect.bottom + 6 + height <= innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)
    Object.assign(picker.style, { left: `${left}px`, top: `${top}px` })
    const buttons = [...picker.querySelectorAll('.colour-swatch')]
    const selected = buttons.find(button => button.getAttribute('aria-pressed') === 'true') ?? buttons[0]
    for (const button of buttons) button.tabIndex = button === selected ? 0 : -1
    selected.focus({ preventScroll: true })
  }
  document.addEventListener('click', event => {
    const input = event.target.closest('input[type="color"]')
    if (!input || input === custom) return
    event.preventDefault()
    open(input)
  }, true)
  document.addEventListener('keydown', event => {
    if (event.target.matches('input[type="color"]') && event.target !== custom && ['Enter', ' ', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); open(event.target)
    }
  }, true)
  fillButton.addEventListener('click', () => open(fill, fillButton))
  none.addEventListener('click', () => choose('none'))
  picker.addEventListener('toggle', event => trigger?.setAttribute('aria-expanded', String(event.newState === 'open')))
  custom.addEventListener('input', event => event.stopPropagation())
  custom.addEventListener('change', event => { event.stopPropagation(); choose(custom.value) })
  picker.addEventListener('keydown', event => {
    // Do not let colour navigation move/delete canvas objects or submit a form.
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (!event.target.matches('.colour-swatch')) return
    const buttons = [...picker.querySelectorAll('.colour-swatch')], index = buttons.indexOf(event.target)
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key]
    if (step === undefined && !['Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + step))
    for (const [i, button] of buttons.entries()) button.tabIndex = i === next ? 0 : -1
    buttons[next].focus()
  })
  window.addEventListener('resize', () => close(false))
  document.addEventListener('scroll', event => { if (!picker.contains(event.target)) close(false) }, true)
  document.querySelector('#theme-dialog').addEventListener('close', () => close(false))

  function sync() {
    fillButton.disabled = fill.disabled
    const colour = /^#[0-9a-f]{6}$/i.test(fill.value) ? fill.value : '#ffffff'
    fillButton.style.backgroundColor = colour
    fillButton.querySelector('svg').style.visibility = fill.value === 'none' || !fill.value ? 'visible' : 'hidden'
    if (target?.disabled) close(false)
  }
  sync()
  return { sync }
}
