// Ctrl+Shift+ArrowUp / Ctrl+Shift+ArrowDown (Cmd+Shift on a Mac) moves the
// list item holding the caret one place up or down among its siblings
// (discussion #1819), its sub-items and continuation lines going with it.
// A selection over several items of the same list moves them together. An
// item never leaves its list: at the top or the bottom nothing happens, and
// outside a list the keys keep CodeMirror's or the browser's meaning.
// HTML notes have the same keys (src/public/js/list-item-move.js).
//
// The list is read from the lines and their indentation, the way the note
// shows it, and not from the syntax tree: the CommonMark parser nests an
// item only under the content column of its parent, so "1. a" followed by
// "  - b" is two lists there and one list with a sub-item for the eye.
// Lines inside a fenced code block are never items. A numbered list keeps
// its numbers in place: the moved items take the numbers of their new rows.
import { EditorSelection } from '@codemirror/state'

const QUOTE_RE = /^(?: {0,3}>[ \t]?)*/
const ITEM_RE = /^([ \t]*)(?:[-*+]|(\d{1,9})[.)])(?=[ \t]|$)/
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/

function indentWidth(text) {
  let width = 0
  for (const ch of text) width = ch === '\t' ? width + 4 - (width % 4) : width + 1
  return width
}

function closesFence(info, open) {
  return info.fenceOnly && info.fence[0] === open[0] && info.fence.length >= open.length
}

// Reads the lines of the document once per key press
function createLineReader(doc) {
  const cache = new Map()
  const read = number => {
    let info = cache.get(number)
    if (info) return info
    const text = doc.line(number).text
    const quote = QUOTE_RE.exec(text)[0]
    const rest = text.slice(quote.length)
    const indentText = /^[ \t]*/.exec(rest)[0]
    const match = ITEM_RE.exec(rest)
    const fence = FENCE_RE.exec(rest)
    info = {
      depth: (quote.match(/>/g) || []).length,
      blank: rest.trim() === '',
      indent: indentWidth(indentText),
      isItem: !!match,
      ordered: !!(match && match[2]),
      number: match && match[2] ? match[2] : '',
      numberAt: quote.length + indentText.length,
      fence: fence ? fence[1] : '',
      // (a closing fence holds nothing but the fence)
      fenceOnly: !!fence && rest.trim() === fence[1]
    }
    cache.set(number, info)
    return info
  }

  // The lines strictly inside a fenced code block, and the fence lines
  const inFence = new Uint8Array(doc.lines + 2)
  let open = ''
  for (let n = 1; n <= doc.lines; n++) {
    const info = read(n)
    if (open) {
      inFence[n] = 1
      if (closesFence(info, open)) open = ''
    } else if (info.fence) {
      open = info.fence
    }
  }

  return {
    read,
    lines: doc.lines,
    isItemLine: n => !inFence[n] && read(n).isItem,
    inFence: n => inFence[n] === 1
  }
}

// The last line of the item starting at `start`: the lines after it that are
// more indented (sub-items, continuation, a nested code block), blank lines
// between them included, trailing blank lines not
function itemEnd(reader, start) {
  const base = reader.read(start)
  let end = start
  let fence = ''
  for (let n = start + 1; n <= reader.lines; n++) {
    const info = reader.read(n)
    if (info.depth !== base.depth) break
    if (fence) {
      end = n
      if (closesFence(info, fence)) fence = ''
      continue
    }
    if (info.blank) continue
    if (info.indent <= base.indent) break
    end = n
    if (info.fence) fence = info.fence
  }
  return end
}

// The innermost item whose lines hold line `line`, looking from `from` up
function owningItem(reader, line, from = line) {
  for (let n = from; n >= 1; n--) {
    const info = reader.read(n)
    if (reader.isItemLine(n)) {
      if (itemEnd(reader, n) >= line) return n
      continue
    }
    if (!info.blank && !reader.inFence(n) && info.indent === 0 && info.depth === reader.read(line).depth) return null
  }
  return null
}

function parentItem(reader, start) {
  return start > 1 ? owningItem(reader, start, start - 1) : null
}

function sameKind(a, b) {
  return a.depth === b.depth && a.indent === b.indent && a.ordered === b.ordered
}

function nextSibling(reader, start) {
  const base = reader.read(start)
  for (let n = itemEnd(reader, start) + 1; n <= reader.lines; n++) {
    const info = reader.read(n)
    if (info.blank) {
      if (info.depth !== base.depth) return null
      continue
    }
    return reader.isItemLine(n) && sameKind(info, base) ? n : null
  }
  return null
}

function previousSibling(reader, start) {
  const base = reader.read(start)
  for (let n = start - 1; n >= 1; n--) {
    const info = reader.read(n)
    if (info.blank) {
      if (info.depth !== base.depth) return null
      continue
    }
    if (info.depth !== base.depth) return null
    if (reader.isItemLine(n) && info.indent <= base.indent) {
      return sameKind(info, base) && nextSibling(reader, n) === start ? n : null
    }
    if (reader.inFence(n) || info.indent > base.indent) continue
    return null
  }
  return null
}

function ancestors(reader, start) {
  const chain = []
  for (let item = start; item; item = parentItem(reader, item)) chain.push(item)
  return chain
}

// The sibling items from `first` to `last`, or null when they are not
// siblings of one list
function siblingRun(reader, first, last) {
  const run = [first]
  let item = first
  while (item !== last) {
    item = nextSibling(reader, item)
    if (!item || item > last) return null
    run.push(item)
  }
  return run
}

// The items to move: the caret's item, or for a selection the items at the
// deepest level holding both of its ends
function selectedRun(state, reader) {
  const main = state.selection.main
  const doc = state.doc
  const fromLine = doc.lineAt(main.from).number
  let toLine = doc.lineAt(main.to).number
  if (!main.empty && toLine > fromLine && doc.line(toLine).from === main.to) toLine--

  const startItem = owningItem(reader, fromLine)
  const endItem = toLine === fromLine ? startItem : owningItem(reader, toLine)
  if (!startItem || !endItem) return null

  const startChain = ancestors(reader, startItem)
  const endChain = ancestors(reader, endItem)
  for (const a of startChain) {
    for (const b of endChain) {
      const first = Math.min(a, b)
      const last = Math.max(a, b)
      if (!sameKind(reader.read(first), reader.read(last))) continue
      if (parentItem(reader, first) !== parentItem(reader, last)) continue
      const run = siblingRun(reader, first, last)
      if (run) return run
    }
  }
  return null
}

function moveListItems(view, down) {
  const state = view.state
  if (state.readOnly) return false
  const doc = state.doc
  const reader = createLineReader(doc)
  const run = selectedRun(state, reader)
  if (!run) return false

  // The items are found: from here on the keys are ours, even when the
  // items are already at the top or the bottom of their list
  const neighbour = down ? nextSibling(reader, run[run.length - 1]) : previousSibling(reader, run[0])
  if (!neighbour) return true

  const starts = down ? [...run, neighbour] : [neighbour, ...run]
  const units = starts.map(start => ({
    start,
    from: doc.line(start).from,
    to: doc.line(itemEnd(reader, start)).to,
    info: reader.read(start)
  }))
  const gaps = []
  for (let i = 0; i + 1 < units.length; i++) gaps.push({ from: units[i].to, to: units[i + 1].from })

  // The neighbour goes to the other side; the gaps between the items stay
  // in place, and in a numbered list each row keeps its number
  const order = down
    ? [units[units.length - 1], ...units.slice(0, -1)]
    : [...units.slice(1), units[0]]
  const ordered = units[0].info.ordered
  const spanFrom = units[0].from
  const spanTo = units[units.length - 1].to

  const segments = []
  let insert = ''
  order.forEach((unit, index) => {
    const segment = { oldFrom: unit.from, oldTo: unit.to, newFrom: spanFrom + insert.length, numberAt: -1, oldLength: 0, newLength: 0, gap: false }
    let text = doc.sliceString(unit.from, unit.to)
    const number = units[index].info.number
    if (ordered && number && unit.info.number !== number) {
      const at = unit.info.numberAt
      text = text.slice(0, at) + number + text.slice(at + unit.info.number.length)
      segment.numberAt = at
      segment.oldLength = unit.info.number.length
      segment.newLength = number.length
    }
    segments.push(segment)
    insert += text
    if (index < gaps.length) {
      segments.push({ oldFrom: gaps[index].from, oldTo: gaps[index].to, newFrom: spanFrom + insert.length, numberAt: -1, oldLength: 0, newLength: 0, gap: true })
      insert += doc.sliceString(gaps[index].from, gaps[index].to)
    }
  })

  const mapPosition = pos => {
    if (pos < spanFrom || pos > spanTo) return pos
    // An item before a gap: the end of an item's line is also where the gap
    // after it starts, and a caret there stays with its item
    const holds = s => pos >= s.oldFrom && pos <= s.oldTo
    const segment = segments.find(s => !s.gap && holds(s)) || segments.find(holds)
    if (!segment) return pos
    let offset = pos - segment.oldFrom
    if (segment.numberAt >= 0 && offset > segment.numberAt) {
      offset = offset >= segment.numberAt + segment.oldLength
        ? offset + segment.newLength - segment.oldLength
        : segment.numberAt + Math.min(offset - segment.numberAt, segment.newLength)
    }
    return segment.newFrom + offset
  }

  const ranges = state.selection.ranges.map(range => EditorSelection.range(mapPosition(range.anchor), mapPosition(range.head)))
  view.dispatch({
    changes: { from: spanFrom, to: spanTo, insert },
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    scrollIntoView: true,
    userEvent: 'move.line'
  })
  return true
}

export const listMoveKeymap = [
  { key: 'Mod-Shift-ArrowUp', run: view => moveListItems(view, false), preventDefault: false },
  { key: 'Mod-Shift-ArrowDown', run: view => moveListItems(view, true), preventDefault: false }
]
