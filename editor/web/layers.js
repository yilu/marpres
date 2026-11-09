// Orders run from back to front, matching CSS painting order.
export function reorderLayerIds(ids, selection, action) {
  const selected = new Set(selection), result = [...ids]
  if (action === 'front') return [...ids.filter(id => !selected.has(id)), ...ids.filter(id => selected.has(id))]
  if (action === 'back') return [...ids.filter(id => selected.has(id)), ...ids.filter(id => !selected.has(id))]
  if (action === 'forward') {
    for (let i = result.length - 2; i >= 0; i--) {
      if (selected.has(result[i]) && !selected.has(result[i + 1])) [result[i], result[i + 1]] = [result[i + 1], result[i]]
    }
  } else if (action === 'backward') {
    for (let i = 1; i < result.length; i++) {
      if (selected.has(result[i]) && !selected.has(result[i - 1])) [result[i], result[i - 1]] = [result[i - 1], result[i]]
    }
  }
  return result
}

function collectLayers(slide) {
  const section = slide?.querySelector('section'), contexts = new WeakMap()
  function stackingContext(element) {
    if (contexts.has(element)) return contexts.get(element)
    const css = getComputedStyle(element), parentDisplay = element.parentElement && getComputedStyle(element.parentElement).display
    const positioned = css.position !== 'static' || /flex|grid/.test(parentDisplay)
    const context = css.transform !== 'none' || css.filter !== 'none' || css.perspective !== 'none' ||
      css.isolation === 'isolate' || Number(css.opacity) < 1 || css.mixBlendMode !== 'normal' ||
      ['fixed', 'sticky'].includes(css.position) || positioned && css.zIndex !== 'auto' ||
      /(?:^|\s)(?:layout|paint|strict|content)(?:$|\s)/.test(css.contain) ||
      /(?:transform|opacity|filter|perspective)/.test(css.willChange)
    contexts.set(element, context)
    return context
  }
  function parentContext(object) {
    for (let parent = object.parentElement; parent && parent !== section; parent = parent.parentElement) {
      if (stackingContext(parent)) return parent
    }
    return null
  }
  const elements = new Set(slide?.querySelectorAll('.editable-object[data-edit-id]') ?? [])
  for (const object of [...elements]) {
    for (let parent = object.parentElement; parent && parent !== section; parent = parent.parentElement) {
      if (stackingContext(parent)) elements.add(parent)
    }
  }
  const ordered = [...elements].sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
  const groups = new Map(), items = ordered.map((object, index) => {
    const editable = object.matches('.editable-object[data-edit-id]'), options = JSON.parse(object.dataset.editOptions ?? '{}')
    const parent = parentContext(object), id = editable ? object.dataset.editId : null
    const css = getComputedStyle(object), parentDisplay = object.parentElement && getComputedStyle(object.parentElement).display
    const zApplies = css.position !== 'static' || /flex|grid/.test(parentDisplay)
    const item = { object, id, key: id ?? object, editable, parent, parentIndex: ordered.indexOf(parent), index,
      z: zApplies ? Number.parseInt(css.zIndex, 10) || 0 : 0, layer: options.layer,
      kind: editable ? object.dataset.editKind : 'group', stage: Number(object.dataset.stage ?? 0), hidden: !!object.closest('.stage-hidden'),
      label: editable ? (object.querySelector('img')?.alt || object.textContent || id).replace(/\s+/g, ' ').trim() : 'Group' }
    if (!groups.has(parent)) groups.set(parent, [])
    groups.get(parent).push(item)
    return item
  })
  for (const group of groups.values()) group.sort((a, b) => a.z - b.z || a.index - b.index)
  return { items, groups }
}

function editsFor(groups, selection, action) {
  const edits = []
  for (const group of groups.values()) {
    const ids = group.map(item => item.key), ordered = reorderLayerIds(ids, selection, action)
    if (ordered.every((id, index) => id === ids[index])) continue
    const byId = new Map(group.map(item => [item.key, item])), candidates = []
    for (const [backward, preserve] of [[false, true], [true, true], [false, false]]) {
      const patches = []
      let previous = backward ? Infinity : -Infinity, previousIndex = backward ? Infinity : -1, valid = true
      for (const id of backward ? [...ordered].reverse() : ordered) {
        const item = byId.get(id), current = item.z - 100
        const edge = previous + (backward ? item.index >= previousIndex ? -1 : 0 : item.index <= previousIndex ? 1 : 0)
        const bound = !item.editable ? edge : backward ? Math.min(99, edge) : Math.max(-99, edge)
        const layer = !item.editable ? current : !preserve ? bound : backward ? Math.min(current, bound) : Math.max(current, bound)
        if ((backward ? layer > bound : layer < bound) || item.editable && (layer < -99 || layer > 99)) { valid = false; break }
        if (item.editable && current !== layer) patches.push({ id: item.id, patch: { layer } })
        previous = layer; previousIndex = item.index
      }
      if (valid) candidates.push(patches)
    }
    if (!candidates.length) throw new Error('This move exceeds the containing group’s layer range.')
    candidates.sort((a, b) => a.length - b.length)
    edits.push(...candidates[0])
  }
  if (edits.length > 100) throw new Error('Reordering this stack requires more than 100 layer changes.')
  return edits
}

export function createLayersPanel({ getSlide, getSelection, canSelect, selectObject, saveEdits, report }) {
  const list = document.querySelector('#layer-list'), empty = document.querySelector('#layers-empty')
  const tabs = ['format', 'layers'].map(name => ({ tab: document.querySelector('#' + name + '-tab'), panel: document.querySelector('#' + name + '-panel') }))
  const actions = [...document.querySelectorAll('[data-layer-action]')]
  const messages = { front: 'Brought to front', forward: 'Brought forward', backward: 'Sent backward', back: 'Sent to back' }
  let signature = ''

  function showTab(name) {
    for (const { tab, panel } of tabs) {
      const active = tab.id === name + '-tab'
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1
      panel.hidden = !active
    }
    document.body.classList.remove('inspector-collapsed')
  }
  for (const { tab } of tabs) {
    tab.addEventListener('click', () => showTab(tab.id.replace('-tab', '')))
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      const target = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : tab === tabs[0].tab ? 1 : 0].tab
      if (!target.disabled) { showTab(target.id.replace('-tab', '')); target.focus() }
    })
  }

  function choose(row, extend = false) {
    if (!canSelect()) return
    const object = [...getSlide()?.querySelectorAll('.editable-object') ?? []].find(object => object.dataset.editId === row.dataset.layerId)
    if (object) selectObject(object, extend)
  }
  list.addEventListener('click', event => {
    const row = event.target.closest('[data-layer-id]')
    if (row) choose(row, event.shiftKey || event.metaKey || event.ctrlKey)
  })
  list.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const rows = [...list.querySelectorAll('[data-layer-id]')], index = rows.indexOf(event.target.closest('[data-layer-id]'))
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
    rows[next]?.focus(); if (rows[next]) choose(rows[next])
  })
  for (const button of actions) button.addEventListener('click', () => {
    if (!canSelect()) return
    try {
      const edits = editsFor(collectLayers(getSlide()).groups, getSelection(), button.dataset.layerAction)
      if (edits.length) saveEdits(edits, messages[button.dataset.layerAction])
    } catch (error) { report(error.message, 'error') }
  })

  function sync() {
    const { items, groups } = collectLayers(getSlide()), selection = getSelection(), selected = new Set(selection)
    const nextSignature = JSON.stringify(items.map(({ id, index, parentIndex, z, label, stage, hidden }) => [id ?? index, parentIndex, z, label, stage, hidden]))
    if (signature !== nextSignature) {
      const focused = list.contains(document.activeElement) ? document.activeElement.dataset.layerId : null, scroll = list.scrollTop
      const rows = []
      function append(parent, depth) {
        for (const item of [...groups.get(parent) ?? []].reverse()) {
          const row = document.createElement(item.editable ? 'button' : 'div')
          row.className = item.editable ? 'layer-row' : 'layer-group'
          if (item.editable) { row.type = 'button'; row.dataset.layerId = item.id; row.setAttribute('role', 'option') }
          else row.setAttribute('role', 'presentation')
          row.style.setProperty('--layer-depth', Math.min(depth, 4))
          row.title = item.kind + ' · ' + item.id + '\n' + item.label
          row.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-' + (item.kind === 'figure' ? 'image' : item.kind === 'shape' ? 'shape' : 'text') + '"/></svg><span class="layer-label"></span>'
          row.querySelector('.layer-label').textContent = item.label.slice(0, 100) || item.id
          if (item.stage) {
            const badge = document.createElement('span'); badge.className = 'layer-stage'; badge.textContent = 'Stage ' + item.stage; row.append(badge)
          }
          row.classList.toggle('layer-hidden-stage', item.hidden)
          rows.push(row); append(item.object, depth + 1)
        }
      }
      append(null, 0); list.replaceChildren(...rows); list.scrollTop = scroll; signature = nextSignature
      if (focused) [...list.children].find(row => row.dataset.layerId === focused)?.focus({ preventScroll: true })
    }
    const available = canSelect()
    for (const row of list.querySelectorAll('[data-layer-id]')) {
      row.setAttribute('aria-selected', String(selected.has(row.dataset.layerId)))
      row.disabled = !available
    }
    for (const button of actions) {
      let movable = false
      try { movable = editsFor(groups, selection, button.dataset.layerAction).length > 0 } catch { movable = false }
      button.disabled = !available || !movable
    }
    const count = items.filter(item => item.editable).length
    empty.hidden = count > 0
    document.querySelector('#layers-count').textContent = String(count)
  }
  return { sync, showFormat: () => showTab('format') }
}
