/**
 * A table of an HTML note that is wider than the note scrolls sideways in its
 * own box, its bar right under it, instead of running past the note's edge
 * where the column clips it (a Markdown table has its own box already,
 * .markdown-table-scroll from js/markdown-parser.js).
 *
 * The table itself becomes the box (css/markdown.css, display: block), only
 * while it is too wide: a block table no longer stretches to the note width,
 * so a table that fits keeps its normal layout. Nothing is wrapped around it,
 * the note's DOM is what gets saved; the marker is display state, removed
 * from the saved copy by stripSearchHighlights() (js/notes.js) and not on
 * the server sanitizer's list for a table either.
 */
(function () {
    'use strict';

    var ATTR = 'data-pz-table-scroll';
    var frame = 0;
    var observed = typeof WeakSet === 'function' ? new WeakSet() : null;
    var resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;

    /** Width (px) a table may take: the content box of its container. */
    function availableWidth(table) {
        var parent = table.parentElement;
        if (!parent) return 0;
        var style = window.getComputedStyle(parent);
        return parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    }

    function isTooWide(table) {
        var available = availableWidth(table);
        return available > 0 && table.offsetWidth > available + 1;
    }

    function update(table) {
        if (!table.hasAttribute(ATTR)) {
            if (isTooWide(table)) table.setAttribute(ATTR, '');
            return;
        }
        // Still scrolling: its content is wider than the box, so it is wider
        // than the note in the normal layout too
        if (table.scrollWidth > table.clientWidth + 1) return;
        // Otherwise measure it in the normal layout (a column was removed,
        // the note got wider, or a width of its own that the box caps)
        var scrollLeft = table.scrollLeft;
        table.removeAttribute(ATTR);
        if (isTooWide(table)) {
            table.setAttribute(ATTR, '');
            table.scrollLeft = scrollLeft;
        }
    }

    function run() {
        frame = 0;
        var entries = document.querySelectorAll('.noteentry:not([data-note-type="markdown"]):not([data-note-type="tasklist"])');
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry.offsetParent) continue;
            if (resizeObserver && observed && !observed.has(entry)) {
                observed.add(entry);
                resizeObserver.observe(entry);
            }
            var tables = entry.querySelectorAll('table');
            for (var t = 0; t < tables.length; t++) {
                var table = tables[t];
                // (a table in a cell scrolls with its host)
                if (table.parentElement && table.parentElement.closest('table')) continue;
                if (table.closest('.markdown-table-scroll')) continue;
                update(table);
            }
        }
    }

    function schedule() {
        if (!frame) frame = requestAnimationFrame(run);
    }

    // The browser keeps the caret in sight when it moves it (typing, arrows),
    // not when a script does (Tab to the next cell, js/table-cell-selection.js)
    var caretFrame = 0;
    function revealCaret() {
        caretFrame = 0;
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.focusNode) return;
        var node = sel.focusNode.nodeType === 3 ? sel.focusNode.parentElement : sel.focusNode;
        var cell = node && node.closest ? node.closest('td, th') : null;
        var table = cell ? cell.closest('table[' + ATTR + ']') : null;
        if (!table || !table.closest('.noteentry') || cell.closest('table') !== table) return;
        var caret = document.createRange();
        caret.setStart(sel.focusNode, sel.focusOffset);
        caret.collapse(true);
        var rect = caret.getBoundingClientRect();
        if (!rect.height) rect = cell.getBoundingClientRect();
        var box = table.getBoundingClientRect();
        var margin = 16;
        if (rect.left < box.left + margin) {
            table.scrollLeft -= box.left + margin - rect.left;
        } else if (rect.right > box.right - margin) {
            table.scrollLeft += rect.right - (box.right - margin);
        }
    }

    function onSelectionChange() {
        if (!caretFrame) caretFrame = requestAnimationFrame(revealCaret);
    }

    function onInput(e) {
        if (e.target && e.target.closest && e.target.closest('.noteentry')) schedule();
    }

    function init() {
        // A note loaded, a table inserted, rows or columns added or removed
        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var target = mutations[i].target;
                if (target.closest && target.closest('#right_col')) {
                    schedule();
                    return;
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
        document.addEventListener('input', onInput, true);
        document.addEventListener('selectionchange', onSelectionChange);
        window.addEventListener('resize', schedule);
        schedule();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
