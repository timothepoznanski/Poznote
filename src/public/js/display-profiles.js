/**
 * Display profiles: named sets of the display preferences this browser keeps
 * (font sizes, icon sizes, fonts), saved under a name and applied in one go.
 * Meant for one computer used on several screens (a laptop on its own, then
 * plugged into a 24" or an ultrawide screen), or for a "presentation" set
 * with bigger icons. Switching is always manual.
 *
 * Everything lives in the browser, per user (window.__poznoteUserStorage,
 * js/theme-init.js), like the preferences a profile holds:
 *   display_profiles  JSON list of { id, name, values: { key: value|null } }
 * A null value means "the default": applying it removes the stored key.
 *
 * The profile in use is not stored: it is the profile whose values match the
 * current display, so changing a size by hand shows that no profile is in use
 * any more instead of claiming one that no longer describes the screen.
 *
 * UI: a card in Settings > Display opens #displayProfilesModal (built here),
 * and a button of the icon rail, above the theme one, opens a menu of the
 * profiles to switch from any page without going to Settings. icon_sidebar.php
 * loads this file and renders #displayProfilesStrings, so the strings are
 * there before window.t on every page carrying the rail.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'display_profiles';
    var MAX_PROFILES = 20;
    var MAX_NAME_LENGTH = 40;

    // What a profile holds, with the default each reader falls back on. Keep
    // the font sizes in step with PX_FONT_SIZES of js/font-size-settings.js.
    // settings_font_size has a viewport dependent default, so it has none here:
    // null stays null and is never matched against a number.
    var KEYS = [
        { key: 'note_font_size', fallback: '15', kind: 'int', cssVar: '--note-font-size' },
        { key: 'sidebar_font_size', fallback: '13', kind: 'int', cssVar: '--sidebar-font-size' },
        { key: 'code_block_font_size', fallback: '15', kind: 'int', cssVar: '--code-block-font-size' },
        { key: 'folder_path_font_size', fallback: '13', kind: 'int', cssVar: '--folder-path-font-size' },
        { key: 'tags_font_size', fallback: '13', kind: 'int', cssVar: '--tags-font-size' },
        { key: 'attachments_font_size', fallback: '13', kind: 'int', cssVar: '--attachments-font-size' },
        { key: 'backlinks_font_size', fallback: '14', kind: 'int', cssVar: '--backlinks-font-size' },
        { key: 'settings_font_size', fallback: null, kind: 'int' },
        { key: 'index_icon_scale', fallback: '1.0', kind: 'scale' },
        { key: 'icon_rail_scale', fallback: '1.0', kind: 'scale' },
        { key: 'main_font', fallback: 'inter', kind: 'text' },
        { key: 'markdown_font', fallback: 'inherit', kind: 'text' }
    ];

    var store = window.__poznoteUserStorage || window.localStorage;

    // ========== Strings ==========

    var strings = null;
    function str(key, vars, fallback) {
        if (strings === null) {
            strings = {};
            var node = document.getElementById('displayProfilesStrings');
            if (node) {
                try { strings = JSON.parse(node.textContent) || {}; } catch (e) {
                    console.debug('display-profiles: strings unreadable:', e);
                }
            }
        }
        var text = typeof strings[key] === 'string' && strings[key] !== '' ? strings[key] : fallback;
        Object.keys(vars || {}).forEach(function (name) {
            text = text.split('{{' + name + '}}').join(String(vars[name]));
        });
        return text;
    }

    function esc(value) {
        return String(value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ========== Values ==========

    // One spelling per value, so that two profiles (or a profile and the
    // display) compare equal when they show the same thing
    function normalize(entry, raw) {
        if (raw === null || raw === undefined || raw === '') return null;
        var value = String(raw).trim();
        if (entry.kind === 'int') {
            var size = parseInt(value, 10);
            if (isNaN(size) || size < 10 || size > 32) return null;
            value = String(size);
        } else if (entry.kind === 'scale') {
            var scale = parseFloat(value);
            if (isNaN(scale) || scale < 0.5 || scale > 2) return null;
            value = scale.toFixed(1);
        } else if (value.length > 200) {
            return null;
        }
        return value === entry.fallback ? null : value;
    }

    function currentValues() {
        var values = {};
        KEYS.forEach(function (entry) {
            values[entry.key] = normalize(entry, store.getItem(entry.key));
        });
        return values;
    }

    function sameValues(a, b) {
        return KEYS.every(function (entry) {
            return normalize(entry, a[entry.key]) === normalize(entry, b[entry.key]);
        });
    }

    // ========== Profiles ==========

    function loadProfiles() {
        var list;
        try { list = JSON.parse(store.getItem(STORAGE_KEY) || '[]'); } catch (e) {
            list = [];
        }
        if (!Array.isArray(list)) return [];
        return list.filter(function (profile) {
            return profile && typeof profile.id === 'string' && typeof profile.name === 'string'
                && profile.values && typeof profile.values === 'object';
        }).slice(0, MAX_PROFILES);
    }

    function saveProfiles(list) {
        store.setItem(STORAGE_KEY, JSON.stringify(list));
        renderMenu();
        renderCardStatus();
    }

    function findProfile(list, id) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }

    function activeProfile(list) {
        var values = currentValues();
        for (var i = 0; i < list.length; i++) {
            if (sameValues(list[i].values, values)) return list[i];
        }
        return null;
    }

    function newId() {
        return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function cleanName(name) {
        return String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    }

    function nameTaken(list, name, exceptId) {
        var lower = name.toLocaleLowerCase();
        return list.some(function (profile) {
            return profile.id !== exceptId && profile.name.toLocaleLowerCase() === lower;
        });
    }

    // ========== Applying ==========

    function onSettingsPage() {
        return !!document.getElementById('settings-display-section-grid');
    }

    // Not on the Settings page, which does not style the toast: there the
    // list of the dialog shows what changed
    function toast(text) {
        if (onSettingsPage()) return;
        if (typeof window.poznoteShowToast === 'function') window.poznoteShowToast(text);
    }

    // Writes the values, then lets each preference repaint the page that is
    // already laid out. The Settings page reloads instead: its cards (badges,
    // sliders, font menus) show the stored values and would be left stale.
    function applyProfile(profile) {
        KEYS.forEach(function (entry) {
            var value = normalize(entry, profile.values[entry.key]);
            if (value === null) store.removeItem(entry.key);
            else store.setItem(entry.key, value);
        });

        if (onSettingsPage()) {
            window.location.reload();
            return;
        }

        if (typeof window.__poznoteApplyMainFont === 'function') {
            window.__poznoteApplyMainFont(store.getItem('main_font'));
        }
        if (typeof window.__poznoteApplyEditorFont === 'function') {
            window.__poznoteApplyEditorFont(store.getItem('markdown_font'));
        }
        if (typeof window.__poznoteApplyIconRailScale === 'function') {
            window.__poznoteApplyIconRailScale();
        }
        if (typeof window.applyIndexIconScale === 'function') {
            window.applyIndexIconScale(store.getItem('index_icon_scale') || '1.0');
        }
        // Last: it also remeasures the Markdown editors, which the fonts
        // above change as well
        if (typeof window.poznoteApplyStoredFontSizes === 'function') {
            window.poznoteApplyStoredFontSizes();
        } else {
            // Pages without js/font-size-settings.js: the variables index.php
            // and the stylesheets read, with their defaults
            KEYS.forEach(function (entry) {
                if (!entry.cssVar) return;
                var size = normalize(entry, store.getItem(entry.key));
                document.documentElement.style.setProperty(entry.cssVar, (size === null ? entry.fallback : size) + 'px');
            });
        }

        renderMenu();
        renderCardStatus();
        toast(str('applied', { name: profile.name }, 'Display profile "{{name}}" applied'));
    }

    // ========== Rail button menu ==========

    // The button of the icon rail, just above the theme one (icon_sidebar.php),
    // opens a menu built here with the classes of the rail's overflow and
    // theme menus (css/icon-sidebar.css), so the three read the same: one
    // entry per profile, the one in use checked, then the way to the dialog.
    var MENU_ID = 'displayProfilesMenu';
    var MENU_OPEN_CLASS = 'icon-sidebar-overflow-open';
    var menuButton = null;

    function getMenu() {
        var menu = document.getElementById(MENU_ID);
        if (menu) return menu;
        menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.setAttribute('role', 'menu');
        document.body.appendChild(menu);
        return menu;
    }

    function isMenuOpen() {
        var menu = document.getElementById(MENU_ID);
        return !!menu && menu.classList.contains(MENU_OPEN_CLASS);
    }

    function closeMenu(restoreFocus) {
        var menu = document.getElementById(MENU_ID);
        if (menu) menu.classList.remove(MENU_OPEN_CLASS);
        if (menuButton) {
            menuButton.setAttribute('aria-expanded', 'false');
            if (restoreFocus) menuButton.focus();
        }
        menuButton = null;
    }

    function menuItems() {
        var menu = document.getElementById(MENU_ID);
        return menu ? Array.prototype.slice.call(menu.querySelectorAll('.icon-sidebar-overflow-item')) : [];
    }

    // Fixed and placed beside the button, like the theme menu: the rail
    // scrolls and clips
    function positionMenu(menu, button) {
        var box = button.getBoundingClientRect();
        var size = menu.getBoundingClientRect();
        var gap = 8;
        var left = box.right + gap;
        if (left + size.width > window.innerWidth - gap) {
            left = Math.max(gap, box.left - size.width - gap);
        }
        var top = Math.min(box.bottom - size.height, window.innerHeight - size.height - gap);
        menu.style.left = Math.round(left) + 'px';
        menu.style.top = Math.round(Math.max(gap, top)) + 'px';
    }

    function menuItemHtml(icon, text, attributes) {
        return '<button type="button" class="icon-sidebar-overflow-item"' + attributes + '>'
            + '<i class="lucide ' + icon + '"></i><span>' + esc(text) + '</span></button>';
    }

    function openMenu(button) {
        var menu = getMenu();
        var list = loadProfiles();
        var active = activeProfile(list);

        var html = list.map(function (profile) {
            var checked = !!active && active.id === profile.id;
            return menuItemHtml(checked ? 'lucide-check' : 'lucide-monitor', profile.name,
                ' role="menuitemradio" aria-checked="' + (checked ? 'true' : 'false') + '"'
                + (checked ? ' data-active="1"' : '')
                + ' data-display-profile-apply="' + esc(profile.id) + '"');
        }).join('');
        if (list.length === 0) {
            html += '<div class="icon-sidebar-overflow-hint" role="none">' + esc(str('empty', {}, 'No profile yet.')) + '</div>';
        }
        // Settings, where the dialog lives, is closed to someone looking at an
        // account that is not theirs: the button then carries no manage link
        var manageUrl = button.getAttribute('data-manage-url');
        if (manageUrl) {
            html += '<div class="icon-sidebar-overflow-separator" role="separator"></div>';
            html += menuItemHtml('lucide-settings', str('manage', {}, 'Manage display profiles'),
                ' role="menuitem" data-display-profiles-manage="' + esc(manageUrl) + '"');
        }
        menu.innerHTML = html;
        Array.prototype.forEach.call(menu.querySelectorAll('[data-active="1"]'), function (item) {
            item.classList.add('icon-sidebar-overflow-item-active');
        });

        menuButton = button;
        menu.classList.add(MENU_OPEN_CLASS);
        button.setAttribute('aria-expanded', 'true');
        positionMenu(menu, button);

        var first = menu.querySelector('[aria-checked="true"]') || menuItems()[0];
        if (first) first.focus();
    }

    function initMenu() {
        document.addEventListener('click', function (e) {
            var target = e.target;
            if (!target || typeof target.closest !== 'function') return;

            var choice = target.closest('[data-display-profile-apply]');
            if (choice) {
                e.preventDefault();
                closeMenu(false);
                var profile = findProfile(loadProfiles(), choice.getAttribute('data-display-profile-apply'));
                if (profile) applyProfile(profile);
                return;
            }

            var manage = target.closest('[data-display-profiles-manage]');
            if (manage) {
                e.preventDefault();
                closeMenu(false);
                if (document.getElementById('display-profiles-card')) openModal();
                else window.location.href = manage.getAttribute('data-display-profiles-manage');
                return;
            }

            var toggle = target.closest('[data-display-profiles-toggle]');
            if (toggle) {
                e.preventDefault();
                var reopen = !isMenuOpen() || menuButton !== toggle;
                closeMenu(false);
                if (reopen) openMenu(toggle);
                return;
            }

            if (isMenuOpen() && !target.closest('#' + MENU_ID)) closeMenu(false);
        });

        document.addEventListener('keydown', function (e) {
            if (!isMenuOpen()) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closeMenu(true);
                return;
            }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            var items = menuItems();
            if (!items.length) return;
            e.preventDefault();
            var index = items.indexOf(document.activeElement);
            var next = e.key === 'ArrowDown' ? index + 1 : index - 1;
            items[(next + items.length) % items.length].focus();
        });

        window.addEventListener('resize', function () {
            if (isMenuOpen()) closeMenu(false);
        });
    }

    // Nothing to repaint: the menu is rebuilt each time it opens
    function renderMenu() {}

    // ========== Settings card ==========

    function renderCardStatus() {
        var badge = document.getElementById('display-profiles-status');
        if (!badge) return;
        var list = loadProfiles();
        var active = activeProfile(list);
        if (active) {
            badge.textContent = active.name;
        } else if (list.length === 0) {
            badge.textContent = str('status_none', {}, 'No profile');
        } else if (list.length === 1) {
            badge.textContent = str('status_one', {}, '1 profile');
        } else {
            badge.textContent = str('status_count', { count: list.length }, '{{count}} profiles');
        }
        badge.className = 'setting-status ' + (active ? 'enabled' : 'disabled');
    }

    // ========== Modal ==========

    var modal = null;

    // Names of the fonts of the Settings menus that are not translated there
    var FONT_NAMES = {
        arial: 'Arial', verdana: 'Verdana', trebuchet: 'Trebuchet MS', georgia: 'Georgia',
        times: 'Times New Roman', courier: 'Courier New', consolas: 'Consolas', menlo: 'Menlo',
        monaco: 'Monaco', jetbrains: 'JetBrains Mono', cascadia: 'Cascadia Code', fira: 'Fira Code',
        sourcecodepro: 'Source Code Pro', ubuntumono: 'Ubuntu Mono'
    };

    function fontName(id) {
        var translated = strings && strings.font_names && strings.font_names[id];
        if (translated) return translated;
        if (FONT_NAMES[id]) return FONT_NAMES[id];
        var custom = typeof window.__poznoteFindCustomFont === 'function' ? window.__poznoteFindCustomFont(id) : null;
        return custom && custom.name ? custom.name : id;
    }

    // Every value a profile holds, in the order of the Settings page
    function detailHtml(values) {
        var labels = (strings && strings.labels) || {};
        return '<dl class="display-profile-details">' + KEYS.map(function (entry) {
            var value = normalize(entry, values[entry.key]);
            var shown;
            if (entry.kind === 'int') {
                if (value === null && entry.fallback === null) {
                    value = typeof window.settingsFontSizeDefault === 'function' ? window.settingsFontSizeDefault() : '15';
                }
                shown = (value === null ? entry.fallback : value) + ' px';
            } else if (entry.kind === 'scale') {
                shown = (value === null ? entry.fallback : value) + 'x';
            } else {
                shown = fontName(value === null ? entry.fallback : value);
            }
            return '<dt>' + esc(labels[entry.key] || entry.key) + '</dt><dd>' + esc(shown) + '</dd>';
        }).join('') + '</dl>';
    }

    // Profiles unfolded in the dialog, kept across its re-renders
    var expanded = {};

    function buildModal() {
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'displayProfilesModal';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'displayProfilesTitle');
        modal.innerHTML =
            '<div class="modal-content">'
                + '<h3 id="displayProfilesTitle">' + esc(str('title', {}, 'Display profiles')) + '</h3>'
                + '<p class="display-profiles-description">' + esc(str('description', {}, 'A profile keeps the font sizes, the icon sizes and the fonts of this browser. Save one for each way you work (laptop, large screen, presentation), then switch between them with the monitor button of the icon sidebar, on any page.')) + '</p>'
                + '<form class="display-profiles-create" autocomplete="off">'
                    + '<input type="text" class="display-profiles-name" maxlength="' + MAX_NAME_LENGTH + '"'
                        + ' placeholder="' + esc(str('name_placeholder', {}, 'Name, e.g. Laptop')) + '"'
                        + ' aria-label="' + esc(str('name_label', {}, 'Profile name')) + '">'
                    + '<button type="submit" class="btn btn-primary">' + esc(str('save_current', {}, 'Save current display')) + '</button>'
                + '</form>'
                + '<div class="display-profiles-error" hidden></div>'
                + '<ul class="display-profiles-list"></ul>'
                + '<div class="modal-buttons">'
                    + '<button type="button" class="btn-secondary display-profiles-close">' + esc(str('close', {}, 'Close')) + '</button>'
                + '</div>'
            + '</div>';
        document.body.appendChild(modal);

        modal.querySelector('.display-profiles-create').addEventListener('submit', function (e) {
            e.preventDefault();
            createProfile();
        });
        modal.querySelector('.display-profiles-close').addEventListener('click', closeModal);
        modal.querySelector('.display-profiles-list').addEventListener('click', onListClick);
        modal.querySelector('.display-profiles-list').addEventListener('keydown', onListKeydown);

        var pressedOnBackdrop = false;
        modal.addEventListener('mousedown', function (e) { pressedOnBackdrop = e.target === modal; });
        modal.addEventListener('click', function (e) {
            if (e.target === modal && pressedOnBackdrop) closeModal();
            pressedOnBackdrop = false;
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || e.defaultPrevented || !isModalOpen() || isConfirmOpen()) return;
            // Escape in a rename field cancels the rename only
            if (e.target.classList && e.target.classList.contains('display-profile-rename-input')) return;
            e.preventDefault();
            closeModal();
        });
        return modal;
    }

    function isModalOpen() {
        return !!modal && modal.style.display === 'flex';
    }

    function openModal() {
        buildModal();
        showError('');
        renderList();
        modal.style.display = 'flex';
    }

    function closeModal() {
        if (modal) modal.style.display = 'none';
    }

    function showError(message) {
        if (!modal) return;
        var box = modal.querySelector('.display-profiles-error');
        box.textContent = message;
        box.hidden = !message;
    }

    function iconButton(action, id, icon, label, extraClass) {
        return '<button type="button" class="display-profile-icon-btn' + (extraClass ? ' ' + extraClass : '') + '"'
            + ' data-profile-action="' + action + '" data-id="' + esc(id) + '"'
            + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">'
            + '<i class="lucide ' + icon + '"></i></button>';
    }

    function renderList() {
        if (!modal) return;
        var listNode = modal.querySelector('.display-profiles-list');
        var list = loadProfiles();
        var active = activeProfile(list);

        if (list.length === 0) {
            listNode.innerHTML = '<li class="display-profiles-empty">' + esc(str('empty', {}, 'No profile yet.')) + '</li>';
            return;
        }

        listNode.innerHTML = list.map(function (profile) {
            var isActive = active && active.id === profile.id;
            // Switching is the rail button's job: the dialog only says which
            // profile the display matches
            var currentLabel = isActive
                ? '<span class="display-profile-current"><i class="lucide lucide-check"></i>' + esc(str('current', {}, 'In use')) + '</span>'
                : '';
            var open = !!expanded[profile.id];
            var toggleLabel = str('show_details', {}, 'Show details');
            return '<li class="display-profile-row' + (isActive ? ' is-active' : '') + (open ? ' is-expanded' : '') + '" data-id="' + esc(profile.id) + '">'
                + '<button type="button" class="display-profile-icon-btn display-profile-toggle" data-profile-action="toggle" data-id="' + esc(profile.id) + '"'
                    + ' aria-expanded="' + (open ? 'true' : 'false') + '" title="' + esc(toggleLabel) + '" aria-label="' + esc(toggleLabel) + '">'
                    + '<i class="lucide lucide-chevron-right"></i></button>'
                + '<div class="display-profile-main">'
                    + '<span class="display-profile-name" title="' + esc(profile.name) + '">' + esc(profile.name) + '</span>'
                + '</div>'
                + currentLabel
                + (isActive ? '' : iconButton('update', profile.id, 'lucide-save', str('update', {}, 'Replace with the current display')))
                + iconButton('rename', profile.id, 'lucide-pencil', str('rename', {}, 'Rename'))
                + iconButton('delete', profile.id, 'lucide-trash-2', str('delete', {}, 'Delete'), 'display-profile-delete')
                + (open ? detailHtml(profile.values) : '')
            + '</li>';
        }).join('');
    }

    function createProfile() {
        var input = modal.querySelector('.display-profiles-name');
        var name = cleanName(input.value);
        var list = loadProfiles();
        showError('');

        if (name === '') {
            showError(str('name_required', {}, 'Give the profile a name.'));
            input.focus();
            return;
        }
        if (nameTaken(list, name, null)) {
            showError(str('name_taken', {}, 'A profile already has this name.'));
            input.focus();
            return;
        }
        if (list.length >= MAX_PROFILES) {
            showError(str('limit', { count: MAX_PROFILES }, 'Limit reached: delete a profile before saving another.'));
            return;
        }

        list.push({ id: newId(), name: name, values: currentValues() });
        saveProfiles(list);
        input.value = '';
        renderList();
        toast(str('saved', { name: name }, 'Display profile "{{name}}" saved'));
    }

    function startRename(row, profile) {
        var nameNode = row.querySelector('.display-profile-name');
        if (!nameNode || row.querySelector('.display-profile-rename-input')) return;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'display-profile-rename-input';
        input.maxLength = MAX_NAME_LENGTH;
        input.value = profile.name;
        input.setAttribute('aria-label', str('name_label', {}, 'Profile name'));
        input.setAttribute('data-id', profile.id);
        nameNode.replaceWith(input);
        input.focus();
        input.select();

        var done = false;
        function finish(commit) {
            if (done) return;
            done = true;
            if (commit) {
                var name = cleanName(input.value);
                var list = loadProfiles();
                var target = findProfile(list, profile.id);
                if (target && name !== '' && name !== target.name) {
                    if (nameTaken(list, name, target.id)) {
                        showError(str('name_taken', {}, 'A profile already has this name.'));
                    } else {
                        showError('');
                        target.name = name;
                        saveProfiles(list);
                    }
                }
            }
            renderList();
        }
        input.addEventListener('blur', function () { finish(true); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
    }

    function onListKeydown(e) {
        // Enter in the rename field must not reach a button of the row
        if (e.key === 'Enter' && e.target.classList.contains('display-profile-rename-input')) {
            e.stopPropagation();
        }
    }

    // Deleting asks in the shared confirmation window (#confirmModal,
    // modals.php, js/ui.js). Moved after this dialog in the page: modals share
    // one z-index, so the later one paints on top, and the shared Escape
    // handler (js/modals-events.js) closes the last open one in DOM order.
    function confirmDelete(profile, onConfirm) {
        var title = str('delete_title', {}, 'Delete this profile?');
        var message = str('delete_message', { name: profile.name }, 'The display profile "{{name}}" will be deleted. The current display does not change.');
        if (typeof window.showConfirmModal !== 'function' || !document.getElementById('confirmModal')) {
            if (window.confirm(message)) onConfirm();
            return;
        }
        document.body.appendChild(document.getElementById('confirmModal'));
        window.showConfirmModal(title, message, onConfirm, { confirmText: str('delete', {}, 'Delete'), danger: true, focusConfirm: true });
    }

    function isConfirmOpen() {
        var confirmModal = document.getElementById('confirmModal');
        return !!confirmModal && confirmModal.style.display === 'flex';
    }

    function onListClick(e) {
        var button = e.target.closest('[data-profile-action]');
        if (!button) return;
        var action = button.getAttribute('data-profile-action');
        var list = loadProfiles();
        var profile = findProfile(list, button.getAttribute('data-id'));
        if (!profile) { renderList(); return; }
        showError('');

        if (action === 'toggle') {
            expanded[profile.id] = !expanded[profile.id];
            renderList();
            var again = modal.querySelector('.display-profile-toggle[data-id="' + profile.id + '"]');
            if (again) again.focus();
        } else if (action === 'update') {
            profile.values = currentValues();
            saveProfiles(list);
            renderList();
            toast(str('updated', { name: profile.name }, 'Display profile "{{name}}" updated'));
        } else if (action === 'rename') {
            startRename(button.closest('.display-profile-row'), profile);
        } else if (action === 'delete') {
            confirmDelete(profile, function () {
                saveProfiles(loadProfiles().filter(function (item) { return item.id !== profile.id; }));
                renderList();
            });
        }
    }

    function initCard() {
        var card = document.getElementById('display-profiles-card');
        if (!card) return;
        renderCardStatus();
        card.addEventListener('click', function (e) {
            if (e.target.closest('.setting-help')) return;
            openModal();
        });

        // Deep link: settings.php?open=display-profiles (the rail menu's
        // Manage entry on the other pages)
        var params = new URLSearchParams(window.location.search || '');
        if (params.get('open') === 'display-profiles') {
            openModal();
            if (window.history && typeof window.history.replaceState === 'function') {
                var cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete('open');
                window.history.replaceState(window.history.state, '', cleanUrl.toString());
            }
        }
    }

    // A size saved in another tab (the Settings page) moves the check mark
    // and the card status here too
    window.addEventListener('storage', function (event) {
        if (event.key === null || /(_font_size|_icon_scale|_font|display_profiles)(::|$)/.test(event.key)) {
            renderMenu();
            renderCardStatus();
            if (isModalOpen()) renderList();
        }
    });

    // A size changed by hand on this page (the Settings cards, the Font size
    // dialog) can make a profile match, or stop matching: repaint once the
    // control has stored its value
    var HAND_CONTROLS = ['main-font-select', 'markdown-font-select', 'index-icon-scale-range', 'icon-rail-scale-range'];
    function refreshSoon() {
        setTimeout(function () { renderMenu(); renderCardStatus(); }, 50);
    }

    function init() {
        initMenu();
        initCard();
        document.addEventListener('change', function (e) {
            if (e.target && HAND_CONTROLS.indexOf(e.target.id) !== -1) refreshSoon();
        });
        document.addEventListener('click', function (e) {
            if (e.target && e.target.id === 'saveFontSizeBtn') refreshSoon();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.PoznoteDisplayProfiles = { open: openModal, refresh: function () { renderMenu(); renderCardStatus(); } };
})();
