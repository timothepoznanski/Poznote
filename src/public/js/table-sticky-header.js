/* table-sticky-header.js
   The header row of a long table stays in sight while the table scrolls past
   (discussion #1830).

   A plain `position: sticky` cannot do it: every Markdown table sits in a box
   that scrolls sideways (.markdown-table-scroll, #1701), as does a wide table
   of an HTML note and every table of a public page, and that box becomes the
   scroll container of anything sticky inside it, so the header would only
   stick to the box. Instead, once the header has left the top of the area
   the note scrolls in, a copy of it is drawn there, fixed, as wide as the
   part of the table that is visible, and moved sideways with the table.

   Only a real header is kept: a <thead>, or a first row made of <th> only
   (every Markdown table, tables pasted from elsewhere). The tables Poznote
   inserts in an HTML note have no header row, their first row is data.

   The copy lives on <body>, outside the note, so nothing of it is ever saved
   with the note; the styles the note's stylesheets give the cells are copied
   onto it from the computed style. It lets the pointer through
   (pointer-events: none): over it the wheel still scrolls the note, and a
   click reaches what is under it.
*/
(function () {
    'use strict';

    var TABLES = '.noteentry table, .markdown-preview table, .public-note .content table';

    // Cell styles the copy takes from the original: what the note's own
    // stylesheets decide, which a copy outside the note would lose
    var CELL_PROPS = [
        'background-color', 'color', 'font-family', 'font-size', 'font-weight',
        'font-style', 'line-height', 'letter-spacing', 'text-align',
        'vertical-align', 'white-space', 'text-transform',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'border-top-width', 'border-top-style', 'border-top-color',
        'border-right-width', 'border-right-style', 'border-right-color',
        'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
        'border-left-width', 'border-left-style', 'border-left-color'
    ];

    var box = null;        // the fixed copy on <body>
    var current = null;    // { table, signature }
    var scheduled = false;
    var watchTimer = null;

    function headerRows(table) {
        if (table.tHead && table.tHead.rows.length) {
            return table.rows.length > table.tHead.rows.length ? Array.prototype.slice.call(table.tHead.rows) : null;
        }
        var first = table.rows[0];
        // A header and nothing under it: nothing to keep it in sight for
        if (!first || !first.cells.length || table.rows.length < 2) return null;
        for (var i = 0; i < first.cells.length; i++) {
            if (first.cells[i].tagName !== 'TH') return null;
        }
        return [first];
    }

    function isTransparent(color) {
        return !color || color === 'transparent' || /rgba?\([^)]*,\s*0(\.0+)?\s*\)$/.test(color) || /\/\s*0(\.0+)?\s*\)$/.test(color);
    }

    // The colour actually painted behind an element: the first ancestor with
    // a background of its own
    function groundColor(el) {
        for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
            var color = window.getComputedStyle(node).backgroundColor;
            if (!isTransparent(color)) return color;
        }
        return window.getComputedStyle(document.body).backgroundColor || 'Canvas';
    }

    function scrollsVertically(el) {
        var overflow = window.getComputedStyle(el).overflowY;
        return (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && el.scrollHeight > el.clientHeight + 1;
    }

    // The area the table scrolls in: the nearest ancestor that scrolls
    // vertically (the note's column, the preview pane of the split view), or
    // the page itself. Its top is pushed down by the note toolbar, which
    // sticks there.
    function scrollArea(table) {
        var container = null;
        for (var el = table.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
            if (scrollsVertically(el)) { container = el; break; }
        }
        var area;
        if (container) {
            var rect = container.getBoundingClientRect();
            area = {
                top: Math.max(0, rect.top + container.clientTop),
                bottom: Math.min(window.innerHeight, rect.top + container.clientTop + container.clientHeight),
                left: rect.left + container.clientLeft,
                right: rect.left + container.clientLeft + container.clientWidth
            };
            var toolbar = container.querySelector('.note-header');
            if (toolbar && toolbar.contains(table) === false) {
                var bar = toolbar.getBoundingClientRect();
                if (bar.height > 0 && bar.top <= area.top + 1 && bar.bottom > area.top) area.top = bar.bottom;
            }
        } else {
            area = { top: 0, bottom: window.innerHeight, left: 0, right: document.documentElement.clientWidth };
        }
        return area;
    }

    // What clips the table sideways: the box it scrolls in (or the table
    // itself, for a wide table of an HTML note), else nothing but the area
    function sidewaysClip(table, area) {
        var left = area.left;
        var right = area.right;
        for (var el = table; el && el !== document.body; el = el.parentElement) {
            var overflow = window.getComputedStyle(el).overflowX;
            if (overflow !== 'visible') {
                var rect = el.getBoundingClientRect();
                left = Math.max(left, rect.left + el.clientLeft);
                right = Math.min(right, rect.left + el.clientLeft + el.clientWidth);
                break;
            }
            if (el.matches('.noteentry, .markdown-preview, .public-note .content')) break;
        }
        return { left: left, right: right };
    }

    // Column widths, read on a row whose cells each span one column: the
    // header row when it can, else the first body row that does
    function columnWidths(table, rows) {
        var candidates = rows.concat(Array.prototype.slice.call(table.rows));
        var columns = 0;
        for (var i = 0; i < table.rows.length; i++) {
            var count = 0;
            for (var j = 0; j < table.rows[i].cells.length; j++) count += table.rows[i].cells[j].colSpan || 1;
            columns = Math.max(columns, count);
        }
        for (var k = 0; k < candidates.length; k++) {
            var cells = candidates[k].cells;
            if (cells.length !== columns) continue;
            var widths = [];
            for (var c = 0; c < cells.length; c++) widths.push(cells[c].getBoundingClientRect().width);
            return widths;
        }
        return null;
    }

    function signatureOf(table, rows, widths) {
        var html = '';
        for (var i = 0; i < rows.length; i++) html += rows[i].innerHTML + '|' + rows[i].getBoundingClientRect().height;
        return html + '|' + table.getBoundingClientRect().width + '|' + (widths ? widths.join(',') : '');
    }

    function stripCopy(node) {
        if (node.nodeType !== 1) return;
        node.removeAttribute('id');
        node.removeAttribute('contenteditable');
        node.removeAttribute('tabindex');
        var all = node.querySelectorAll('[id], [contenteditable], [tabindex]');
        for (var i = 0; i < all.length; i++) {
            all[i].removeAttribute('id');
            all[i].removeAttribute('contenteditable');
            all[i].removeAttribute('tabindex');
        }
    }

    function build(table, rows, widths) {
        if (!box) {
            box = document.createElement('div');
            box.className = 'pz-table-sticky-head';
            box.setAttribute('aria-hidden', 'true');
            document.body.appendChild(box);
        }
        box.textContent = '';

        var tableStyle = window.getComputedStyle(table);
        var ground = groundColor(table);
        var copy = document.createElement('table');
        copy.style.setProperty('border-collapse', tableStyle.borderCollapse, 'important');
        copy.style.setProperty('border-spacing', tableStyle.borderSpacing, 'important');
        copy.style.setProperty('table-layout', widths ? 'fixed' : 'auto', 'important');
        copy.style.setProperty('width', table.getBoundingClientRect().width + 'px', 'important');
        copy.style.setProperty('margin', '0', 'important');
        copy.style.setProperty('direction', tableStyle.direction, 'important');

        if (widths) {
            var colgroup = document.createElement('colgroup');
            widths.forEach(function (width) {
                var col = document.createElement('col');
                col.style.width = width + 'px';
                colgroup.appendChild(col);
            });
            copy.appendChild(colgroup);
        }

        var body = document.createElement('tbody');
        rows.forEach(function (row) {
            var rowCopy = row.cloneNode(true);
            stripCopy(rowCopy);
            rowCopy.style.setProperty('height', row.getBoundingClientRect().height + 'px', 'important');
            for (var i = 0; i < row.cells.length && i < rowCopy.cells.length; i++) {
                var style = window.getComputedStyle(row.cells[i]);
                var cell = rowCopy.cells[i];
                CELL_PROPS.forEach(function (prop) {
                    cell.style.setProperty(prop, style.getPropertyValue(prop), 'important');
                });
                // A header without a ground of its own would let the rows
                // scrolling under it show through
                if (isTransparent(style.backgroundColor)) {
                    cell.style.setProperty('background-color', ground, 'important');
                }
                cell.style.setProperty('box-sizing', 'border-box', 'important');
            }
            body.appendChild(rowCopy);
        });
        copy.appendChild(body);
        box.style.backgroundColor = ground;
        box.appendChild(copy);
    }

    function hide() {
        if (box) box.style.display = 'none';
        current = null;
        if (watchTimer) {
            clearInterval(watchTimer);
            watchTimer = null;
        }
    }

    function update() {
        scheduled = false;
        var tables = document.querySelectorAll(TABLES);
        for (var i = 0; i < tables.length; i++) {
            var table = tables[i];
            if (table.parentElement && table.parentElement.closest('table')) continue;
            var rect = table.getBoundingClientRect();
            if (rect.height === 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
            var rows = headerRows(table);
            if (!rows) continue;

            var area = scrollArea(table);
            var headTop = rows[0].getBoundingClientRect().top;
            var headBottom = rows[rows.length - 1].getBoundingClientRect().bottom;
            var headHeight = headBottom - headTop;
            // The header is still in sight, or the table is about gone
            if (headTop >= area.top - 0.5 || rect.bottom - headHeight <= area.top) continue;
            if (rect.top >= area.bottom) continue;

            var clip = sidewaysClip(table, area);
            if (clip.right - clip.left <= 0) continue;

            var widths = columnWidths(table, rows);
            var signature = signatureOf(table, rows, widths);
            if (!current || current.table !== table || current.signature !== signature) {
                build(table, rows, widths);
                current = { table: table, signature: signature };
            }

            // Pushed up by the end of the table rather than drawn over the
            // text that follows it
            var top = Math.min(area.top, rect.bottom - headHeight);
            box.style.display = 'block';
            box.style.top = top + 'px';
            box.style.left = clip.left + 'px';
            box.style.width = (clip.right - clip.left) + 'px';
            box.style.height = headHeight + 'px';
            // Only the part under the area is shown when the end of the table
            // pushes the copy up
            var hiddenAbove = Math.max(0, area.top - top);
            box.style.clipPath = hiddenAbove > 0 ? 'inset(' + hiddenAbove + 'px 0 0 0)' : '';
            box.firstChild.style.transform = 'translateX(' + (rect.left - clip.left) + 'px)';

            // A note swapped or redrawn without a scroll takes the table away:
            // check now and then while the copy is shown
            if (!watchTimer) watchTimer = setInterval(schedule, 500);
            return;
        }
        hide();
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(update);
    }

    // Any element that scrolls: the note's column, a table's sideways box,
    // the split view's preview
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    // A cell written while its header is drawn up there
    document.addEventListener('input', function () {
        if (current) schedule();
    }, true);

    window.poznoteRefreshTableStickyHeader = schedule;
})();
