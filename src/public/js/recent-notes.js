// ============================================================================
// Recent notes section
// ============================================================================
// The "Recent notes" section of the notes tree, under Favorites
// (notes_list.php): the notes last opened in the workspace, most recent first.
//
// The server renders it from recently_opened_notes, but notes open without a
// page load: each note shown moves to the top of the section here, its row
// copied from the tree when the section did not list it yet, and the rows
// past the limit leave. The server records the opening itself (index.php for
// a note it serves, POST /notes/{id}/opened for one restored from the DOM
// cache), so the next rebuild of the tree gives the same order.
//
// How many notes it lists is recent_notes_count (lib/recent-notes.php): the
// section holds up to data-recent-max rows, those past data-recent-limit
// hidden, so the slider of its menu shows or hides rows on the spot and saves
// once released.
//
// Its menu (right-click on the header, or its three-dot toggle) holds that
// slider and leads to the Element visibility row that hides the section.
// Closing on an outside click is done by the listener js/utils-menus.js keeps
// for every .folder-actions-menu.
//
// A note opened from this section or from Favorites is also shown in the tree
// below the rule. For that, this file pins the top of the tree
// (.tree-pinned-top: Favorites, Recent notes and the rule under them) until
// the reader scrolls the column themselves.

(function () {
    'use strict';

    var SECTION = '#left_col .recent-notes-section';
    // Rows that only stand in for a note shown further down the tree
    var PSEUDO_SECTIONS = '.folder-header[data-folder="Favorites"], .recent-notes-section';

    function getMenu() {
        return document.getElementById('recent-actions-menu');
    }

    function getToggle() {
        return document.querySelector('[data-action="toggle-recent-menu"]');
    }

    function isOpen() {
        var menu = getMenu();
        return !!(menu && menu.classList.contains('show'));
    }

    function close() {
        var menu = getMenu();
        if (menu) menu.classList.remove('show');
        var toggle = getToggle();
        if (toggle) toggle.classList.remove('open');
    }

    function closeOtherMenus() {
        if (typeof closeFolderActionsMenu === 'function') closeFolderActionsMenu();
        if (typeof closeNoteActionsMenu === 'function') closeNoteActionsMenu();
        if (typeof window.closeFavoritesMenu === 'function') window.closeFavoritesMenu();
        if (typeof window.closeCreateMenu === 'function') window.closeCreateMenu();
    }

    // The slider may be hidden from Element visibility: no rule left above
    // the next entry then (measured once the menu shows)
    function syncSeparators(menu) {
        if (typeof window.syncActionsMenuSeparators === 'function') window.syncActionsMenuSeparators(menu);
    }

    // Returns false when the menu is not on the page (no Recent notes section)
    function openAtPoint(x, y) {
        var menu = getMenu();
        if (!menu || typeof positionMenuAtPoint !== 'function') return false;
        closeOtherMenus();
        menu.classList.add('show');
        syncSeparators(menu);
        positionMenuAtPoint(menu, x, y);
        return true;
    }

    function openFromToggle(toggle) {
        var menu = getMenu();
        if (!menu || typeof adjustMenuPosition !== 'function') return;
        if (isOpen()) {
            close();
            return;
        }
        closeOtherMenus();
        menu.classList.add('show');
        syncSeparators(menu);
        toggle.classList.add('open');
        adjustMenuPosition(menu, toggle);
    }

    function revealVisibility() {
        if (typeof window.poznoteRevealVisibilityKey === 'function') {
            window.poznoteRevealVisibilityKey('panel:recent-notes');
            return;
        }
        var contextMenu = window.PoznoteIconContextMenu;
        if (contextMenu && typeof contextMenu.revealKey === 'function') {
            contextMenu.revealKey('panel:recent-notes');
        } else {
            window.location.href = 'settings.php?open=ui-customization';
        }
    }

    // ------------------------------------------------------------------
    // Live order
    // ------------------------------------------------------------------

    function rowsOf(content) {
        return Array.prototype.filter.call(content.children, function (child) {
            return child.classList.contains('note-list-item');
        });
    }

    function findRow(content, id) {
        var rows = rowsOf(content);
        for (var i = 0; i < rows.length; i++) {
            var link = rows[i].querySelector('a.links_arbo_left');
            if (link && link.getAttribute('data-note-id') === id) return rows[i];
        }
        return null;
    }

    // The note's row in the tree proper, copied into the section: the same
    // markup the server renders there (renderNoteListItem()), its actions
    // toggle included, without the marks that belong to the tree only
    function copyTreeRow(id) {
        var links = document.querySelectorAll('#left_col .note-list-item > a.links_arbo_left[data-note-id="' + CSS.escape(id) + '"]');
        var source = null;
        for (var i = 0; i < links.length; i++) {
            if (!links[i].closest(PSEUDO_SECTIONS)) {
                source = links[i];
                break;
            }
        }
        if (!source) return null;

        var row = source.parentElement.cloneNode(true);
        row.classList.remove('note-drop-before', 'note-drop-after', 'tree-multi-selected');
        var link = row.querySelector('a.links_arbo_left');
        if (link) {
            link.classList.remove('note-in-subfolder', 'note-without-folder', 'dragging', 'has-offline-mark', 'tree-multi-selected');
            link.classList.add('note-in-folder');
        }
        row.querySelectorAll('.offline-mark').forEach(function (mark) { mark.remove(); });
        return row;
    }

    function gapAfter(row) {
        var next = row.nextElementSibling;
        return next && next.classList.contains('pxbetweennotes') ? next : null;
    }

    function limitOf(section) {
        return parseInt(section.getAttribute('data-recent-limit'), 10) || 5;
    }

    // Rows past the count hidden, with the gap after each
    function applyLimit(section) {
        var content = section ? section.querySelector(':scope > .folder-content') : null;
        if (!content) return;
        var limit = limitOf(section);
        rowsOf(content).forEach(function (row, index) {
            var hide = index >= limit;
            row.hidden = hide;
            var gap = gapAfter(row);
            if (gap) gap.hidden = hide;
        });
    }

    function touch(noteId) {
        var section = document.querySelector(SECTION);
        var content = section ? section.querySelector(':scope > .folder-content') : null;
        if (!content || noteId === null || noteId === undefined) return;
        var id = String(noteId);
        if (!/^\d+$/.test(id)) return;

        var row = findRow(content, id);
        var gap = row ? gapAfter(row) : null;
        if (!row) {
            row = copyTreeRow(id);
            if (!row) return;
        } else if (row === content.firstElementChild) {
            return;
        }
        if (!gap) {
            gap = document.createElement('div');
            gap.className = 'pxbetweennotes';
        }

        content.insertBefore(row, content.firstChild);
        content.insertBefore(gap, row.nextSibling);

        // The note just opened is the selected one, wherever its row was
        rowsOf(content).forEach(function (other) {
            var otherLink = other.querySelector('a.links_arbo_left');
            if (otherLink) otherLink.classList.toggle('selected-note', other === row);
        });

        var max = parseInt(section.getAttribute('data-recent-max'), 10) || 20;
        rowsOf(content).slice(max).forEach(function (extra) {
            var extraGap = gapAfter(extra);
            if (extraGap) extraGap.remove();
            extra.remove();
        });
        applyLimit(section);

        section.hidden = false;
    }

    // ------------------------------------------------------------------
    // Count slider of the menu (#recentNotesCountSlider)
    // ------------------------------------------------------------------

    var SLIDER = '#recentNotesCountSlider';
    var saveTimer = null;

    function bounds(row) {
        return {
            min: parseInt(row.getAttribute('data-min'), 10) || 1,
            max: parseInt(row.getAttribute('data-max'), 10) || 20,
            def: parseInt(row.getAttribute('data-default'), 10) || 5
        };
    }

    function clampCount(row, value) {
        var b = bounds(row);
        var n = parseInt(value, 10);
        if (isNaN(n)) return b.def;
        return Math.max(b.min, Math.min(b.max, n));
    }

    function showCount(row, value) {
        var output = row.querySelector('.folder-actions-menu-slider-value');
        if (output) output.textContent = String(value);
        var reset = row.querySelector('.folder-actions-menu-slider-reset');
        if (reset) reset.hidden = value === bounds(row).def;
        var section = document.querySelector(SECTION);
        if (section) {
            section.setAttribute('data-recent-limit', String(value));
            applyLimit(section);
        }
    }

    function saveCount(value) {
        clearTimeout(saveTimer);
        // A few arrow-key presses in a row make one request
        saveTimer = setTimeout(function () {
            fetch('/api/v1/settings/recent_notes_count', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ value: String(value) })
            })
                .then(function (response) { return response.json(); })
                .then(function (result) {
                    if (!result || !result.success) throw new Error('save rejected');
                })
                .catch(function (e) {
                    console.error('recent-notes: the number of recent notes could not be saved', e);
                });
        }, 250);
    }

    document.addEventListener('input', function (event) {
        var input = event.target;
        if (!input || !input.matches || !input.matches(SLIDER + ' input[type="range"]')) return;
        var row = input.closest(SLIDER);
        showCount(row, clampCount(row, input.value));
    });

    document.addEventListener('change', function (event) {
        var input = event.target;
        if (!input || !input.matches || !input.matches(SLIDER + ' input[type="range"]')) return;
        var row = input.closest(SLIDER);
        var value = clampCount(row, input.value);
        showCount(row, value);
        saveCount(value);
    });

    // ------------------------------------------------------------------
    // Pinned top of the tree
    // ------------------------------------------------------------------

    // Pinned only while a note opened from Favorites or Recent notes is shown
    // in the tree: the tree below the rule moves to its row, the top stays.
    // Any scrolling of the reader's own (wheel, finger) unpins it, and the
    // whole column scrolls as it always did. The rows do not move when it
    // unpins (sticky takes no room of its own): the block only goes back to
    // its place in the column.
    var PINNED = '#left_col .tree-pinned-top';
    var PIN_MAX_SHARE = 0.5;

    function scrollerOf(block) {
        return block ? block.closest('.notes-list-scrollable-content') : null;
    }

    // Not when the block would take more than half of the column (a short
    // window, a long Favorites section): the tree would be left a sliver,
    // so the reveal scrolls the whole column instead.
    function pinTop() {
        var block = document.querySelector(PINNED);
        var scroller = scrollerOf(block);
        if (!block || !scroller) return;
        var height = block.offsetHeight;
        if (height <= 0 || height > scroller.clientHeight * PIN_MAX_SHARE) return;
        // Pinned exactly where it stands: sticky at 0 made it jump up by the
        // column's top padding as the tree started to scroll. Any gap left
        // above it is painted over (--pz-pinned-gap, css), so no row shows
        // through it while the tree scrolls.
        var offset = Math.round(block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop);
        block.style.top = offset + 'px';
        block.style.setProperty('--pz-pinned-gap', Math.max(0, offset) + 'px');
        block.classList.add('is-pinned');
        // Rows brought into view by the keyboard stop under it
        scroller.style.scrollPaddingTop = (height + Math.max(0, offset)) + 'px';
    }

    function unpinTop() {
        var block = document.querySelector(PINNED + '.is-pinned');
        if (!block) return;
        block.classList.remove('is-pinned');
        block.style.top = '';
        block.style.removeProperty('--pz-pinned-gap');
        var scroller = scrollerOf(block);
        if (scroller) scroller.style.scrollPaddingTop = '';
    }

    ['wheel', 'touchmove'].forEach(function (type) {
        document.addEventListener(type, function (event) {
            var target = event.target;
            if (target && typeof target.closest === 'function' && target.closest('#left_col .notes-list-scrollable-content')) {
                unpinTop();
            }
        }, { capture: true, passive: true });
    });

    // A note opened from Favorites or Recent notes is also shown in the tree
    // below: its folders open and the tree under the rule scrolls to its row
    // when the row is out of view, and stays put when it is already on screen
    // (requestTreeReveal() of js/utils-folder-tree.js, the path of a link
    // followed from a note, which waits for the note to be on screen and
    // counts the pinned block as out of view)
    function revealInTree(event) {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        var link = event.target.closest('.recent-notes-section a.links_arbo_left[data-note-id], .favorites-section a.links_arbo_left[data-note-id]');
        if (!link || event.target.closest('.note-actions-toggle, .note-icon')) return;
        if (typeof window.poznoteRequestTreeReveal === 'function') {
            pinTop();
            window.poznoteRequestTreeReveal('note', link.getAttribute('data-note-id'));
        }
    }

    document.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        revealInTree(event);

        var toggle = target.closest('[data-action="toggle-recent-menu"]');
        if (toggle) {
            // The toggle sits in the section header, which folds on click
            event.preventDefault();
            event.stopPropagation();
            openFromToggle(toggle);
            return;
        }

        var reset = target.closest(SLIDER + ' .folder-actions-menu-slider-reset');
        if (reset) {
            event.preventDefault();
            var sliderRow = reset.closest(SLIDER);
            var sliderInput = sliderRow.querySelector('input[type="range"]');
            var value = bounds(sliderRow).def;
            if (sliderInput) {
                sliderInput.value = String(value);
                sliderInput.focus();
            }
            showCount(sliderRow, value);
            saveCount(value);
            return;
        }

        var item = target.closest('#recent-actions-menu [data-recent-action]');
        if (item) {
            close();
            if (item.getAttribute('data-recent-action') === 'visibility') revealVisibility();
            return;
        }

        if (!target.closest('#recent-actions-menu')) {
            var openToggle = getToggle();
            if (openToggle) openToggle.classList.remove('open');
        }
    }, true);

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && isOpen()) close();
    });

    window.openRecentNotesMenuAtPoint = openAtPoint;
    window.closeRecentNotesMenu = close;
    window.poznoteTouchRecentNote = touch;
})();
