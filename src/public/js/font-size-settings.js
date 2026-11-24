/**
 * Font size settings module for note editor
 */

// Per-user storage (defined in theme-init.js); falls back to the shared
// localStorage keys on pages loaded without theme-init.js.
const fontSizeStore = window.__poznoteUserStorage || window.localStorage;

// The settings page scales its text through a unitless factor (15px is the
// size of a card title in the desktop layout), so every existing px/rem size
// in css/settings.css and css/home/cards.css keeps its default at 15.
// settings.php applies the same factor inline before the first paint.
const SETTINGS_FONT_SIZE_BASE = 15;

// 15px card text is oversized on a phone, so an install that never touched the
// Font size card starts at 13px below the mobile breakpoint (the same one used
// by css/settings.css). Saving a value stores it for every layout.
const SETTINGS_FONT_SIZE_MOBILE_DEFAULT = 13;

function settingsFontSizeDefault() {
    const mobile = window.matchMedia
        ? window.matchMedia('(max-width: 800px)').matches
        : window.innerWidth <= 800;
    return String(mobile ? SETTINGS_FONT_SIZE_MOBILE_DEFAULT : SETTINGS_FONT_SIZE_BASE);
}

function settingsFontScale(size) {
    const parsed = parseInt(size, 10);
    const safe = (parsed >= 10 && parsed <= 32) ? parsed : parseInt(settingsFontSizeDefault(), 10);
    return String(Math.round((safe / SETTINGS_FONT_SIZE_BASE) * 1000) / 1000);
}

// The sizes in pixels the Font size card sets, in the order of its dialog
// (src/modals.php). Each one is kept in the browser (per user) under `key` and
// written on :root as `cssVar`, which the stylesheets read with the same
// default as a fallback. index.php sets the same variables before the first
// paint: keep its list in step with this one. The Settings page size is not
// here, it is a scale factor with a viewport dependent default (below).
const PX_FONT_SIZES = [
    { key: 'note_font_size', inputId: 'fontSizeInput', cssVar: '--note-font-size', fallback: '15' },
    { key: 'sidebar_font_size', inputId: 'sidebarFontSizeInput', cssVar: '--sidebar-font-size', fallback: '13' },
    { key: 'code_block_font_size', inputId: 'codeBlockFontSizeInput', cssVar: '--code-block-font-size', fallback: '15' },
    { key: 'folder_path_font_size', inputId: 'folderPathFontSizeInput', cssVar: '--folder-path-font-size', fallback: '13' },
    { key: 'tags_font_size', inputId: 'tagsFontSizeInput', cssVar: '--tags-font-size', fallback: '13' },
    { key: 'attachments_font_size', inputId: 'attachmentsFontSizeInput', cssVar: '--attachments-font-size', fallback: '13' },
    { key: 'backlinks_font_size', inputId: 'backlinksFontSizeInput', cssVar: '--backlinks-font-size', fallback: '14' }
];

const SETTINGS_FONT_SIZE_INPUT_ID = 'settingsFontSizeInput';

function storedPxFontSize(entry) {
    return fontSizeStore.getItem(entry.key) || entry.fallback;
}

function storedSettingsFontSize() {
    return fontSizeStore.getItem('settings_font_size') || settingsFontSizeDefault();
}

// Every input of the dialog, or null when the page does not carry it
function fontSizeInputs() {
    const inputs = PX_FONT_SIZES.map(function (entry) {
        return document.getElementById(entry.inputId);
    });
    inputs.push(document.getElementById(SETTINGS_FONT_SIZE_INPUT_ID));
    return inputs.every(Boolean) ? inputs : null;
}

// Function to show font size settings prompt
function showNoteFontSizePrompt() {
    // Close settings menus
    if (typeof closeSettingsMenus === 'function') {
        closeSettingsMenus();
    }

    const modal = document.getElementById('fontSizeModal');
    if (!modal || !fontSizeInputs()) {
        return;
    }

    initFontSizeSettings();

    // Load current font size settings
    loadCurrentFontSizes();

    // Show modal
    modal.style.display = 'block';
}

// Function to close font size modal
function closeFontSizeModal() {
    const modal = document.getElementById('fontSizeModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Safe notification function that checks if the global function exists
function safeShowNotification(message, type) {
    if (typeof showNotificationPopup === 'function') {
        showNotificationPopup(message, type);
    } else if (type === 'error') {
        alert(message);
    }
}

// Keep optional modal preview nodes (<inputId minus "Input">Preview) in sync
// without requiring them to exist.
function updateFontSizePreview() {
    const inputIds = PX_FONT_SIZES.map(function (entry) { return entry.inputId; });
    inputIds.push(SETTINGS_FONT_SIZE_INPUT_ID);

    inputIds.forEach(function (inputId) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(inputId.replace(/Input$/, 'Preview'));

        if (input && preview) {
            preview.style.fontSize = input.value + 'px';
        }
    });
}

// Function to load current font size settings
function loadCurrentFontSizes() {
    PX_FONT_SIZES.forEach(function (entry) {
        const input = document.getElementById(entry.inputId);
        if (input) {
            input.value = storedPxFontSize(entry);
        }
    });

    const settingsFontSizeInput = document.getElementById(SETTINGS_FONT_SIZE_INPUT_ID);
    if (settingsFontSizeInput) {
        settingsFontSizeInput.value = storedSettingsFontSize();
    }

    updateFontSizePreview();
}

// Reset button: puts every field back to its default. Nothing is stored until
// Save, so Cancel still keeps the sizes the user had.
function resetFontSizeFields() {
    PX_FONT_SIZES.forEach(function (entry) {
        const input = document.getElementById(entry.inputId);
        if (input) {
            input.value = entry.fallback;
        }
    });

    const settingsFontSizeInput = document.getElementById(SETTINGS_FONT_SIZE_INPUT_ID);
    if (settingsFontSizeInput) {
        settingsFontSizeInput.value = settingsFontSizeDefault();
    }

    updateFontSizePreview();
}

// Function to save font size settings
function saveFontSize() {
    const inputs = fontSizeInputs();
    if (!inputs) {
        return;
    }

    // Validate inputs
    const outOfRange = inputs.some(function (input) {
        return input.value < 10 || input.value > 32;
    });
    if (outOfRange) {
        safeShowNotification('Font size must be between 10 and 32 pixels', 'error');
        return;
    }

    try {
        PX_FONT_SIZES.forEach(function (entry) {
            fontSizeStore.setItem(entry.key, document.getElementById(entry.inputId).value);
        });
        fontSizeStore.setItem('settings_font_size', document.getElementById(SETTINGS_FONT_SIZE_INPUT_ID).value);

        closeFontSizeModal();

        // Apply changes immediately to the UI
        applyFontSizeToNotes();

        // Direct application as fallback for existing elements
        const noteSize = storedPxFontSize(PX_FONT_SIZES[0]) + 'px';
        const sidebarSize = storedPxFontSize(PX_FONT_SIZES[1]) + 'px';
        document.querySelectorAll('.noteentry').forEach(el => el.style.fontSize = noteSize);
        document.querySelectorAll('.links_arbo_left .note-title, .folder-toggle, .folder-name').forEach(el => el.style.fontSize = sidebarSize);

        if (typeof window.refreshFontSizeBadge === 'function') {
            window.refreshFontSizeBadge();
        }
    } catch (error) {
        safeShowNotification('Error saving font size settings', 'error');
    }
}

// Function to apply font size to all note editors and note list
function applyFontSizeToNotes() {
    // The font sizes are handled via CSS variables on :root, read from the
    // browser storage so the UI is in sync (e.g. on page load)
    const root = document.documentElement.style;
    PX_FONT_SIZES.forEach(function (entry) {
        root.setProperty(entry.cssVar, storedPxFontSize(entry) + 'px');
    });
    root.setProperty('--settings-font-scale', settingsFontScale(storedSettingsFontSize()));
}

// Function to apply font size on page load
function applyStoredFontSize() {
    applyFontSizeToNotes();
}

// Add the function to the window object so it can be called from HTML
window.showNoteFontSizePrompt = showNoteFontSizePrompt;

// js/settings-page.js reads it for the Font size card badge.
window.settingsFontSizeDefault = settingsFontSizeDefault;

// Function to initialize all font size settings elements and events
function initFontSizeSettings() {
    const fontSizeModal = document.getElementById('fontSizeModal');
    const cancelFontSizeBtn = document.getElementById('cancelFontSizeBtn');
    const saveFontSizeBtn = document.getElementById('saveFontSizeBtn');
    const inputs = fontSizeInputs();

    if (!fontSizeModal || !inputs || !cancelFontSizeBtn || !saveFontSizeBtn) {
        return;
    }

    // Add event listeners (once)
    if (!fontSizeModal.hasAttribute('data-initialized')) {
        const closeFontSizeBtn = document.getElementById('closeFontSizeModal');
        if (closeFontSizeBtn) {
            closeFontSizeBtn.addEventListener('click', closeFontSizeModal);
        }
        cancelFontSizeBtn.addEventListener('click', closeFontSizeModal);
        saveFontSizeBtn.addEventListener('click', saveFontSize);

        const resetFontSizeBtn = document.getElementById('resetFontSizeBtn');
        if (resetFontSizeBtn) {
            resetFontSizeBtn.addEventListener('click', resetFontSizeFields);
        }

        inputs.forEach(function (input) {
            input.addEventListener('input', updateFontSizePreview);
        });

        fontSizeModal.setAttribute('data-initialized', 'true');
    }
}

// Apply stored font size when page loads
document.addEventListener('DOMContentLoaded', function () {
    initFontSizeSettings();
    applyStoredFontSize();

    // Set up a MutationObserver to watch for changes in the note list
    const notesContainer = document.getElementById('left_col');
    if (notesContainer) {
        const observer = new MutationObserver(function (mutations) {
            // Check if any mutations added new note list items, folders, or task lists
            let hasNewNotes = false;
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1) { // Element node
                        if (node.classList && (node.classList.contains('links_arbo_left') ||
                            node.classList.contains('folder-name') ||
                            node.classList.contains('checklist-text') ||
                            node.classList.contains('task-list-item') ||
                            node.querySelector && (node.querySelector('.links_arbo_left') ||
                                node.querySelector('.folder-name') ||
                                node.querySelector('.checklist-text') ||
                                node.querySelector('.task-list-item')))) {
                            hasNewNotes = true;
                        }
                    }
                });
            });

            if (hasNewNotes) {
                // Apply font size to newly added notes, folders, and task lists
                applyStoredFontSize();
            }
        });

        // Start observing
        observer.observe(notesContainer, {
            childList: true,
            subtree: true
        });
    }
});

// Fallback initialization - sometimes DOMContentLoaded might have already fired
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(function () {
        initFontSizeSettings();
        applyStoredFontSize();
    }, 500);
}

// Add event to apply font size when a note is loaded
document.addEventListener('noteLoaded', function () {
    applyStoredFontSize();
});

// Apply sizes saved elsewhere to a page that is already laid out
function applyFontSizeChangedElsewhere() {
    applyStoredFontSize();

    const markdownEditors = window.PoznoteMarkdownCodeMirror;
    if (markdownEditors) {
        document.querySelectorAll('.markdown-codemirror-host').forEach(function (host) {
            markdownEditors.remeasureLines(host);
        });
    }
}

// js/display-profiles.js applies a profile on a page already laid out
window.poznoteApplyStoredFontSizes = applyFontSizeChangedElsewhere;

// The sizes are saved from the Settings page, usually open in another tab...
window.addEventListener('storage', function (event) {
    if (event.key === null || /_font_size(::|$)/.test(event.key)) {
        applyFontSizeChangedElsewhere();
    }
});
// ...or while this page sat in the back/forward cache, which gets no storage
// events.
window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
        applyFontSizeChangedElsewhere();
    }
});

// Apply font size after note is initialized
function reinitializeFontSize() {
    applyStoredFontSize();
}

// Add to reinitializeNoteContent if it exists
if (typeof window.reinitializeNoteContent === 'function') {
    const originalReinitializeNoteContent = window.reinitializeNoteContent;
    window.reinitializeNoteContent = function () {
        originalReinitializeNoteContent();
        reinitializeFontSize();
    };
}
