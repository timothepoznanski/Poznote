// Folder tree state for Poznote.
// 
// Renaming a folder inline, opening and closing folders, expanding or collapsing them
// all, revealing a folder in the tree, persisting and restoring that state across page
// loads, and emptying a folder.

function editFolderName(folderId, oldName) {
    // Prevent renaming system folders
    if (oldName === 'Favorites' || oldName === 'Tags' || oldName === 'Trash') {
        showNotificationPopup(
            (window.t ? window.t('folders.errors.cannot_rename_system_folders', null, 'Cannot rename system folders') : 'Cannot rename system folders'),
            'error'
        );
        return;
    }

    // Inline in the tree when the folder has a row there; list_folders.php has
    // no tree and keeps the modal below.
    if (window.PoznoteInlineTreeEdit && window.PoznoteInlineTreeEdit.renameFolder(folderId, oldName)) {
        return;
    }

    document.getElementById('editFolderModal').style.display = 'flex';
    document.getElementById('editFolderName').value = oldName;
    document.getElementById('editFolderName').dataset.oldName = oldName;
    document.getElementById('editFolderName').dataset.folderId = folderId;
    document.getElementById('editFolderName').focus();
}

function saveFolderName() {
    var newName = document.getElementById('editFolderName').value.trim();
    var oldName = document.getElementById('editFolderName').dataset.oldName;
    var folderId = document.getElementById('editFolderName').dataset.folderId;

    if (!newName) {
        showNotificationPopup(
            (window.t ? window.t('folders.validation.enter_folder_name', null, 'Please enter a folder name') : 'Please enter a folder name'),
            'error'
        );
        return;
    }

    if (newName === oldName) {
        closeModal('editFolderModal');
        return;
    }

    var ws = getSelectedWorkspace();
    var requestData = {
        name: newName
    };
    if (ws) requestData.workspace = ws;

    fetch('/api/v1/folders/' + folderId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(requestData)
    })
        .then(function (response) { return response.json(); })
        .then(function (data) {
            if (data.success) {
                closeModal('editFolderModal');
                // Folder renamed successfully - no notification needed
                location.reload();
            } else {
                showNotificationPopup(
                    (window.t ? window.t('folders.errors.generic_prefix', { error: data.error }, 'Error: {{error}}') : ('Error: ' + data.error)),
                    'error'
                );
            }
        })
        .catch(function (error) {
            showNotificationPopup(
                (window.t ? window.t('folders.errors.rename_prefix', { error: String(error) }, 'Error renaming folder: {{error}}') : ('Error renaming folder: ' + error)),
                'error'
            );
        });
}

// Every folder of the tree except the Favorites section: "Expand/Collapse all
// folders" sits on the rule under it (notes_list.php) and acts on the tree
// below only. Favorites still folds on its own when its header is clicked.
function getFolderContentElements() {
    return Array.prototype.slice.call(document.querySelectorAll('#left_col .folder-content[id]')).filter(function (content) {
        var header = content.parentElement;
        return !(header && header.classList.contains('folder-header') && header.getAttribute('data-folder') === 'Favorites');
    });
}

function isFolderContentOpen(content) {
    if (!content) return false;
    var display = content.style.display || window.getComputedStyle(content).display;
    return display !== 'none';
}

function setFolderOpenState(folderId, isOpen) {
    var content = document.getElementById(folderId);
    if (!content) return;

    // Find the corresponding folder header/icon by folder DOM id (e.g. "folder-123")
    var folderNameEl = document.querySelector('.folder-name[data-folder-dom-id="' + folderId + '"]');
    var folderToggle = folderNameEl ? folderNameEl.closest('.folder-toggle') : null;
    var icon = folderToggle ? folderToggle.querySelector('.folder-icon') : null;
    // Determine folder name to avoid changing icon for the Favorites pseudo-folder
    var folderHeader = folderNameEl ? folderNameEl.closest('.folder-header') : null;
    var folderKey = folderHeader ? folderHeader.getAttribute('data-folder') : '';
    var isFavoritesFolder = folderKey === 'Favorites';

    // Check if icon is custom (don't toggle if custom)
    var isCustomIcon = icon && icon.getAttribute('data-custom-icon') === 'true';

    if (isOpen) {
        content.style.display = 'block';
        // show open folder icon (only if not custom and not favorites)
        if (icon && !isFavoritesFolder && !isCustomIcon) {
            icon.classList.remove('lucide-folder');
            icon.classList.add('lucide-folder-open');
        }
        rememberFolderOpenState(folderId, true);
    } else {
        content.style.display = 'none';
        // show closed folder icon (only if not custom and not favorites)
        if (icon && !isFavoritesFolder && !isCustomIcon) {
            icon.classList.remove('lucide-folder-open');
            icon.classList.add('lucide-folder');
        }
        rememberFolderOpenState(folderId, false);
    }
}

function getShouldExpandAllFolders() {
    var folderContents = getFolderContentElements();
    if (folderContents.length === 0) return false;

    return folderContents.some(function (content) {
        return !isFolderContentOpen(content);
    });
}

function updateToggleAllFoldersButton() {
    // Several controls share this action: the button left of the tree's view
    // options toggle (or the one of the active account's row), the buttons of
    // the icon rail, so every match has to be kept in sync, not just the first.
    var buttons = document.querySelectorAll('[data-action="toggle-all-folders"]');
    if (!buttons.length) return;

    var folderContents = getFolderContentElements();
    var hasFolders = folderContents.length > 0;
    var shouldExpand = !hasFolders || getShouldExpandAllFolders();
    var title = shouldExpand
        ? (window.t ? window.t('sidebar.expand_all_folders', null, 'Expand all folders') : 'Expand all folders')
        : (window.t ? window.t('sidebar.collapse_all_folders', null, 'Collapse all folders') : 'Collapse all folders');

    buttons.forEach(function (button) {
        var icon = button.querySelector('.lucide');

        button.setAttribute('aria-expanded', shouldExpand ? 'false' : 'true');
        button.disabled = !hasFolders;
        button.title = title;
        button.setAttribute('aria-label', title);

        // A single chevron: down while the click unfolds the tree, up while
        // it folds it.
        if (icon) {
            icon.classList.toggle('lucide-chevron-down', shouldExpand);
            icon.classList.toggle('lucide-chevron-up', !shouldExpand);
        }
    });
}

function toggleAllFolders() {
    var folderContents = getFolderContentElements();
    if (folderContents.length === 0) return;

    var shouldOpen = getShouldExpandAllFolders();
    folderContents.forEach(function (content) {
        setFolderOpenState(content.id, shouldOpen);
    });
    updateToggleAllFoldersButton();
}

// Folder management function (open/closed folder icon)
function toggleFolder(folderId) {
    var content = document.getElementById(folderId);
    if (!content) return;

    setFolderOpenState(folderId, !isFolderContentOpen(content));
    updateToggleAllFoldersButton();
}

/**
 * Reveal a folder in the left folder list: expand it and all of its
 * ancestor folders, then scroll to its header and highlight it briefly.
 * Used by the folder breadcrumb segments in the note header.
 * @param {string|number} folderId - The folder database ID
 */
function revealFolderInTree(folderId) {
    var content = document.getElementById('folder-' + folderId);
    var header = document.querySelector(".folder-header[data-folder-key='folder_" + folderId + "']");
    // Folder may be absent from the list (search mode, folder filter)
    if (!content || !header) return;

    // Expand the folder itself and every ancestor folder
    var node = content;
    while (node) {
        if (node.classList.contains('folder-content')) {
            var isHidden = node.style.display === 'none' || window.getComputedStyle(node).display === 'none';
            if (isHidden) toggleFolder(node.id);
        }
        node = node.parentElement ? node.parentElement.closest('.folder-content') : null;
    }

    var isMobile = window.innerWidth <= 800;

    if (isMobile) {
        // Close the keyboard if the editor was focused: we are leaving the note.
        var active = document.activeElement;
        if (active && typeof active.blur === 'function' && active.closest && active.closest('#right_col')) {
            active.blur();
        }
        // On mobile the note view hides the list: switch back to the left column first.
        if (typeof window.scrollToLeftColumn === 'function') {
            window.scrollToLeftColumn();
        }
        // scrollIntoView() would walk up to <body>, which is the horizontal
        // scroller on mobile (css/index-mobile.css), and fight the sideways
        // animation back to the list, landing on the note again. Scroll the
        // list's own vertical scroller instead, once that animation is done.
        setTimeout(function () {
            scrollFolderHeaderIntoLeftColumn(header);
        }, 320);
    } else {
        header.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    header.classList.add('folder-reveal-highlight');
    setTimeout(function () {
        header.classList.remove('folder-reveal-highlight');
    }, 1600);
}

/**
 * Scroll a folder header into view inside the left column only, without
 * touching the horizontal (body) scroll used by the mobile two-pane layout.
 * @param {HTMLElement} header - The .folder-header element to center
 */
function scrollFolderHeaderIntoLeftColumn(header) {
    var leftCol = document.getElementById('left_col');
    if (!leftCol || !header) return;

    var headerRect = header.getBoundingClientRect();
    var colRect = leftCol.getBoundingClientRect();
    var offset = (headerRect.top - colRect.top) - (leftCol.clientHeight - headerRect.height) / 2;
    var target = Math.max(0, Math.min(leftCol.scrollTop + offset, leftCol.scrollHeight - leftCol.clientHeight));

    if (typeof leftCol.scrollTo === 'function') {
        leftCol.scrollTo({ top: target, behavior: 'smooth' });
    } else {
        leftCol.scrollTop = target;
    }
}

/**
 * Remember a folder and its ancestors as open, so what a move just dropped in
 * there is on screen once the tree is drawn again (issue #1441). Nothing
 * opens right away: the next render shows it (the server, or
 * restoreFolderStates() until the server took it in), so this has to run
 * after persistFolderStatesFromDOM(), whose closed state would otherwise
 * win.
 * @param {string|number|null} folderId - Destination folder ID (null/'' for the root)
 */
function markFolderPathOpen(folderId) {
    if (folderId === null || folderId === undefined || folderId === '') return;

    var domId = 'folder-' + String(folderId);
    var content = document.getElementById(domId);

    try {
        rememberFolderOpenState(domId, true);
        // A destination nested in a closed folder would stay out of sight
        while (content && content.parentElement) {
            content = content.parentElement.closest('.folder-content');
            if (content && content.id) rememberFolderOpenState(content.id, true);
        }
    } catch (e) {
        console.debug('utils-folder-tree: markFolderPathOpen() failed:', e);
    }
}

/**
 * Keep what an action just moved selected in the tree (issue #1441), the way
 * a file manager does: the tint is the confirmation that the items landed
 * somewhere. Pages without the tree (settings, trash, list_folders) have no
 * selection module and ignore the call.
 * @param {Array<{type: string, id: string|number}>} items - Moved notes and folders
 * @param {boolean} reloads - True when the caller is about to reload the page
 */
function keepTreeSelection(items, reloads) {
    var selection = window.PoznoteTreeSelection;
    if (!selection) return;

    if (reloads) {
        selection.selectAfterReload(items);
    } else {
        selection.select(items);
    }
}

/**
 * Draw the tree again in place and show the row an action just added
 * (issue #1536). A page reload sent a long tree back to its top: here it
 * stays where it was scrolled, the new row is selected like a moved one
 * (keepTreeSelection) and only brought into view when it landed outside of it.
 * @param {{type: string, id: string|number}} item - The note or folder that was added
 * @param {string|number|null} folderId - Folder it landed in, opened with its ancestors
 */
function showAddedTreeRow(item, folderId) {
    var leftCol = document.getElementById('left_col');

    // Pages without the tree (list_folders) have nothing to redraw in place
    if (!leftCol || typeof window.refreshNotesListAfterFolderAction !== 'function') {
        persistFolderStatesFromDOM();
        markFolderPathOpen(folderId);
        keepTreeSelection([item], true);
        window.location.reload();
        return;
    }

    // refreshNotesListAfterFolderAction() puts the list back where it was scrolled
    Promise.resolve(window.refreshNotesListAfterFolderAction(folderId)).then(function () {
        keepTreeSelection([item], false);

        var row = findTreeRow(item);
        // Absent or folded away (search mode, folder filter): nothing to scroll to
        if (!row || row.offsetParent === null) return;

        // Not scrollIntoView(): it would walk up to <body>, the sideways
        // scroller of the mobile two-pane layout (css/index-mobile.css)
        var scroller = row.closest('.notes-list-scrollable-content') || leftCol;
        var rowRect = row.getBoundingClientRect();
        var viewRect = scroller.getBoundingClientRect();
        if (rowRect.top >= viewRect.top && rowRect.bottom <= viewRect.bottom) return;

        var offset = (rowRect.top - viewRect.top) - (scroller.clientHeight - rowRect.height) / 2;
        scroller.scrollTop = Math.max(0, Math.min(scroller.scrollTop + offset, scroller.scrollHeight - scroller.clientHeight));
    });
}

// The row of a note or folder in the tree proper, not its twin in Favorites
function findTreeRow(item) {
    if (item.type === 'folder') {
        // The header wraps the whole folder: its first line is the row
        return document.querySelector("#left_col .folder-header[data-folder-key='folder_" + item.id + "'] > .folder-toggle");
    }

    var links = document.querySelectorAll('#left_col .links_arbo_left[data-note-db-id="' + item.id + '"]');
    for (var i = 0; i < links.length; i++) {
        if (!links[i].closest('.folder-header.system-folder')) return links[i];
    }
    return links.length ? links[0] : null;
}

// ========== Open/closed state of the folders ==========
//
// The account's own tree keeps each folder's state in its database
// (folders.tree_open), so notes_list.php renders the tree the way its reader
// left it, on every device, after a reload or a workspace switch. Someone
// looking at another account (a shared workspace, a granted account) keeps
// them in this browser under folder_<dom id>, as every tree did before:
// their clicks must not fold the owner's tree. notes_list.php says which on
// .notes-list-scrollable-content (data-folder-states).
//
// A change goes to the server at once and stays in a per-tab list
// (sessionStorage) until the server has it, applied over every render
// meanwhile: a tree redrawn before the write landed (a refresh fired right
// after, a page reload) still shows it, and a failed write is sent again. A
// page without the tree (create.php...) leaves its changes in that list for
// the page it goes to. Favorites is not a folder of the database: its fold
// stays in the browser in both modes.

var FOLDER_STATES_PENDING_KEY = 'poznote_folder_states_pending';
var FOLDER_STATES_HOLD_KEY = 'poznote_folder_states_hold';
// A change the server never acknowledged is dropped after a day rather than
// applied over what other devices did since.
var FOLDER_STATES_PENDING_TTL = 24 * 3600 * 1000;
// What persistFolderStatesFromDOM() holds is for the redraw that follows.
var FOLDER_STATES_HOLD_TTL = 30 * 1000;
var folderStatesFlushTimer = null;

// 'account', 'browser', or '' on a page without the tree
function folderStatesMode() {
    var list = document.querySelector('#left_col .notes-list-scrollable-content[data-folder-states]');
    return list ? list.getAttribute('data-folder-states') : '';
}

// Database folders only: "folder-12", not the Favorites section
function folderDbIdFromDomId(domId) {
    var match = /^folder-(\d+)$/.exec(String(domId || ''));
    return match ? match[1] : null;
}

function readFolderStateMap(key, ttl) {
    var raw;
    try {
        raw = JSON.parse(sessionStorage.getItem(key) || '{}');
    } catch (e) {
        return {};
    }
    if (!raw || typeof raw !== 'object') return {};
    var now = Date.now();
    var map = {};
    Object.keys(raw).forEach(function (domId) {
        var entry = raw[domId];
        if (entry && typeof entry.open === 'boolean' && typeof entry.t === 'number' && now - entry.t < ttl) {
            map[domId] = entry;
        }
    });
    return map;
}

function writeFolderStateMap(key, map) {
    try {
        if (Object.keys(map).length) {
            sessionStorage.setItem(key, JSON.stringify(map));
        } else {
            sessionStorage.removeItem(key);
        }
    } catch (e) {
        console.debug('utils-folder-tree: folder states not kept for this tab:', e);
    }
}

/**
 * Remember a folder as opened or closed by hand, where this tree keeps it.
 * The DOM is the caller's business (setFolderOpenState()).
 * @param {string} domId - "folder-12"
 * @param {boolean} open
 */
function rememberFolderOpenState(domId, open) {
    if (!domId) return;
    var mode = folderStatesMode();
    if (mode === 'browser' || !folderDbIdFromDomId(domId)) {
        try { localStorage.setItem('folder_' + domId, open ? 'open' : 'closed'); } catch (e) {
            console.debug('utils-folder-tree: folder state not kept:', e);
        }
        return;
    }
    var pending = readFolderStateMap(FOLDER_STATES_PENDING_KEY, FOLDER_STATES_PENDING_TTL);
    pending[domId] = { open: !!open, t: Date.now() };
    writeFolderStateMap(FOLDER_STATES_PENDING_KEY, pending);
    if (mode === 'account') scheduleFolderStatesFlush();
}
window.rememberFolderOpenState = rememberFolderOpenState;

function scheduleFolderStatesFlush() {
    if (folderStatesFlushTimer) return;
    // One request for a burst ("Expand all folders", a path opened at once)
    folderStatesFlushTimer = setTimeout(flushFolderStates, 0);
}

// The browser's own folder_* keys, taken over by the server (they predate
// folders.tree_open), folder by folder as each one is on screen: the keys of
// another workspace wait for that workspace. Only for folders the server has
// no state for, a second device must not undo what the first one handed
// over; a key for a folder that already has one is just dropped. The live
// keys are those of the account on screen (js/other-accounts.js swaps them).
function collectLegacyFolderStates() {
    try {
        var states = {};
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (!key || key.indexOf('folder_') !== 0) continue;
            var domId = key.slice('folder_'.length);
            var content = folderDbIdFromDomId(domId) ? document.getElementById(domId) : null;
            if (!content || !content.classList.contains('folder-content')) continue;
            keys.push(key);
            var value = localStorage.getItem(key);
            if ((value === 'open' || value === 'closed') && !content.hasAttribute('data-tree-open')) {
                states[domId] = value === 'open';
            }
        }
        return keys.length ? { states: states, keys: keys } : null;
    } catch (e) {
        return null;
    }
}

function finishLegacyFolderStates(legacy) {
    try {
        legacy.keys.forEach(function (key) { localStorage.removeItem(key); });
    } catch (e) {
        console.debug('utils-folder-tree: legacy folder states not cleared:', e);
    }
}

function flushFolderStates() {
    folderStatesFlushTimer = null;
    if (folderStatesMode() !== 'account') return Promise.resolve();

    var pending = readFolderStateMap(FOLDER_STATES_PENDING_KEY, FOLDER_STATES_PENDING_TTL);
    var legacy = collectLegacyFolderStates();
    var states = {};
    var sent = {};
    if (legacy) {
        Object.keys(legacy.states).forEach(function (domId) {
            states[folderDbIdFromDomId(domId)] = legacy.states[domId];
        });
    }
    // Over the legacy keys: this tab's changes are newer
    Object.keys(pending).forEach(function (domId) {
        var id = folderDbIdFromDomId(domId);
        if (!id) return;
        states[id] = pending[domId].open;
        sent[domId] = pending[domId].t;
    });

    if (!Object.keys(states).length) {
        if (legacy) finishLegacyFolderStates(legacy);
        return Promise.resolve();
    }

    var forget = function () {
        var current = readFolderStateMap(FOLDER_STATES_PENDING_KEY, FOLDER_STATES_PENDING_TTL);
        Object.keys(sent).forEach(function (domId) {
            // A newer click on the same folder waits for its own write
            if (current[domId] && current[domId].t === sent[domId]) delete current[domId];
        });
        writeFolderStateMap(FOLDER_STATES_PENDING_KEY, current);
        if (legacy) finishLegacyFolderStates(legacy);
    };

    return fetch('api/v1/folders/tree-state', {
        method: 'PUT',
        credentials: 'same-origin',
        // A click right before a reload or a navigation still lands
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ states: states })
    }).then(function (response) {
        // Refused for good (not the owner any more, bad data): retrying would
        // never succeed. A server error or no network: kept for the next try.
        if (response.ok || response.status === 400 || response.status === 403) forget();
    }).catch(function (error) {
        console.debug('utils-folder-tree: folder states not saved yet:', error);
    });
}

/**
 * Keep the open/closed states on screen for the tree about to be drawn again
 * (a refresh of the list, a page reload after a drag & drop move), which
 * would otherwise show the states the server picks for folders nobody
 * touched. Not written to the account: a folder only a search or the note
 * being created opened stays a guess.
 */
function persistFolderStatesFromDOM() {
    const folderToggles = document.querySelectorAll('.folder-name[data-folder-dom-id]');
    let pendingCreateOpenFolders = [];

    try {
        pendingCreateOpenFolders = JSON.parse(sessionStorage.getItem('poznote_create_open_folders') || '[]');
        if (!Array.isArray(pendingCreateOpenFolders)) {
            pendingCreateOpenFolders = [];
        }
    } catch (error) {
        pendingCreateOpenFolders = [];
    }

    const mode = folderStatesMode();
    const hold = {};
    const now = Date.now();

    folderToggles.forEach(function (toggleElement) {
        const folderDomId = toggleElement.getAttribute('data-folder-dom-id');
        const folderContent = folderDomId ? document.getElementById(folderDomId) : null;
        if (!folderDomId || !folderContent) return;

        const inlineDisplay = folderContent.style.display;
        const isOpen = pendingCreateOpenFolders.indexOf(folderDomId) !== -1
            || (inlineDisplay ? inlineDisplay !== 'none' : window.getComputedStyle(folderContent).display !== 'none');
        if (mode === 'account' && folderDbIdFromDomId(folderDomId)) {
            hold[folderDomId] = { open: isOpen, t: now };
        } else {
            localStorage.setItem('folder_' + folderDomId, isOpen ? 'open' : 'closed');
        }
    });

    if (mode === 'account') writeFolderStateMap(FOLDER_STATES_HOLD_KEY, hold);
}

function paintFolderOpenState(folderContent, toggleElement, open) {
    const folderToggle = toggleElement.closest('.folder-toggle');
    const icon = folderToggle ? folderToggle.querySelector('.folder-icon') : null;
    const folderHeader = toggleElement.closest('.folder-header');
    const isFavoritesFolder = (folderHeader ? folderHeader.getAttribute('data-folder') : '') === 'Favorites';
    const isCustomIcon = icon && icon.getAttribute('data-custom-icon') === 'true';

    folderContent.style.display = open ? 'block' : 'none';
    if (icon && !isFavoritesFolder && !isCustomIcon) {
        icon.classList.toggle('lucide-folder-open', open);
        icon.classList.toggle('lucide-folder', !open);
    }
}

/**
 * Apply over the tree the server just rendered what it cannot know yet:
 * - account mode: the states held by persistFolderStatesFromDOM() for this
 *   redraw, then the changes not yet acknowledged by the server, plus, once,
 *   the browser's own keys of the time before the database kept them;
 * - browser mode: the folder_* keys, as before (only explicit choices, the
 *   server's state stays for the folders never touched).
 * Runs after every render of the tree: page load, and every swap of #left_col
 * (reinitializeLeftColumn() of js/share.js).
 */
function restoreFolderStates() {
    const mode = folderStatesMode();
    const folderToggles = document.querySelectorAll('.folder-name[data-folder-dom-id]');

    let overlay = {};
    let legacy = null;
    if (mode === 'account') {
        legacy = collectLegacyFolderStates();
        if (legacy) overlay = Object.assign(overlay, legacy.states);
        const hold = readFolderStateMap(FOLDER_STATES_HOLD_KEY, FOLDER_STATES_HOLD_TTL);
        writeFolderStateMap(FOLDER_STATES_HOLD_KEY, {});
        Object.keys(hold).forEach(function (domId) { overlay[domId] = hold[domId].open; });
    }
    const pending = readFolderStateMap(FOLDER_STATES_PENDING_KEY, FOLDER_STATES_PENDING_TTL);
    if (mode === 'browser') {
        // Left by a page without the tree, which could not tell the mode
        Object.keys(pending).forEach(function (domId) {
            try { localStorage.setItem('folder_' + domId, pending[domId].open ? 'open' : 'closed'); } catch (e) {
                console.debug('utils-folder-tree: folder state not kept:', e);
            }
        });
        writeFolderStateMap(FOLDER_STATES_PENDING_KEY, {});
    } else if (mode === 'account') {
        Object.keys(pending).forEach(function (domId) { overlay[domId] = pending[domId].open; });
    }

    folderToggles.forEach(function (toggleElement) {
        const folderDomId = toggleElement.getAttribute('data-folder-dom-id');
        const folderContent = folderDomId ? document.getElementById(folderDomId) : null;
        if (!folderContent || !folderDomId) return;

        let open = null;
        if (mode === 'account' && folderDbIdFromDomId(folderDomId)) {
            if (Object.prototype.hasOwnProperty.call(overlay, folderDomId)) open = overlay[folderDomId];
        } else {
            // Browser mode, and the Favorites section in both modes
            const savedState = localStorage.getItem('folder_' + folderDomId);
            if (savedState === 'open' || savedState === 'closed') open = savedState === 'open';
        }
        if (open !== null) paintFolderOpenState(folderContent, toggleElement, open);
    });

    // Favorites are always visible; the old separator toggle is no longer rendered.
    var favoritesHeader = document.querySelector('[data-folder="Favorites"]');
    if (favoritesHeader) {
        favoritesHeader.classList.remove('favorites-collapsed');
        localStorage.removeItem('favorites_collapsed');
    }

    updateToggleAllFoldersButton();

    // A redrawn tree has lost the mark of the folder whose board is open
    if (window._isKanbanViewActive && window._kanbanFolderId) {
        markOpenKanbanFolder(window._kanbanFolderId);
    }

    if (mode === 'account' && (legacy || Object.keys(pending).length)) scheduleFolderStatesFlush();
}

// ============================================
// Showing the target of a link in the tree
// ============================================
//
// A link to a note or to a folder, followed from a note, leaves the tree
// where it was: nothing opened the target's folders, and the row of the note
// that was open before kept its selected look (the loaders only mark a row
// that was clicked). Once the target is on screen, its folders are opened,
// its row is marked as a click in the tree would mark it and scrolled into
// view. The request survives a page load (a link to another workspace
// reloads the page), through sessionStorage.

var TREE_REVEAL_KEY = 'poznote_tree_reveal';
var TREE_REVEAL_WAIT_MS = 8000;
var TREE_REVEAL_INTERVAL_MS = 100;
var treeRevealTimer = 0;

function isFavoritesTreeElement(element) {
    return !!(element && element.closest && element.closest('.folder-header[data-folder="Favorites"]'));
}

function findTreeFolderHeader(folderId) {
    var headers = document.querySelectorAll('#left_col .folder-header[data-folder-id="' + CSS.escape(String(folderId)) + '"]');
    for (var i = 0; i < headers.length; i++) {
        if (!isFavoritesTreeElement(headers[i])) return headers[i];
    }
    return null;
}

/**
 * The folder whose Kanban board is the open pane carries the open note's
 * look in the tree (css/folders/headers-toggles.css). Called with null to
 * clear it: a note was opened, or the board was closed.
 */
function markOpenKanbanFolder(folderId) {
    document.querySelectorAll('.folder-header.kanban-open-folder').forEach(function (header) {
        header.classList.remove('kanban-open-folder');
    });
    if (folderId === null || folderId === undefined || folderId === '') return;
    var header = findTreeFolderHeader(folderId);
    if (header) header.classList.add('kanban-open-folder');
}

// Open every folder from the root down to `element` (the element itself too
// when it is a folder's content). `display` only paints them open and keeps
// nothing: the tree shown on load must not rewrite the folder states the
// account keeps (and every other device shows).
function openTreePathTo(element, display) {
    var node = element && element.classList && element.classList.contains('folder-content')
        ? element
        : (element && element.parentElement ? element.parentElement.closest('.folder-content') : null);
    var changed = false;
    while (node) {
        if (node.id && !isFavoritesTreeElement(node) && !isFolderContentOpen(node)) {
            var toggle = display ? document.querySelector('.folder-name[data-folder-dom-id="' + CSS.escape(node.id) + '"]') : null;
            if (toggle) paintFolderOpenState(node, toggle, true);
            else setFolderOpenState(node.id, true);
            changed = true;
        }
        node = node.parentElement ? node.parentElement.closest('.folder-content') : null;
    }
    if (changed) updateToggleAllFoldersButton();
}

// Centred in the tree's own vertical scroller when it is not fully in view,
// left where it is otherwise (a tree that jumps for a row already on screen
// loses the reader). The scroller is looked up rather than named, and only
// it moves: never the sideways scroller <body> is on mobile, where the list
// sits off screen next to the note or the board.
function scrollTreeRowIntoView(row, instant) {
    var scroller = row.parentElement;
    while (scroller && scroller !== document.body) {
        var overflowY = window.getComputedStyle(scroller).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
        scroller = scroller.parentElement;
    }
    if (!scroller || scroller === document.body) return;

    var rowRect = row.getBoundingClientRect();
    var boxRect = scroller.getBoundingClientRect();
    if (rowRect.top >= boxRect.top && rowRect.bottom <= boxRect.bottom) return;

    var offset = (rowRect.top - boxRect.top) - (scroller.clientHeight - rowRect.height) / 2;
    var target = Math.max(0, Math.min(scroller.scrollTop + offset, scroller.scrollHeight - scroller.clientHeight));
    if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top: target, behavior: instant ? 'instant' : 'smooth' });
    } else {
        scroller.scrollTop = target;
    }
}

function treeRevealTargetShown(type, id) {
    if (type === 'folder') {
        return !!document.querySelector('#kanban-view-container[data-folder-id="' + CSS.escape(id) + '"]');
    }
    if (window._isKanbanViewActive) return false;
    var entry = document.getElementById('entry' + id);
    var card = entry ? entry.closest('.notecard') : null;
    return !!(entry && entry.isConnected && (!card || card.style.display !== 'none'));
}

function revealTreeTarget(type, id, quiet) {
    if (type === 'folder') {
        var header = findTreeFolderHeader(id);
        // Not in the tree as drawn (a search, a folder filter)
        if (!header) return;
        openTreePathTo(document.getElementById('folder-' + id) || header, quiet);
        markOpenKanbanFolder(id);
        scrollTreeRowIntoView(header.querySelector('.folder-toggle') || header, quiet);
        return;
    }

    var rows = document.querySelectorAll('#left_col .links_arbo_left[data-note-id="' + CSS.escape(id) + '"]');
    var row = null;
    for (var i = 0; i < rows.length; i++) {
        if (!isFavoritesTreeElement(rows[i])) { row = rows[i]; break; }
    }
    if (!row) row = rows[0] || null;
    if (!row) return;
    openTreePathTo(row, quiet);
    if (typeof updateSelectedNote === 'function') updateSelectedNote(row);
    scrollTreeRowIntoView(row, quiet);
}

function cancelTreeReveal() {
    clearInterval(treeRevealTimer);
    treeRevealTimer = 0;
    try { sessionStorage.removeItem(TREE_REVEAL_KEY); } catch (e) { /* nothing to cancel then */ }
}

/**
 * Show a link's target in the tree once it is on screen.
 * @param {'note'|'folder'} type
 * @param {string|number} id - Note or folder id
 * @param {{quiet?: boolean}} [options] - quiet: the target is shown, not
 *   asked for (the note a phone lands on, behind the list). Its folders are
 *   only painted open, the tree jumps instead of gliding, and the request
 *   does not outlive the page.
 */
function requestTreeReveal(type, id, options) {
    id = String(id);
    if ((type !== 'note' && type !== 'folder') || !/^\d+$/.test(id)) return;
    var quiet = !!(options && options.quiet);
    // A link followed just before (resumed after a reload) wins over the
    // note merely shown on load
    if (quiet && treeRevealTimer) return;

    clearInterval(treeRevealTimer);
    var since = (options && options.startedAt) || Date.now();
    if (!quiet) {
        try {
            sessionStorage.setItem(TREE_REVEAL_KEY, JSON.stringify({ type: type, id: id, at: since }));
        } catch (e) {
            console.debug('utils-folder-tree: tree reveal not kept:', e);
        }
    }

    var check = function () {
        if (treeRevealTargetShown(type, id)) {
            cancelTreeReveal();
            // After the loader's own last touches to the tree
            setTimeout(function () { revealTreeTarget(type, id, quiet); }, 80);
            return;
        }
        if (Date.now() - since > TREE_REVEAL_WAIT_MS) cancelTreeReveal();
    };
    treeRevealTimer = setInterval(check, TREE_REVEAL_INTERVAL_MS);
    check();
}

// A request made just before a page load (link to another workspace)
function resumeTreeReveal() {
    var raw = null;
    try { raw = sessionStorage.getItem(TREE_REVEAL_KEY); } catch (e) { return; }
    if (!raw) return;
    var request = null;
    try { request = JSON.parse(raw); } catch (e) { request = null; }
    if (!request || !document.getElementById('left_col') || Date.now() - (request.at || 0) > TREE_REVEAL_WAIT_MS * 2) {
        cancelTreeReveal();
        return;
    }
    // The wait starts again: the page load took part of it
    requestTreeReveal(request.type, request.id);
}

window.poznoteRequestTreeReveal = requestTreeReveal;
window.poznoteCancelTreeReveal = cancelTreeReveal;
window.markOpenKanbanFolder = markOpenKanbanFolder;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resumeTreeReveal);
} else {
    resumeTreeReveal();
}

function emptyFolder(folderId, folderName) {
    showConfirmModal(
        (window.t ? window.t('folders.empty.title', null, 'Empty Folder') : 'Empty Folder'),
        (window.t
            ? window.t('folders.empty.confirm_message', { folder: folderName }, 'Are you sure you want to move all notes from "{{folder}}" to trash?')
            : ('Are you sure you want to move all notes from "' + folderName + '" to trash?')),
        function () {
            executeEmptyFolder(folderId, folderName);
        },
        {
            danger: true,
            confirmText: (window.t ? window.t('folders.empty.confirm_button', null, 'Send notes to trash') : 'Send notes to trash'),
            hideSaveAndExit: true
        }
    );
}

function executeEmptyFolder(folderId, folderName) {
    var ws = getSelectedWorkspace();
    var requestData = {};
    if (ws) requestData.workspace = ws;

    fetch('/api/v1/folders/' + folderId + '/empty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(requestData)
    })
        .then(function (response) { return response.json(); })
        .then(function (data) {
            if (data.success) {
                showNotificationPopup(
                    (window.t
                        ? window.t('folders.empty.success_moved_to_trash', { folder: folderName }, 'All notes moved to trash from folder: {{folder}}')
                        : ('All notes moved to trash from folder: ' + folderName))
                );
                location.reload();
            } else {
                showNotificationPopup(
                    (window.t ? window.t('folders.errors.generic_prefix', { error: data.error }, 'Error: {{error}}') : ('Error: ' + data.error)),
                    'error'
                );
            }
        })
        .catch(function (error) {
            showNotificationPopup(
                (window.t ? window.t('folders.errors.empty_folder_prefix', { error: String(error) }, 'Error emptying folder: {{error}}') : ('Error emptying folder: ' + error)),
                'error'
            );
        });
}
