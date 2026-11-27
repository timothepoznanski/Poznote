/**
 * Note statistics: the characters, words and lines of the note on screen,
 * written at the end of the small line under its title (.note-sub-stats,
 * note_display.php), and the modification date on that same line, rewritten
 * after each save.
 *
 * What is counted depends on the note:
 *   - Markdown: its source, as typed (the lines are the ones of the editor);
 *   - rich text: the text as it reads, one line per paragraph, list item,
 *     table row or line of a code block;
 *   - task list: the text of the tasks and subtasks, one line each.
 *
 * Nothing calls this module to say the note changed: it watches #right_col,
 * which sees a note being opened, typed in, pasted into, undone, merged from
 * another tab or rewritten by a menu alike, and recounts once things settle.
 */
(function () {
    'use strict';

    var RECOUNT_DELAY_MS = 400;
    // Longest wait for an idle moment once typing has paused: past it the
    // count runs anyway, so the figures never stay stale on a busy page
    var IDLE_TIMEOUT_MS = 2000;

    var UNITS = ['characters', 'words', 'lines'];
    var DEFAULT_LABELS = {
        characters: { one: '{{count}} character', other: '{{count}} characters' },
        words: { one: '{{count}} word', other: '{{count}} words' },
        lines: { one: '{{count}} line', other: '{{count}} lines' }
    };

    // Elements that start a line of their own in a rich text note
    var BLOCK_TAGS = /^(?:ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DETAILS|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|HR|LI|OL|P|PRE|SECTION|SUMMARY|TABLE|TR|UL)$/;
    // Controls and embedded media: their text, if any, is not the note's
    var SKIPPED_TAGS = /^(?:AUDIO|BUTTON|CANVAS|IFRAME|INPUT|OBJECT|SCRIPT|SELECT|STYLE|SVG|TEMPLATE|TEXTAREA|VIDEO)$/i;
    // Zero-width characters the editors leave around the caret
    var INVISIBLE_CHARS = /\u200B|\u200C|\u200D|\u2060|\uFEFF/g;
    // Written without spaces between words: every character counts as a word
    var HAN_KANA_CHARS = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
    var WORD_CHAR = /[\p{L}\p{N}]/u;

    var recountTimer = null;
    var idleHandle = null;
    // A recount skipped because every figure was hidden: the figures on
    // screen are stale until one of them is shown again
    var skippedWhileHidden = false;

    /**
     * Characters (spaces included, line breaks excluded), words and lines of
     * a plain text. Blank lines count, except the ones trailing at the end.
     */
    function countText(text) {
        text = String(text || '')
            .replace(/\r\n?/g, '\n')
            .replace(/\u00A0/g, ' ')
            .replace(INVISIBLE_CHARS, '');

        var body = text.trimEnd();
        if (body === '') {
            return { characters: 0, words: 0, lines: 0 };
        }

        // A tab is only ever the boundary between two table cells here
        // (richTextOf), not something that was typed
        var characters = body.replace(/[\n\t]/g, '')
            .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length;

        var hanKana = body.match(HAN_KANA_CHARS);
        var words = hanKana ? hanKana.length : 0;
        var tokens = body.replace(HAN_KANA_CHARS, ' ').split(/\s+/);
        for (var i = 0; i < tokens.length; i++) {
            // "##", "-" or "|" on their own are syntax, not words
            if (tokens[i] !== '' && WORD_CHAR.test(tokens[i])) {
                words++;
            }
        }

        return { characters: characters, words: words, lines: body.split('\n').length };
    }

    /**
     * The text of a rich text note, one line per block, without asking the
     * browser for a layout (innerText would, on every recount).
     */
    function richTextOf(root) {
        // Pieces joined at the end, with the last character kept aside:
        // reading it back from a string being built piece by piece makes the
        // engine flatten that string every time, seconds on a long note
        var pieces = [];
        var last = '';

        function push(piece) {
            if (piece !== '') {
                pieces.push(piece);
                last = piece.charAt(piece.length - 1);
            }
        }

        function endLine() {
            if (last !== '' && last !== '\n') {
                push('\n');
            }
        }

        function walk(node, preformatted) {
            for (var child = node.firstChild; child; child = child.nextSibling) {
                if (child.nodeType === Node.TEXT_NODE) {
                    var value = child.nodeValue || '';
                    if (!preformatted) {
                        // Line breaks and indentation of the markup itself
                        value = value.replace(/[ \t\r\n]+/g, ' ');
                        if (last === '' || last === '\n' || last === '\t' || last === ' ') {
                            value = value.replace(/^ /, '');
                        }
                    }
                    push(value);
                    continue;
                }
                if (child.nodeType !== Node.ELEMENT_NODE) {
                    continue;
                }

                var tag = child.tagName;
                // excalidraw-data is the diagram's JSON, kept in the note
                // out of sight: megabytes of it are not text the note shows
                if (SKIPPED_TAGS.test(tag) || child.hidden || child.classList.contains('excalidraw-data')) {
                    continue;
                }
                if (tag === 'BR') {
                    push('\n');
                    continue;
                }
                if ((tag === 'TD' || tag === 'TH') && child.previousElementSibling) {
                    push('\t');
                }

                var isBlock = BLOCK_TAGS.test(tag);
                if (isBlock) {
                    endLine();
                }
                walk(child, preformatted || tag === 'PRE');
                if (isBlock) {
                    endLine();
                }
            }
        }

        walk(root, false);
        return pieces.join('');
    }

    /** The text of a task list: one line per task, then its subtasks */
    function taskListTextOf(entry) {
        var tasks;
        try {
            tasks = JSON.parse(entry.getAttribute('data-tasklist-json') || '[]');
        } catch (e) {
            tasks = [];
        }
        if (!Array.isArray(tasks)) {
            return '';
        }

        var lines = [];
        tasks.forEach(function (task) {
            if (!task || typeof task !== 'object') {
                return;
            }
            lines.push(String(task.text || '').replace(/\s*\n\s*/g, ' '));
            if (Array.isArray(task.subtasks)) {
                task.subtasks.forEach(function (subtask) {
                    if (subtask && typeof subtask === 'object') {
                        lines.push(String(subtask.text || '').replace(/\s*\n\s*/g, ' '));
                    }
                });
            }
        });
        return lines.join('\n');
    }

    function noteTextOf(entry, noteId) {
        var type = entry.getAttribute('data-note-type') || 'note';

        if (type === 'markdown') {
            var source = (typeof window.getMarkdownContentForNote === 'function')
                ? window.getMarkdownContentForNote(noteId)
                : null;
            if (typeof source !== 'string') {
                source = entry.getAttribute('data-markdown-content') || '';
            }
            return source;
        }
        if (type === 'tasklist') {
            return taskListTextOf(entry);
        }
        return richTextOf(entry);
    }

    function pageLanguage() {
        return document.documentElement.lang || (window.POZNOTE_I18N && window.POZNOTE_I18N.lang) || 'en';
    }

    function pluralForm(count) {
        try {
            return new Intl.PluralRules(pageLanguage()).select(count);
        } catch (e) {
            return count === 1 ? 'one' : 'other';
        }
    }

    function formatCount(count) {
        try {
            return count.toLocaleString(pageLanguage());
        } catch (e) {
            return String(count);
        }
    }

    function readLabels(holder) {
        try {
            var labels = JSON.parse(holder.getAttribute('data-labels') || '{}');
            return (labels && typeof labels === 'object') ? labels : {};
        } catch (e) {
            return {};
        }
    }

    function readCopyLabels(holder) {
        try {
            var labels = JSON.parse(holder.getAttribute('data-copy-labels') || '{}');
            return (labels && typeof labels === 'object') ? labels : {};
        } catch (e) {
            return {};
        }
    }

    function renderStats(holder, stats) {
        var labels = readLabels(holder);
        var copyLabels = readCopyLabels(holder);
        UNITS.forEach(function (unit) {
            var forms = (labels[unit] && typeof labels[unit] === 'object') ? labels[unit] : DEFAULT_LABELS[unit];
            var template = forms[pluralForm(stats[unit])] || forms.other || DEFAULT_LABELS[unit].other;
            var text = String(template).split('{{count}}').join(formatCount(stats[unit]));

            // One entry per figure, rendered empty by note_display.php: each
            // has its own checkbox in the "Element visibility" modal
            var item = holder.querySelector('[data-stat="' + unit + '"]');
            if (!item) {
                item = document.createElement('span');
                item.className = 'note-sub-stat note-sub-stat-' + unit;
                item.setAttribute('data-stat', unit);
                holder.appendChild(item);
            }
            // Clicking the figure copies the bare number (js/index-events.js,
            // copy-note-meta), like the note id: a button inside the entry,
            // whose dot stays outside it (css/notes/subline.css)
            var button = item.querySelector('.note-sub-copy-btn');
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'note-sub-copy-btn';
                button.setAttribute('data-action', 'copy-note-meta');
                if (copyLabels[unit]) {
                    button.title = String(copyLabels[unit]);
                    button.setAttribute('aria-label', String(copyLabels[unit]));
                }
                item.textContent = '';
                item.appendChild(button);
            }
            // Written only when it changed: this module watches the column
            // it writes into
            var raw = String(stats[unit]);
            if (button.getAttribute('data-copy-value') !== raw) {
                button.setAttribute('data-copy-value', raw);
            }
            if (button.textContent !== text) {
                button.textContent = text;
            }
        });
    }

    /**
     * With a mouse, pressing on the strip and moving drags it sideways: its
     * text is not selectable (css/notes/subline.css). Touch and trackpads
     * scroll it natively.
     */
    function wireSublineDrag(list) {
        var DRAG_THRESHOLD = 4;
        var startX = 0;
        var startScroll = 0;
        var pointerId = null;
        var pending = false;
        var dragging = false;
        var dragged = false;

        list.addEventListener('pointerdown', function (e) {
            if (e.pointerType !== 'mouse' || e.button !== 0) {
                return;
            }
            // The capture is taken on the first move, not here: capturing the
            // pointer right away makes the browser fire the click on the
            // strip instead of on whatever was pressed, which left nothing
            // inside the strip clickable (the note id entry).
            pending = true;
            dragging = false;
            dragged = false;
            pointerId = e.pointerId;
            startX = e.clientX;
            startScroll = list.scrollLeft;
        });
        list.addEventListener('pointermove', function (e) {
            if (pending && Math.abs(e.clientX - startX) > DRAG_THRESHOLD) {
                pending = false;
                dragging = true;
                dragged = true;
                try { list.setPointerCapture(pointerId); } catch (err) { /* pointer already gone */ }
            }
            if (dragging) {
                list.scrollLeft = startScroll - (e.clientX - startX);
            }
        });
        function stop() {
            pending = false;
            dragging = false;
        }
        list.addEventListener('pointerup', stop);
        list.addEventListener('pointercancel', stop);
        list.addEventListener('lostpointercapture', stop);
        // Letting go after dragging the strip must not also press whatever
        // ended up under the pointer
        list.addEventListener('click', function (e) {
            if (dragged) {
                dragged = false;
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    /**
     * The entries of the line stay on one row, in a strip that scrolls
     * sideways like the tags: the helpers of js/clickable-tags.js give it the
     * wheel and the faded edges (no chevrons here). Wired once per line, then
     * only told that its content may have changed width.
     */
    function syncSublineScroll(holder) {
        var list = holder.closest('.note-subline-list');
        if (!list || typeof window.wireTagsListScroll !== 'function') {
            return;
        }
        if (list.getAttribute('data-scroll-wired') === '1') {
            window.updateTagsListFade(list);
            return;
        }
        list.setAttribute('data-scroll-wired', '1');
        wireSublineDrag(list);
        // The information icon follows the strip: when every entry of the
        // strip is hidden ("Element visibility"), it opens the line and
        // starts where the line does (css/notes/subline.css)
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(function () {
                list.parentElement.classList.toggle('no-entries', list.offsetWidth === 0);
            }).observe(list);
        }
        window.wireTagsListScroll(list);
    }

    /**
     * Whether at least one figure is shown. Each has its own checkbox in
     * "Element visibility"; with the three unticked, counting reads the
     * whole note for nothing (a tenth of a second on a note of a few
     * megabytes). Read from the hidden keys, not from the page: asking an
     * element whether it is displayed forces a style recalculation of the
     * note being typed in.
     */
    function statsShown() {
        var ui = window.PoznoteUiCustomization;
        if (!ui || typeof ui.isHidden !== 'function') {
            return true;
        }
        for (var i = 0; i < UNITS.length; i++) {
            if (!ui.isHidden('panel:note-stats-' + UNITS[i])) {
                return true;
            }
        }
        return false;
    }

    function cancelScheduledRecount() {
        if (recountTimer !== null) {
            clearTimeout(recountTimer);
            recountTimer = null;
        }
        if (idleHandle !== null) {
            if (typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(idleHandle);
            }
            idleHandle = null;
        }
    }

    function recount() {
        cancelScheduledRecount();
        var shown = statsShown();
        skippedWhileHidden = !shown;
        var holders = document.querySelectorAll('#right_col .note-sub-stats');
        for (var i = 0; i < holders.length; i++) {
            var holder = holders[i];
            var noteId = holder.getAttribute('data-note-id');
            var entry = (shown && noteId) ? document.getElementById('entry' + noteId) : null;
            if (entry) {
                renderStats(holder, countText(noteTextOf(entry, noteId)));
            }
            syncSublineScroll(holder);
        }
    }

    /**
     * After typing, the note is recounted once it pauses, and then only when
     * the browser has nothing else to do: on a long note the count takes a
     * noticeable moment, which must not land in the middle of an animation,
     * a scroll or the reply to a click. Browsers without requestIdleCallback
     * count right after the pause.
     */
    function scheduleRecount() {
        cancelScheduledRecount();
        recountTimer = setTimeout(function () {
            recountTimer = null;
            if (typeof window.requestIdleCallback === 'function') {
                idleHandle = window.requestIdleCallback(function () {
                    idleHandle = null;
                    recount();
                }, { timeout: IDLE_TIMEOUT_MS });
            } else {
                recount();
            }
        }, RECOUNT_DELAY_MS);
    }

    function isOwnMutation(mutation) {
        var target = mutation.target;
        if (target && target.nodeType !== Node.ELEMENT_NODE) {
            target = target.parentNode;
        }
        return !!(target && target.closest && target.closest('.note-subline'));
    }

    /**
     * A line under a title that has just arrived (a note opened, swapped in
     * or rendered again): its figures are still empty. Filling them after
     * the delay made them pop in once the note was already on screen and
     * pushed the information icon sideways, so a new line is counted in the
     * same turn, before the browser paints it.
     */
    function addsStatsLine(mutation) {
        var added = mutation.addedNodes;
        for (var i = 0; i < added.length; i++) {
            var node = added[i];
            if (node.nodeType !== Node.ELEMENT_NODE) {
                continue;
            }
            if (node.classList.contains('note-sub-stats') || node.querySelector('.note-sub-stats')) {
                return true;
            }
        }
        return false;
    }

    function watch() {
        var column = document.getElementById('right_col');
        if (!column) {
            return;
        }

        recount();

        if (typeof MutationObserver !== 'function') {
            return;
        }
        new MutationObserver(function (mutations) {
            var changed = false;
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].type === 'childList' && addsStatsLine(mutations[i])) {
                    // A MutationObserver runs before the next paint
                    recount();
                    return;
                }
                if (!changed && !isOwnMutation(mutations[i])) {
                    changed = true;
                }
            }
            if (changed) {
                scheduleRecount();
            }
        }).observe(column, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
            // Where a task list and a Markdown note in preview keep their content
            attributeFilter: ['data-tasklist-json', 'data-markdown-content']
        });

        // A figure shown again after counts were skipped: fill it now
        document.addEventListener('poznote-ui-customization-updated', function () {
            if (skippedWhileHidden && statsShown()) {
                recount();
            }
        });
    }

    /**
     * The server confirmed a save of the note (js/notes.js): show the
     * modification date it recorded, already in the user's timezone and format.
     */
    window.setNoteModifiedDate = function (noteId, dateText) {
        var holder = document.getElementById('noteUpdated' + noteId);
        if (!holder || !dateText) {
            return;
        }
        var label = holder.getAttribute('data-label') || '{{date}}';
        var text = label.split('{{date}}').join(String(dateText));
        // The date sits in the button that copies it (note_display.php)
        var button = holder.querySelector('.note-sub-copy-btn');
        if (button) {
            button.textContent = text;
            button.setAttribute('data-copy-value', String(dateText));
        } else {
            holder.textContent = text;
        }
    };

    // Recount now rather than after the delay (tests, callers that just
    // replaced the note)
    window.refreshNoteStats = recount;

    /**
     * The counts of a note on screen, as numbers and as text in the page
     * language, for the note information dialog (js/note-info-modal.js). Null
     * when the note is not the one on screen. Counted on demand: it does not
     * depend on the line under the title being shown.
     */
    window.getNoteStats = function (noteId) {
        var entry = noteId ? document.getElementById('entry' + noteId) : null;
        if (!entry) {
            return null;
        }
        var stats = countText(noteTextOf(entry, String(noteId)));
        stats.formatted = {};
        UNITS.forEach(function (unit) {
            stats.formatted[unit] = formatCount(stats[unit]);
        });
        return stats;
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watch);
    } else {
        watch();
    }
})();
