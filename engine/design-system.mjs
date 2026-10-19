import postcss from 'postcss'
import { normalizeEditPatch, fontFamilyCSS } from './edit-options.mjs'

export const designBlockStart = '<!-- marp-v2-design:begin -->'
export const designBlockEnd = '<!-- marp-v2-design:end -->'
export const designMetadataPrefix = '<!-- marp-v2-design:metadata '
export const designSchemaVersion = 1
export const paletteRoles = ['background', 'text', 'title', 'muted', 'accent', 'rule']
export const derivedPaletteRoles = ['surface', 'surface-alt', 'rule-strong', 'title-band', 'title-on-band']
export const defaultDeckTheme = Object.freeze({
  font_family: 'PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Helvetica, Arial, sans-serif',
  title_size: 47.84,
  title_font_family: null,
  title_weight: null,
  cover_title_size: null,
  cover_title_font_family: null,
  cover_title_weight: null,
  body_size: 26,
  caption_size: 25,
  reference_size: 18,
  footer_size: 19,
  page_number_size: 19,
  title_dx: 0,
  title_dy: 0,
  footer_dx: 0,
  footer_dy: 0,
  page_number_dx: 0,
  page_number_dy: 0,
  show_page_numbers: true,
  appearance: 'light',
  palettes: Object.freeze({
    light: Object.freeze({ background: '#ffffff', text: '#171417', title: '#7a005f', muted: '#615863', accent: '#7a005f', rule: '#e4d9e1' }),
    dark: Object.freeze({ background: '#17141d', text: '#f3eff5', title: '#f0b6dd', muted: '#bbb0c2', accent: '#e79bcf', rule: '#4b3e52' }),
  }),
})

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
}
function keys(value, allowed, label) {
  object(value, label)
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unsupported ${label} setting "${key}".`)
}

export function normalizeDeckTheme(theme = {}) {
  keys(theme, Object.keys(defaultDeckTheme), 'theme')
  const out = structuredClone(defaultDeckTheme)
  for (const [key, value] of Object.entries(theme)) {
    if (value === null && defaultDeckTheme[key] === null) {
      out[key] = null
    } else if (key.endsWith('_weight')) {
      if (!Number.isInteger(value) || value < 100 || value > 900 || value % 100) throw new Error(`Invalid ${key}. Use a weight from 100 to 900 in steps of 100.`)
      out[key] = value
    } else if (key.endsWith('_size')) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 8 || value > 200) throw new Error(`Invalid ${key}. Use a number from 8 to 200.`)
      out[key] = Number(value.toFixed(4))
    } else if (key.endsWith('_dx') || key.endsWith('_dy')) {
      const bound = key.endsWith('_dx') ? 1280 : 720
      if (typeof value !== 'number' || !Number.isFinite(value) || value < -bound || value > bound) throw new Error(`Invalid ${key}. Use a number from ${-bound} to ${bound}.`)
      out[key] = Number(value.toFixed(4))
    } else if (key.endsWith('font_family')) {
      if (value === null) throw new Error('Invalid font family.')
      out[key] = normalizeEditPatch({ font_family: value }, 'box').font_family
    } else if (key === 'show_page_numbers') {
      if (typeof value !== 'boolean') throw new Error('show_page_numbers must be true or false.')
      out[key] = value
    } else if (key === 'appearance') {
      if (!['light', 'dark'].includes(value)) throw new Error('Choose light or dark appearance.')
      out[key] = value
    } else if (key === 'palettes') {
      keys(value, ['light', 'dark'], 'palettes')
      for (const [appearance, palette] of Object.entries(value)) {
        keys(palette, paletteRoles, `${appearance} palette`)
        for (const [role, color] of Object.entries(palette)) {
          if (color === null) throw new Error(`Invalid ${role}. Use a hex colour.`)
          out.palettes[appearance][role] = normalizeEditPatch({ color }, 'box').color
        }
      }
    }
  }
  return out
}

export function validateAdvancedCSS(css = '') {
  if (typeof css !== 'string' || css.length > 100000) throw new Error('CSS must be a string of at most 100000 characters.')
  if (/<\/style/i.test(css) || /marp-v2-design:/i.test(css)) throw new Error('CSS cannot contain a closing style tag or managed design markers.')
  try { postcss.parse(css, { from: undefined }) }
  catch (error) { throw new Error(`Invalid CSS at line ${error.line}, column ${error.column}: ${error.reason}.`) }
  return css
}

export function normalizeDeckDesign(design = {}) {
  keys(design, ['theme', 'css'], 'design')
  return { theme: normalizeDeckTheme(design.theme), css: validateAdvancedCSS(design.css) }
}

function mix(base, tint, amount) {
  const rgb = value => [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16))
  const from = rgb(base), to = rgb(tint)
  return '#' + from.map((value, index) => Math.round(value * (1 - amount) + to[index] * amount).toString(16).padStart(2, '0')).join('')
}
export function paletteVariables(appearance) {
  return [...paletteRoles, ...derivedPaletteRoles].map(role => `--deck-${role}:var(--deck-${appearance}-${role})`).join(';') + ';--deck-reference-color:var(--deck-muted)'
}

export function generateDesignCSS(input = {}) {
  const theme = normalizeDeckTheme(input)
  const vars = [
    `--deck-font-family:${fontFamilyCSS(theme.font_family)}`,
    ...['title', 'body', 'caption', 'reference', 'footer', 'page_number'].map(role => `--deck-${role.replaceAll('_', '-')}-size:${theme[`${role}_size`]}px`),
    ...['title', 'footer', 'page_number'].flatMap(role => ['dx', 'dy'].map(axis => `--deck-${role.replaceAll('_', '-')}-${axis}:${theme[`${role}_${axis}`]}px`)),
    ...['title', 'page_number'].map(role => `--deck-${role.replaceAll('_', '-')}-translate:${theme[`${role}_dx`] || theme[`${role}_dy`] ? `${theme[`${role}_dx`]}px ${theme[`${role}_dy`]}px` : 'none'}`),
    `--deck-cover-title-size:${theme.cover_title_size ?? Number((theme.title_size * 49 / 47.84).toFixed(4))}px`,
    ...['title_font_family', 'cover_title_font_family', 'title_weight', 'cover_title_weight'].filter(key => theme[key] !== null).map(key => `--deck-${key.replaceAll('_', '-')}:${key.endsWith('font_family') ? fontFamilyCSS(theme[key]) : theme[key]}`),
    `--deck-page-number-display:${theme.show_page_numbers ? 'block' : 'none'}`,
  ]
  for (const [appearance, palette] of Object.entries(theme.palettes)) {
    for (const role of paletteRoles) vars.push(`--deck-${appearance}-${role}:${palette[role]}`)
    const originalLight = appearance === 'light' && palette.background === '#ffffff' && palette.accent === '#7a005f' && palette.rule === '#e4d9e1'
    const derived = {
      surface: originalLight ? '#f6f1f5' : mix(palette.background, palette.accent, 0.08),
      'surface-alt': originalLight ? '#faf7f9' : mix(palette.background, palette.accent, 0.04),
      'rule-strong': originalLight ? '#d6c3d0' : mix(palette.rule, palette.accent, 0.22),
      'title-band': palette.accent,
      'title-on-band': palette.background,
    }
    for (const [role, color] of Object.entries(derived)) vars.push(`--deck-${appearance}-${role}:${color}`)
  }
  return `section {\n  ${vars.join(';\n  ')};\n  ${paletteVariables(theme.appearance).replaceAll(';', ';\n  ')};\n}\n`
}
