/**
 * Right-click an element to find it in the "Element visibility" list.
 *
 * A right-click anywhere the "Element visibility" list has a box for what sits
 * under the pointer opens a small menu (the one of js/icon-sidebar-colors.js)
 * with a single "Element visibility" entry. Nothing is hidden from here: the
 * entry opens the list on the row of the innermost element found (unfolded,
 * scrolled to and marked for a moment), where its box hides it, and where it
 * is ticked back on later.
 *
 * What a click can land on:
 *   - card:<id>   read off the element's own id, which is what that key hides,
 *                 so every card, button and section of the list is covered
 *                 without naming one here;
 *   - panel:*, tasklist:*, share:*   the selectors of the rule builder itself
 *                 (hideTargets() in js/ui-customization.js);
 *   - slash:*, folder:*, note:*, wsmenu:*   menu entries, whose key is their
 *                 data-action (ATTRIBUTE_TARGETS below).
 *
 * An element is offered only when the page's list holds its row. A row the
 * administrator locked, or already unticked, is left out too.
 *
 * A task row also answers on its text, which matches no key: the menu then
 * holds only the "Element visibility" entry, opened on the "Task lists"
 * section. A link or a selection in that text keeps the browser's menu.
 *
 * Left alone: text being edited (the browser's own menu belongs to it), and
 * the regions that answer a right-click with a menu of their own.
 */
(function () {
    'use strict';

    // How far up the tree the menu looks for an element the list holds.
    var MAX_DEPTH = 14;

    // Regions that answer a right-click themselves, each already carrying its
    // own "Element visibility" entry: the icon rail and the note toolbar
    // (js/icon-sidebar-colors.js, js/toolbar-icon-colors.js), the line under
    // the note title (js/note-subline-menu.js), the visibility lists and the
    // menus of this file. Named here rather than left to event.defaultPrevented,
    // which only helps when this listener runs after theirs.
    var OWNED_REGIONS = [
        '#icon_sidebar',
        '.note-edit-toolbar',
        '.note-subline',
        '#uiCustomizationPanel',
        '#uiCustomizationSettings',
        '#iconContextMenu'
    ].join(', ');

    // Words the user wrote, inside an element the list could otherwise offer to
    // hide: the text of a task sits in a plain span, not in a field, so without
    // this a right-click on it would answer "Hide the frame around each task"
    // instead of the browser's own copy and spelling menu.
    var CONTENT_REGIONS = '.task-text, .task-subitem-text, .tasklist-embed-text';

    // A task row, in a task list note or in a list embedded in a note. Its
    // text matches no key, so a right-click on it offers only the way to the
    // "Task lists" section of the panel, where every part of a row has a box.
    var TASK_ROWS = '.task-list-container .task-item, .tasklist-embed-task';
    var TASK_LISTS_SECTION = 'task-lists';

    // Keys read off the clicked element instead of a fixed selector: menu
    // entries whose data attribute is the second half of their key. Mirrors
    // the rule builders (poznoteBuildUiCustomizationRules() in
    // lib/ui-customization.php, applyHiddenKeys() in js/ui-customization.js).
    var ATTRIBUTE_TARGETS = [
        { selector: '.slash-command-item[data-command-id]', attribute: 'data-command-id', prefix: 'slash:' },
        { selector: '.folder-actions-menu-item[data-action]', attribute: 'data-action', prefix: 'folder:' },
        { selector: '.note-actions-menu-item[data-action]', attribute: 'data-action', prefix: 'note:' },
        { selector: '.workspace-menu-item[data-action]', attribute: 'data-action', prefix: 'wsmenu:' }
    ];

    var cachedTargets = null;

    // Labels come from the config icon_sidebar.php renders, already
    // translated: window.t is not on every page (the dashboard loads the JS
    // i18n runtime only with the AI panel).
    function label(configKey, fallback) {
        var config = window.PoznoteIconSidebarColorsConfig || {};
        return config[configKey] || fallback;
    }

    function runtime() {
        return window.PoznoteUiCustomization || null;
    }

    function contextMenu() {
        var menu = window.PoznoteIconContextMenu;
        return menu && typeof menu.open === 'function' && typeof menu.revealKey === 'function' ? menu : null;
    }

    // The list edits a setting of the account being looked at, which only its
    // owner may do (the same guard as the icon rail's right-click menu).
    function mayCustomize() {
        var config = window.PoznoteIconSidebarColorsConfig;
        return !config || config.canCustomize !== false;
    }

    // Read once, but only kept once the runtime has answered: an empty list
    // cached before js/ui-customization.js ran would switch the menu off for
    // the life of the page.
    function targets() {
        if (cachedTargets && cachedTargets.length) return cachedTargets;
        var rt = runtime();
        cachedTargets = rt && typeof rt.hideTargets === 'function' ? rt.hideTargets() : [];
        return cachedTargets;
    }

    function matches(element, selector) {
        if (!element || !element.matches) return false;
        try {
            return element.matches(selector);
        } catch (e) {
            console.debug('hide-element-menu: unusable selector', selector, e);
            return false;
        }
    }

    /**
     * True inside text being edited, where the browser's own menu (copy,
     * paste, spelling) must stay. A task list, a diagram or an embedded widget
     * inside a note carries contenteditable="false", so what counts is the
     * nearest answer rather than whether an editable host sits somewhere above.
     */
    function isTextEditingContext(target) {
        if (target.closest('input, textarea, select')) return true;
        var host = target.closest('[contenteditable]');
        return !!host && host.getAttribute('contenteditable') !== 'false';
    }

    /**
     * The row the "Element visibility" list gives a key: the name to put in the
     * entry, and the state of its box. Null when the page's list has no row for
     * it, when the administrator locked it, or when it is unticked already.
     */
    function offerableRow(key) {
        var rt = runtime();
        // Keys renamed after release, and the handful the list refuses to hide,
        // are both settled by the runtime (sanitizeHiddenKeys).
        if (rt && typeof rt.normalizeKeys === 'function') {
            var normalized = rt.normalizeKeys([key]);
            if (normalized.length !== 1 || normalized[0] !== key) return null;
        }

        var box = document.querySelector('[data-ui-key="' + key + '"]');
        if (!box || box.disabled || !box.checked) return null;

        var item = box.closest ? box.closest('.ui-custom-item') : null;
        var span = item ? item.querySelector('span') : null;
        var name = span ? (span.textContent || '').trim() : '';
        return name ? { name: name } : null;
    }

    function keysOf(element) {
        var keys = [];

        if (element.id) keys.push('card:' + element.id);

        // A magnifier goes with the field it unfolds (lib/search-toggle.php)
        if (matches(element, '.pz-search-toggle[aria-controls]')) {
            keys.push('card:' + element.getAttribute('aria-controls'));
        }

        targets().forEach(function (target) {
            if (matches(element, target.selector)) keys.push(target.key);
        });

        ATTRIBUTE_TARGETS.forEach(function (target) {
            if (!matches(element, target.selector)) return;
            var value = element.getAttribute(target.attribute);
            if (value) keys.push(target.prefix + value);
        });

        return keys;
    }

    function collect(found, seen, element) {
        keysOf(element).forEach(function (key) {
            if (seen[key]) return;
            seen[key] = true;
            var row = offerableRow(key);
            if (row) found.push({ key: key, name: row.name, element: element });
        });
    }

    // The elements the click can be said to be on, innermost first.
    function candidates(start) {
        var found = [];
        var seen = Object.create(null);
        var element = start;

        for (var depth = 0; element && element !== document.body && depth < MAX_DEPTH; depth += 1) {
            collect(found, seen, element);
            element = element.parentElement;
        }

        return found;
    }

    // True when text is selected inside the element: the browser's menu, which
    // copies it, keeps the right-click.
    function hasSelectionIn(element) {
        var selection = window.getSelection ? window.getSelection() : null;
        if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
        return typeof selection.containsNode === 'function' && selection.containsNode(element, true);
    }

    function sectionPanel(sectionId) {
        var panel = window.PoznoteUiCustomizationPanel;
        if (!panel || typeof panel.openSection !== 'function' || typeof panel.hasSection !== 'function') return null;
        return panel.hasSection(sectionId) ? panel : null;
    }

    function sectionItem(panel, sectionId) {
        return {
            icon: 'lucide-eye-off',
            label: label('menuElementVisibility', 'Element visibility'),
            run: function () { panel.openSection(sectionId); }
        };
    }

    document.addEventListener('contextmenu', function (event) {
        if (event.defaultPrevented || event.shiftKey || !mayCustomize()) return;

        var target = event.target;
        if (!target || !target.closest) return;
        if (target.closest(OWNED_REGIONS)) return;
        if (isTextEditingContext(target)) return;

        var menu = contextMenu();
        if (!menu) return;

        // A task row: its text (and any spot that matches no key) leads to the
        // "Task lists" section. A link in the text and a selection keep the
        // browser's menu (open in a new tab, copy).
        var task = target.closest(TASK_ROWS);
        var inTaskText = !!target.closest(CONTENT_REGIONS);
        if (inTaskText && (!task || target.closest('a[href]') || hasSelectionIn(task))) return;

        var found = inTaskText ? [] : candidates(target);
        if (!found.length) {
            var panel = task ? sectionPanel(TASK_LISTS_SECTION) : null;
            if (!panel) return;
            event.preventDefault();
            menu.open(event, task, { items: [sectionItem(panel, TASK_LISTS_SECTION)] });
            return;
        }

        // A single way into the list, opened on the row of the element right
        // under the pointer.
        event.preventDefault();
        menu.open(event, found[0].element, {
            items: [{
                icon: 'lucide-eye-off',
                label: label('menuElementVisibility', 'Element visibility'),
                run: function () { menu.revealKey(found[0].key); }
            }]
        });
    });
})();
