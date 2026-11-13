/**
 * Right-click on the line under the note title.
 *
 * A right-click on the line of the opened note (note id, dates, characters,
 * words, lines, information icon: note_display.php, css/notes/subline.css)
 * opens the small menu of the icon rail (#iconContextMenu,
 * js/icon-sidebar-colors.js) with a single "Element visibility" entry. It
 * opens the panel on the "Under the note title" section, unfolded, the others
 * folded, where each item of the line has its box. Nothing is shown or hidden
 * from the menu itself.
 *
 * The line is one of the regions js/hide-element-menu.js leaves alone, so this
 * file is the only one answering there.
 */
(function () {
    'use strict';

    var TARGET_SELECTOR = '.innernote .note-title-heading .note-subline';
    var SECTION_ID = 'note-subline';

    // Already translated by icon_sidebar.php, like the other entries of this
    // menu: window.t is not loaded on every page that shows a note.
    function label() {
        var config = window.PoznoteIconSidebarColorsConfig || {};
        return config.menuElementVisibility || 'Element visibility';
    }

    // The panel edits a setting of the account being looked at, which only
    // its owner may do (the same guard as the icon rail's right-click menu).
    function mayCustomize() {
        var config = window.PoznoteIconSidebarColorsConfig;
        return !config || config.canCustomize !== false;
    }

    function sectionPanel() {
        var panel = window.PoznoteUiCustomizationPanel;
        if (!panel || typeof panel.openSection !== 'function' || typeof panel.hasSection !== 'function') return null;
        return panel.hasSection(SECTION_ID) ? panel : null;
    }

    // Capture phase, like the title menu (js/note-title-menu.js).
    document.addEventListener('contextmenu', function (event) {
        if (event.shiftKey || !mayCustomize()) return;
        var line = event.target.closest && event.target.closest(TARGET_SELECTOR);
        if (!line) return;

        var menu = window.PoznoteIconContextMenu;
        var panel = sectionPanel();
        if (!menu || typeof menu.open !== 'function' || !panel) return;

        event.preventDefault();
        menu.open(event, event.target.closest('button') || line, {
            items: [{
                icon: 'lucide-eye-off',
                label: label(),
                run: function () { panel.openSection(SECTION_ID); }
            }]
        });
    }, true);
})();
