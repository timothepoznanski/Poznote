/**
 * A <select> of the Settings page whose options carry an icon: a native list
 * cannot draw one, so a button with the look of the inline lists
 * (.settings-inline-select) shows the chosen option, icon included, and opens
 * a menu of the options with theirs.
 *
 *   <select class="settings-inline-control settings-inline-select" data-icon-select>
 *       <option value="preview" data-icon="lucide lucide-file-text">Preview</option>
 *   </select>
 *
 * The <select> stays in the page, out of sight: it keeps the value and the
 * translated labels, and js/settings-page.js goes on reading its value and
 * listening to its 'change' event. Choosing an item sets the value and fires
 * 'change'. A value set by script (the stored setting, once loaded) is shown
 * through sync(), which settings-page.js calls after setting it.
 *
 * The menu is one element on <body> with position:fixed, so the card around
 * the button cannot clip it.
 */
(function () {
    'use strict';

    var menuEl = null;
    var openSelect = null;

    function iconClass(option) {
        return (option && option.getAttribute('data-icon')) || '';
    }

    function makeIcon(className) {
        var icon = document.createElement('i');
        icon.className = className;
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    }

    function visibleOptions(select) {
        return Array.prototype.filter.call(select.options, function (option) {
            return !option.hidden && !option.disabled;
        });
    }

    function sync(select) {
        var state = select && select.poznoteIconSelect;
        if (!state) return;
        var chosen = select.options[select.selectedIndex] || null;
        var className = iconClass(chosen);
        state.icon.className = className;
        state.icon.hidden = !className;
        state.label.textContent = chosen ? chosen.textContent.trim() : '';
    }

    function close(restoreFocus) {
        if (!menuEl || menuEl.hidden) return;
        var select = openSelect;
        menuEl.hidden = true;
        menuEl.innerHTML = '';
        openSelect = null;
        if (select && select.poznoteIconSelect) {
            var toggle = select.poznoteIconSelect.toggle;
            toggle.setAttribute('aria-expanded', 'false');
            if (restoreFocus) toggle.focus();
        }
    }

    // Under the button, aligned on its right edge like the native list,
    // flipped above it when the viewport has no room below
    function place() {
        if (!menuEl || menuEl.hidden || !openSelect) return;
        var toggle = openSelect.poznoteIconSelect.toggle;
        var rect = toggle.getBoundingClientRect();
        if (!toggle.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) {
            close();
            return;
        }
        menuEl.style.minWidth = Math.round(rect.width) + 'px';
        var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
        var top = rect.bottom + 4;
        if (top + mh > window.innerHeight - 8 && rect.top - 4 - mh >= 8) top = rect.top - 4 - mh;
        var left = Math.min(Math.max(8, rect.right - mw), window.innerWidth - mw - 8);
        menuEl.style.top = Math.round(top) + 'px';
        menuEl.style.left = Math.round(left) + 'px';
    }

    function ensureMenu() {
        if (menuEl) return menuEl;
        menuEl = document.createElement('div');
        menuEl.className = 'settings-icon-select-menu';
        menuEl.setAttribute('role', 'menu');
        menuEl.hidden = true;
        menuEl.addEventListener('click', function (e) { e.stopPropagation(); });
        menuEl.addEventListener('keydown', function (e) {
            var items = Array.prototype.slice.call(menuEl.querySelectorAll('.settings-icon-select-item'));
            var index = items.indexOf(document.activeElement);
            if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                var next = e.key === 'ArrowDown' ? index + 1 : index - 1;
                if (items.length) items[(next + items.length) % items.length].focus();
            } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                if (items.length) items[e.key === 'Home' ? 0 : items.length - 1].focus();
            } else if (e.key === 'Tab') {
                close();
            }
        });
        document.body.appendChild(menuEl);

        document.addEventListener('click', function () { close(); });
        window.addEventListener('resize', function () { place(); });
        document.addEventListener('scroll', function (e) {
            if (e.target instanceof Node && menuEl.contains(e.target)) return;
            place();
        }, true);
        return menuEl;
    }

    function open(select) {
        var state = select && select.poznoteIconSelect;
        if (!state) return;
        close();
        var menu = ensureMenu();
        visibleOptions(select).forEach(function (option) {
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'settings-icon-select-item';
            item.setAttribute('role', 'menuitemradio');
            var selected = option.value === select.value;
            item.setAttribute('aria-checked', selected ? 'true' : 'false');
            var className = iconClass(option);
            if (className) item.appendChild(makeIcon(className));
            var text = document.createElement('span');
            text.textContent = option.textContent.trim();
            item.appendChild(text);
            item.addEventListener('click', function () {
                close(true);
                // data-unset: the list shows what applies while nothing is
                // stored, so its option is still a choice worth saving
                if (option.value === select.value && !select.hasAttribute('data-unset')) return;
                select.removeAttribute('data-unset');
                select.value = option.value;
                sync(select);
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });
            menu.appendChild(item);
        });
        openSelect = select;
        state.toggle.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        place();
        var first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('.settings-icon-select-item');
        if (first) first.focus();
    }

    function attach(select) {
        if (!select || select.poznoteIconSelect) return;
        var toggle = document.createElement('button');
        toggle.type = 'button';
        // .settings-inline-control: a click on it is not a click on the card
        // around it (which would open the list a second time)
        toggle.className = 'settings-inline-control settings-inline-select settings-icon-select-toggle';
        toggle.setAttribute('aria-haspopup', 'menu');
        toggle.setAttribute('aria-expanded', 'false');
        var labelledBy = select.id ? document.querySelector('label[for="' + select.id + '"]') : null;
        if (labelledBy) {
            if (!labelledBy.id) labelledBy.id = select.id + '-label';
            toggle.setAttribute('aria-labelledby', labelledBy.id + ' ' + select.id + '-toggle-value');
            // A click on the title is a click on the card, which opens the
            // menu (js/settings-page.js); pointing at the hidden <select>, the
            // label would also click it, and that click would close the menu
            labelledBy.removeAttribute('for');
        }
        var icon = makeIcon('');
        var label = document.createElement('span');
        label.className = 'settings-icon-select-label';
        if (select.id) label.id = select.id + '-toggle-value';
        toggle.appendChild(icon);
        toggle.appendChild(label);
        toggle.appendChild(makeIcon('lucide lucide-chevron-down settings-icon-select-caret'));
        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            if (openSelect === select) close();
            else open(select);
        });
        toggle.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                open(select);
            }
        });

        // Out of sight and out of the tab order: the button carries the label.
        // The <select> stays first in the card, which is what the settings
        // filter reads its value from.
        select.classList.add('settings-icon-select-source');
        select.setAttribute('aria-hidden', 'true');
        select.tabIndex = -1;
        select.parentNode.insertBefore(toggle, select.nextSibling);
        select.poznoteIconSelect = { toggle: toggle, icon: icon, label: label };
        select.addEventListener('change', function () { sync(select); });
        sync(select);
    }

    function attachAll() {
        document.querySelectorAll('select[data-icon-select]').forEach(attach);
    }

    window.poznoteSettingsIconSelect = { attach: attach, sync: sync, open: open, close: close };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachAll);
    } else {
        attachAll();
    }
})();
