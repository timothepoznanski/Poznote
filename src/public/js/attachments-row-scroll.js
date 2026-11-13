/**
 * "Attachments on one line" setting (attachments_single_line, which puts
 * body.attachments-single-line): the links of a note's attachments row, or
 * its preview tiles when "Attachment previews" is on, stay on one line that
 * slides sideways. css/notes/attachments-row.css hides the
 * scrollbar; this file
 *   - marks a cut line, is-cut-start / is-cut-end on the list and on the row
 *     (the row draws the "…", the list fades out under it), and gives the row
 *     the list's box so the "…" sits on the line of links;
 *   - lets a mouse drag the line, as a finger already does. The pointer is
 *     captured only past a few pixels, so a plain click still downloads the
 *     attachment, and the click that ends a drag is swallowed.
 * Rows are rebuilt by js/attachments.js and come with every note load, so
 * they are found by observing the page rather than wired one by one.
 */
(function () {
    'use strict';

    // The links of the attachments row, and the preview tiles that take its
    // place when "Attachment previews" is on
    var LIST = '.note-attachments-list, .note-attachment-previews';
    var DRAG_SLOP = 4;

    function enabled() {
        return document.body.classList.contains('attachments-single-line');
    }

    function update(list) {
        // The row draws the "…" of its list of links; the tiles have no frame,
        // and a "…" inside them would fade out with them (placeMarks())
        var row = list.classList.contains('note-attachments-list') ? list.parentElement : null;
        // The browser's own drag of a link would take the gesture over (a
        // cancelled dragstart would not do: js/events-drag-drop.js counts on
        // the dragend that follows a dragstart)
        if (enabled()) {
            list.querySelectorAll('a[href], img').forEach(function (link) {
                if (link.draggable) link.draggable = false;
            });
        }
        var on = enabled() && list.clientWidth > 0;
        var room = list.scrollWidth - list.clientWidth;
        var cutStart = on && list.scrollLeft > 1;
        var cutEnd = on && room - list.scrollLeft > 1;
        list.classList.toggle('is-cut-start', cutStart);
        list.classList.toggle('is-cut-end', cutEnd);
        if (!row) {
            placeMarks(list, cutStart, cutEnd);
            return;
        }
        row.classList.toggle('is-cut-start', cutStart);
        row.classList.toggle('is-cut-end', cutEnd);
        if (cutStart || cutEnd) {
            row.style.setProperty('--att-list-top', list.offsetTop + 'px');
            row.style.setProperty('--att-list-height', list.offsetHeight + 'px');
            row.style.setProperty('--att-list-start', list.offsetLeft + 'px');
            row.style.setProperty('--att-list-end', (row.clientWidth - list.offsetLeft - list.offsetWidth) + 'px');
        }
    }

    // The tiles' "…": two marks right after them, absolutely placed over
    // their edges in the box they share with the tiles (the tiles are
    // position: relative, so that box is their offsetParent). Their static
    // position cannot do it: the note card is a flex column, where an
    // absolute child sits at the start of the box, not after its sibling.
    // The parent is watched too (watch()), so the marks follow when the
    // content above moves the tiles.
    function placeMarks(list, cutStart, cutEnd) {
        var marks = list._attCutMarks;
        if (!marks) {
            if (!cutStart && !cutEnd) return;
            marks = [0, 1].map(function () {
                var mark = document.createElement('span');
                mark.className = 'att-cut-mark';
                mark.setAttribute('aria-hidden', 'true');
                mark.textContent = '…';
                mark._attList = list;
                return mark;
            });
            list._attCutMarks = marks;
        }
        if (marks[0].previousSibling !== list || marks[1].previousSibling !== marks[0]) {
            list.after(marks[0], marks[1]);
        }
        var width = marks[0].offsetWidth || 14;
        marks.forEach(function (mark, i) {
            var shown = i === 0 ? cutStart : cutEnd;
            mark.hidden = !shown;
            if (!shown) return;
            mark.style.top = list.offsetTop + 'px';
            mark.style.height = list.offsetHeight + 'px';
            mark.style.left = (i === 0 ? list.offsetLeft : list.offsetLeft + list.offsetWidth - width) + 'px';
        });
    }

    var watched = typeof WeakSet === 'function' ? new WeakSet() : null;
    var resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(function (entries) {
            entries.forEach(function (entry) { update(entry.target); });
        })
        : null;
    // The box holding preview tiles: when it changes size, the content above
    // the tiles may have moved them
    var parentObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(function (entries) {
            entries.forEach(function (entry) {
                Array.prototype.forEach.call(entry.target.children, function (child) {
                    if (child.classList.contains('note-attachment-previews')) update(child);
                });
            });
        })
        : null;
    // Links shown or hidden (style), added or removed inside a list
    var listObserver = typeof MutationObserver === 'function'
        ? new MutationObserver(function (records) {
            var seen = [];
            records.forEach(function (record) {
                var target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                var list = target && target.closest ? target.closest(LIST) : null;
                if (list && seen.indexOf(list) === -1) seen.push(list);
            });
            seen.forEach(update);
        })
        : null;

    function watch(list) {
        if (watched) {
            if (watched.has(list)) {
                update(list);
                return;
            }
            watched.add(list);
        }
        list.addEventListener('scroll', function () { update(list); }, { passive: true });
        if (resizeObserver) {
            resizeObserver.observe(list);
            if (!list.classList.contains('note-attachments-list') && list.parentElement) {
                parentObserver.observe(list.parentElement);
            }
        }
        if (listObserver) listObserver.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        update(list);
    }

    function scan() {
        // Marks of tiles that left the page (a note closed, a refresh that
        // found nothing to show)
        document.querySelectorAll('.att-cut-mark').forEach(function (mark) {
            if (!mark._attList || !mark._attList.isConnected) mark.remove();
        });
        document.querySelectorAll(LIST).forEach(watch);
    }

    var scanQueued = false;
    function queueScan() {
        if (scanQueued) return;
        scanQueued = true;
        requestAnimationFrame(function () {
            scanQueued = false;
            scan();
        });
    }

    /* Mouse drag */
    var drag = null;
    var swallowClick = false;

    document.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'mouse' || e.button !== 0 || !enabled()) return;
        var list = e.target && e.target.closest ? e.target.closest(LIST) : null;
        if (!list || list.scrollWidth <= list.clientWidth) return;
        drag = { list: list, pointerId: e.pointerId, x: e.clientX, scroll: list.scrollLeft, moving: false };
    });

    document.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        var dx = e.clientX - drag.x;
        if (!drag.moving) {
            if (Math.abs(dx) < DRAG_SLOP) return;
            drag.moving = true;
            drag.list.classList.add('is-dragging');
            try { drag.list.setPointerCapture(e.pointerId); } catch (err) { /* released already */ }
        }
        drag.list.scrollLeft = drag.scroll - dx;
        e.preventDefault();
    });

    function endDrag(e) {
        if (!drag || (e && e.pointerId !== drag.pointerId)) return;
        if (drag.moving) {
            drag.list.classList.remove('is-dragging');
            if (e && e.type === 'pointerup') {
                swallowClick = true;
                setTimeout(function () { swallowClick = false; }, 0);
            }
        }
        drag = null;
    }
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    document.addEventListener('click', function (e) {
        if (!swallowClick) return;
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    function init() {
        scan();
        if (typeof MutationObserver === 'function') {
            new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
