// Blocks of lines that scroll sideways on their own, inside an editor that
// wraps its other lines:
// - a fenced code block with "Code block word wrap" off (.cm-live-code-block,
//   live-preview.js)
// - the rows of a table shown as source (.cm-md-table-block, below): a table
//   row never wraps, its pipes would no longer line up (#1701), and the rows
//   scroll as one block under their own scrollbar instead of the whole editor
//   moving sideways (discussion #1835)
//
// Such a block's own sideways scroll is not one CodeMirror knows about.
// - Bringing the caret into view: CodeMirror only scrolls the editor and the
//   page, so a caret moved past the visible part of a long line (End, the
//   arrow keys) stayed out of sight. The block scrolls to it first, then
//   CodeMirror goes on with the vertical scroll. Layout is read from the DOM:
//   the view is mid-update here (see scrollPastHiddenSyntax in main.js).
// - Drawing the caret and the selection: they sit in a layer measured against
//   the editor, which a scroll inside the block does not refresh, so they
//   stayed where the text had been. The scroll redraws them.
import { StateField } from '@codemirror/state'
import { BlockWrapper, EditorView, ViewPlugin } from '@codemirror/view'

const SIDEWAYS_BLOCKS = '.cm-live-code-block, .cm-md-table-block'
const CARET_MARGIN = 30

// ─── The rows of a table shown as source ─────────────────────────────────────

const tableBlockWrapper = BlockWrapper.create({ tagName: 'div', attributes: { class: 'cm-md-table-block' } })

// A line markdown.css draws as a table row (cm-md-table-line, main.js)
export function isMarkdownTableSourceLine(text) {
  return /^[ \t]*\|/.test(text)
}

// Every run of table rows, outside fenced code blocks (whose lines are code:
// in the live views their block has its own wrapper). The whole document is
// read, not the viewport: a wrapper whose range changed with the viewport
// would be built anew and lose its scroll position.
function buildTableBlocks(doc) {
  const ranges = []
  let fence = null
  let run = null
  let number = 0
  const close = () => {
    if (run) ranges.push(tableBlockWrapper.range(run.from, run.to))
    run = null
  }
  for (const text of doc.iterLines()) {
    number++
    const fenceMatch = /^\s*(```+|~~~+)\s*([^\s`]*)/.exec(text)
    if (fence) {
      if (fenceMatch && fenceMatch[1].charAt(0) === fence && !fenceMatch[2]) fence = null
      continue
    }
    if (fenceMatch) {
      close()
      fence = fenceMatch[1].charAt(0)
      continue
    }
    if (isMarkdownTableSourceLine(text)) {
      const line = doc.line(number)
      if (run) run.to = line.to
      else run = { from: line.from, to: line.to }
    } else {
      close()
    }
  }
  close()
  return BlockWrapper.set(ranges, true)
}

const tableBlocksField = StateField.define({
  create: state => buildTableBlocks(state.doc),
  update: (value, transaction) => transaction.docChanged ? buildTableBlocks(transaction.state.doc) : value,
  provide: field => EditorView.blockWrappers.from(field)
})

// ─── Their sideways scroll ───────────────────────────────────────────────────

const caretIntoBlock = EditorView.scrollHandler.of((view, range) => {
  let at
  try {
    at = view.domAtPos(range.head)
  } catch (_error) {
    return false
  }
  const element = at.node.nodeType === 1 ? at.node : at.node.parentElement
  const block = element && element.closest ? element.closest(SIDEWAYS_BLOCKS) : null
  if (!block || block.scrollWidth <= block.clientWidth) return false

  const caret = document.createRange()
  try {
    caret.setStart(at.node, at.offset)
    caret.setEnd(at.node, at.offset)
  } catch (_error) {
    return false
  }
  const rect = caret.getClientRects()[0]
  if (!rect) return false

  const box = block.getBoundingClientRect()
  if (rect.left < box.left + CARET_MARGIN) {
    block.scrollLeft -= box.left + CARET_MARGIN - rect.left
  } else if (rect.right > box.right - CARET_MARGIN) {
    block.scrollLeft += rect.right - (box.right - CARET_MARGIN)
  }
  return false
})

const redrawLayersOnScroll = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view
    this.frame = 0
    this.onScroll = event => {
      const target = event.target
      if (!target || !target.matches || !target.matches(SIDEWAYS_BLOCKS)) return
      if (this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        // (the same selection again: the layers are redrawn on any
        // selection change, and nothing else is)
        if (!this.view.destroyed) this.view.dispatch({ selection: this.view.state.selection })
      })
    }
    // (scroll does not bubble: listened to on the way down)
    view.contentDOM.addEventListener('scroll', this.onScroll, true)
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.view.contentDOM.removeEventListener('scroll', this.onScroll, true)
  }
})

export const sidewaysScroll = [tableBlocksField, caretIntoBlock, redrawLayersOnScroll]
