/**
 * Right-click an element to hide it.
 *
 * A right-click anywhere the "Element visibility" list has a box for what sits
 * under the pointer opens a small menu (the one of js/icon-sidebar-colors.js)
 * with one "Hide" entry per element found, from the one clicked outwards, plus
 * an entry leading to that list. Clicking an entry adds the element's key to
 * the 'hidden_ui_elements' user setting, exactly as unticking its box would,
 * so the two stay in step and a hidden element is ticked back on from the list
 * (a toast says so, since nothing is left behind to right-click again).
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
 * An element is offered only when the page's list holds its row: a key with no
 * box there could be hidden and never shown again. A row the administrator
 * locked, or already unticked, is left out too.
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

    // How many elements the menu offers at once, from the one under the
    // pointer outwards, and how far up the tree it looks for them.
    var MAX_ENTRIES = 3;
    var MAX_DEPTH = 14;

    // Regions that answer a right-click themselves, each already carrying its
    // own "Hide" entry or its own ticks: the icon rail and the note toolbar
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
        '#iconContextMenu',
        '#noteSublineMenu'
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
    // i18n runtime only with the AI panel), and the fallback carries the same
    // {{name}} placeholder as the sentence it replaces.
    function label(configKey, fallback, name) {
        var config = window.PoznoteIconSidebarColorsConfig || {};
        var text = config[configKey] || fallback;
        return name === undefined ? text : text.split('{{name}}').join(name);
    }

    function runtime() {
        return window.PoznoteUiCustomization || null;
    }

    function contextMenu() {
        var menu = window.PoznoteIconContextMenu;
        return menu && typeof menu.open === 'function' && typeof menu.hideKey === 'function' ? menu : null;
    }

    // Hiding writes a setting of the account being looked at, which only its
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

    // Every element the click can be said to be on, innermost first.
    function candidates(start) {
        var found = [];
        var seen = Object.create(null);
        var element = start;

        for (var depth = 0; element && element !== document.body && depth < MAX_DEPTH; depth += 1) {
            collect(found, seen, element);
            element = element.parentElement;
        }

        return found.slice(0, MAX_ENTRIES);
    }

    // True when text is selected inside the element: the browser's menu, which
    // copies it, keeps the right-click.
    function hasSelectionIn(element) {
        var selection = window.getSelection ? window.getSelection() : null;
        if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
        return typeof selection.containsNode === 'function' && selection.containsNode(element, true);
    }

    function taskListsPanel() {
        var panel = window.PoznoteUiCustomizationPanel;
        if (!panel || typeof panel.openSection !== 'function' || typeof panel.hasSection !== 'function') return null;
        return panel.hasSection(TASK_LISTS_SECTION) ? panel : null;
    }

    function sectionItem(panel) {
        return {
            icon: 'lucide-settings',
            label: label('menuElementVisibility', 'Element visibility'),
            run: function () { panel.openSection(TASK_LISTS_SECTION); }
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
            var sectionPanel = task ? taskListsPanel() : null;
            if (!sectionPanel) return;
            event.preventDefault();
            menu.open(event, task, { items: [sectionItem(sectionPanel)] });
            return;
        }

        var items = found.map(function (candidate) {
            return {
                icon: 'lucide-eye-off',
                label: label('menuHideElement', 'Hide "{{name}}"', candidate.name),
                run: function () { menu.hideKey(candidate.key, candidate.element); }
            };
        });

        // The way back: the list where anything hidden is ticked on again,
        // opened on the row of the first element offered above.
        var panel = window.PoznoteUiCustomizationPanel;
        if (panel && typeof panel.open === 'function' && typeof panel.hasKey === 'function' && panel.hasKey(found[0].key)) {
            items.push({
                icon: 'lucide-settings',
                label: label('menuElementVisibility', 'Element visibility'),
                run: function () { panel.open(found[0].key); }
            });
        }

        event.preventDefault();
        menu.open(event, found[0].element, { items: items });
    });
})();
