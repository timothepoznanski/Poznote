// JavaScript for attachments list page
// Requires: navigation.js (for getPageWorkspace, goBackToNotes)

let allRows = [];
let filteredRows = [];
let filterText = '';
let selectedFileType = '';
// 'list' (grouped by note) or 'grid' (one tile per attachment), and the size
// of the tiles, kept per browser like the dashboard's view: one button steps
// through small, medium, large, wide, then the list
let viewMode = 'list';
let gridSize = 'medium';
const VIEWS = ['small', 'medium', 'large', 'wide', 'list'];
// Paging counts attachments, in both views (a note whose attachments run over
// two pages shows on both, each with its part). The page size is the
// account setting attachments_list_per_page; 0 shows everything on one page.
let currentPage = 1;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 0];
const VIEW_STORAGE_KEY = 'attachments_list_view';

document.addEventListener('DOMContentLoaded', function () {
    const filterInput = document.getElementById('filterInput');
    const clearFilterBtn = document.getElementById('clearFilterBtn');
    const fileTypeFilter = document.getElementById('fileTypeFilter');
    const backToNotesBtn = document.getElementById('backToNotesBtn');
    const backToHomeBtn = document.getElementById('backToHomeBtn');

    if (backToNotesBtn) {
        backToNotesBtn.addEventListener('click', goBackToNotes);
    }

    if (backToHomeBtn) {
        backToHomeBtn.addEventListener('click', goBackToHome);
    }

    if (filterInput) {
        filterInput.addEventListener('input', function () {
            filterText = this.value.trim().toLowerCase();
            applyFilter();
            if (clearFilterBtn) {
                clearFilterBtn.style.display = filterText ? 'flex' : 'none';
            }
        });

        filterInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                filterInput.value = '';
                filterText = '';
                applyFilter();
                if (clearFilterBtn) {
                    clearFilterBtn.style.display = 'none';
                }
            }
        });
    }

    if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', function () {
            if (filterInput) {
                filterInput.value = '';
                filterText = '';
                applyFilter();
                this.style.display = 'none';
                filterInput.focus();
            }
        });
    }

    if (fileTypeFilter) {
        fileTypeFilter.addEventListener('change', function () {
            selectedFileType = this.value;
            applyFilter();
        });
    }

    const showThumbnailsToggle = document.getElementById('showThumbnailsToggle');
    if (showThumbnailsToggle) {
        const saved = localStorage.getItem('attachments_list_show_thumbnails');
        if (saved !== null) {
            showThumbnailsToggle.checked = saved === 'true';
        }
        showThumbnailsToggle.addEventListener('change', function () {
            localStorage.setItem('attachments_list_show_thumbnails', this.checked);
            renderRows();
        });
    }

    // List or grid: the button shows the view a click leads to
    const viewToggle = document.getElementById('attachmentsViewToggle');
    try {
        let stored = localStorage.getItem(VIEW_STORAGE_KEY);
        // 'grid' was stored before the sizes came
        if (stored === 'grid') stored = 'medium';
        if (VIEWS.indexOf(stored) !== -1 && stored !== 'list') {
            viewMode = 'grid';
            gridSize = stored;
        }
    } catch (e) { /* storage blocked: the list */ }
    syncViewToggle(viewToggle);
    if (viewToggle) {
        viewToggle.addEventListener('click', function () {
            const current = viewMode === 'list' ? 'list' : gridSize;
            const next = VIEWS[(VIEWS.indexOf(current) + 1) % VIEWS.length];
            if (next === 'list') {
                viewMode = 'list';
            } else {
                viewMode = 'grid';
                gridSize = next;
            }
            try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch (e) { /* not kept */ }
            syncViewToggle(viewToggle);
            renderRows();
        });
    }

    // The "Also show images inserted in the notes" checkbox (js/inserted-images-toggle.js)
    document.addEventListener('poznote:inserted-images-changed', function () {
        populateFileTypeFilter(allRows);
        applyFilter();
    });

    initPager();
    loadAttachments();
});

async function loadAttachments() {
    const spinner = document.getElementById('loadingSpinner');
    const container = document.getElementById('attachmentsContainer');
    const emptyMessage = document.getElementById('emptyMessage');
    const workspace = getPageWorkspace();

    try {
        const response = await fetch('/api/v1/notes/with-attachments' + (workspace ? '?workspace=' + encodeURIComponent(workspace) : ''), {
            credentials: 'same-origin'
        });

        if (!response.ok) throw new Error('HTTP error ' + response.status);

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        if (spinner) spinner.style.display = 'none';

        // Get translations from data attributes
        const untitledText = document.body.getAttribute('data-txt-untitled') || 'Untitled';

        // Group: one row per note with all its attachments
        allRows = (data.notes || []).map(note => ({
            noteId: note.id,
            noteName: note.heading || untitledText,
            noteContent: note.entry || '',
            attachments: (note.attachments || []).map(att => ({
                id: att.id,
                filename: att.original_filename || att.filename || '',
                type: att.file_type || att.mime_type || att.type,
                extension: getAttachmentExtension(att)
            }))
        }));

        populateFileTypeFilter(allRows);

        if (allRows.length === 0) {
            if (emptyMessage) emptyMessage.style.display = 'block';
            return;
        }

        applyFilter();
    } catch (error) {
        if (spinner) spinner.style.display = 'none';
        if (container) {
            container.innerHTML = '<div class="error-message"><i class="lucide lucide-alert-triangle"></i> Error: ' + escapeHtml(error.message) + '</div>';
        }
    }
}

function getAttachmentExtension(attachment) {
    const filename = String(attachment.original_filename || attachment.filename || '').trim();
    const lastDotIndex = filename.lastIndexOf('.');

    if (lastDotIndex > -1 && lastDotIndex < filename.length - 1) {
        return filename.slice(lastDotIndex + 1).toLowerCase();
    }

    const mimeType = String(attachment.file_type || attachment.mime_type || attachment.type || '').toLowerCase();
    if (!mimeType.includes('/')) return '';

    const subtype = mimeType.split('/')[1].split(';')[0].trim();
    const mimeExtensionMap = {
        'jpeg': 'jpg',
        'svg+xml': 'svg',
        'x-zip-compressed': 'zip'
    };

    return mimeExtensionMap[subtype] || subtype;
}

function populateFileTypeFilter(rows) {
    const fileTypeFilter = document.getElementById('fileTypeFilter');
    if (!fileTypeFilter) return;

    const extensionSet = new Set();
    rows.forEach(row => {
        getDisplayableAttachments(row).forEach(att => {
            if (att.extension) extensionSet.add(att.extension);
        });
    });
    const extensions = Array.from(extensionSet).sort((a, b) => a.localeCompare(b));

    const allTypesText = document.body.getAttribute('data-txt-all-file-types') || 'All types';
    fileTypeFilter.innerHTML = '<option value="">' + escapeHtml(allTypesText) + '</option>' +
        extensions.map(extension => (
            '<option value="' + escapeHtml(extension) + '">' + escapeHtml(extension.toUpperCase()) + '</option>'
        )).join('');

    if (selectedFileType && !extensions.includes(selectedFileType)) {
        selectedFileType = '';
    }

    fileTypeFilter.value = selectedFileType;
    fileTypeFilter.disabled = extensions.length === 0;
    fileTypeFilter.style.display = extensions.length === 0 ? 'none' : 'block';
}

function getDisplayableAttachments(row) {
    // Images the notes show are attachments too, listed only when the
    // "Inserted images in attachments" setting asks for them
    if (document.body.getAttribute('data-show-inserted-images') === '1') return row.attachments;
    return row.attachments.filter(att => !isEmbeddedImageAttachment(row, att));
}

function isEmbeddedImageAttachment(row, attachment) {
    if (!isImageAttachment(attachment) || !row.noteContent || !attachment.id) return false;

    const attachmentRefPattern = 'attachments\\/' + escapeRegExp(String(attachment.id)) + '(?:[?#][^\\s"\'<>)]*)?(?=$|[\\s"\'<>\\)])';
    const htmlImagePattern = new RegExp('<img\\b[^>]*' + attachmentRefPattern, 'i');
    const markdownImagePattern = new RegExp('!\\[[^\\]]*\\]\\([^)]*' + attachmentRefPattern + '[^)]*\\)', 'i');
    const noteContent = String(row.noteContent);

    return htmlImagePattern.test(noteContent) || markdownImagePattern.test(noteContent);
}

function isImageAttachment(attachment) {
    const mimeType = String(attachment.type || '').toLowerCase();
    if (mimeType.startsWith('image/')) return true;

    const imageExtensions = ['avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpg', 'jpeg', 'png', 'svg', 'webp'];
    return imageExtensions.includes(attachment.extension);
}

function applyFilter() {
    const hasTextFilter = filterText !== '';
    const hasTypeFilter = selectedFileType !== '';

    // A new filter re-slices the list: the old page number points nowhere
    currentPage = 1;
    filteredRows = allRows.filter(row => {
        const displayableAttachments = getDisplayableAttachments(row);
        const matchingTypeAttachments = hasTypeFilter
            ? displayableAttachments.filter(att => att.extension === selectedFileType)
            : displayableAttachments;

        if (matchingTypeAttachments.length === 0) return false;
        if (!hasTextFilter) return true;

        const nameMatch = row.noteName.toLowerCase().includes(filterText);
        const fileMatch = matchingTypeAttachments.some(att => att.filename.toLowerCase().includes(filterText));
        return nameMatch || fileMatch;
    });

    renderRows();

    const statsDiv = document.getElementById('filterStats');
    if (statsDiv) {
        const displayableRowCount = allRows.filter(row => getDisplayableAttachments(row).length > 0).length;
        if ((hasTextFilter || hasTypeFilter) && filteredRows.length < displayableRowCount) {
            statsDiv.textContent = filteredRows.length + ' / ' + displayableRowCount;
            statsDiv.style.display = 'block';
        } else {
            statsDiv.style.display = 'none';
        }
    }
}

function getPageSize() {
    const value = parseInt(document.body.getAttribute('data-per-page'), 10);
    return PAGE_SIZE_OPTIONS.indexOf(value) !== -1 ? value : 50;
}

// The pager under the list, the look and the wording of the one of the user
// management page: Previous / Next, "Page x of y" and the page size, which is
// always there (the way back to a smaller size once "All" is picked)
function renderPager(total, totalPages) {
    const pager = document.getElementById('attachmentsPager');
    if (!pager) return;
    pager.hidden = total === 0;
    const prev = pager.querySelector('[data-pager="prev"]');
    const next = pager.querySelector('[data-pager="next"]');
    const status = pager.querySelector('.attachments-pager-status');
    if (prev) prev.hidden = currentPage <= 1;
    if (next) next.hidden = currentPage >= totalPages;
    if (status) {
        status.textContent = (pager.getAttribute('data-status') || 'Page {{page}} of {{pages}}, {{total}} attachments')
            .replace('{{page}}', currentPage).replace('{{pages}}', totalPages).replace('{{total}}', total);
    }
}

function initPager() {
    const pager = document.getElementById('attachmentsPager');
    if (!pager) return;
    const select = pager.querySelector('select');
    if (select) select.value = String(getPageSize());
    pager.addEventListener('click', function (e) {
        const button = e.target.closest('[data-pager]');
        if (!button) return;
        currentPage += button.getAttribute('data-pager') === 'next' ? 1 : -1;
        renderRows();
        const container = document.getElementById('attachmentsContainer');
        if (container) container.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    if (select) {
        select.addEventListener('change', function () {
            const previous = document.body.getAttribute('data-per-page');
            document.body.setAttribute('data-per-page', select.value);
            currentPage = 1;
            renderRows();
            fetch('/api/v1/settings/attachments_list_per_page', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ value: select.value })
            }).then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
            }).catch(function (error) {
                // A session that may not write the account's settings: the
                // choice holds for this visit only
                console.debug('attachments-list: page size not saved:', error, previous);
            });
        });
    }
}

// The button shows the current view, as the dashboard's does: the grid icon
// and the size letter, or the list icon
function syncViewToggle(button) {
    if (!button) return;
    const isList = viewMode === 'list';
    const sizeLabel = button.getAttribute('data-label-' + gridSize) || gridSize;
    const label = isList
        ? (button.getAttribute('data-label-list') || '')
        : (button.getAttribute('data-label-grid') || '') + ' (' + sizeLabel + ')';
    button.title = label;
    button.setAttribute('aria-label', label);
    const icon = button.querySelector('i');
    if (icon) icon.className = 'lucide ' + (isList ? 'lucide-layout-list' : 'lucide-grid');
    const letter = button.querySelector('.attachments-view-letter');
    if (letter) letter.textContent = isList ? '' : (gridSize === 'wide' ? 'W' : sizeLabel.charAt(0).toUpperCase());
    button.classList.toggle('is-list', isList);
}

// Icon of a file kind in the grid, and its colour: the same kinds as the
// attachment cards of a note (attachmentCardKind() in js/attachments.js,
// css/components/attachment-card.css), which this page does not load
const GRID_KINDS = {
    pdf: ['file-text', ['pdf']],
    doc: ['file-text', ['doc', 'docx', 'odt', 'rtf', 'pages']],
    sheet: ['table', ['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'numbers']],
    slides: ['projector', ['ppt', 'pptx', 'odp', 'key']],
    archive: ['archive', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst']],
    image: ['file-image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'heif', 'avif', 'tif', 'tiff', 'ico']],
    audio: ['music', ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'aac', 'opus', 'wma']],
    video: ['file-video', ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv']],
    code: ['file-code', ['js', 'ts', 'py', 'php', 'html', 'htm', 'css', 'json', 'xml', 'yml', 'yaml', 'toml', 'sh', 'sql', 'java', 'c', 'h', 'cpp', 'go', 'rs', 'rb', 'swift', 'kt']],
    text: ['file-text', ['txt', 'md', 'log', 'ini', 'cfg', 'conf']]
};

function gridKind(attachment) {
    const ext = String(attachment.extension || '').toLowerCase();
    for (const kind in GRID_KINDS) {
        if (GRID_KINDS[kind][1].indexOf(ext) !== -1) return { kind: kind, icon: GRID_KINDS[kind][0] };
    }
    return { kind: 'file', icon: 'file' };
}

function renderRows() {
    const container = document.getElementById('attachmentsContainer');
    const emptyMessage = document.getElementById('emptyMessage');
    const workspace = getPageWorkspace();
    const noResultsText = document.body.getAttribute('data-txt-no-results') || 'No results.';
    const showThumbnailsToggle = document.getElementById('showThumbnailsToggle');
    const showThumbnails = showThumbnailsToggle ? showThumbnailsToggle.checked : true;
    const hasActiveFilters = filterText !== '' || selectedFileType !== '';

    if (!container) return;

    if (filteredRows.length === 0) {
        container.innerHTML = hasActiveFilters
            ? '<div class="empty-message"><p>' + escapeHtml(noResultsText) + '</p></div>'
            : '';
        if (emptyMessage) {
            emptyMessage.style.display = hasActiveFilters ? 'none' : 'block';
        }
        renderPager(0, 1);
        return;
    }

    if (emptyMessage) emptyMessage.style.display = 'none';

    // The attachments each note shows, then the slice of them on this page
    const groups = filteredRows.map(row => {
        // Filter attachments based on visibility settings
        const displayableAttachments = getDisplayableAttachments(row);
        const typeFilteredAttachments = selectedFileType
            ? displayableAttachments.filter(att => att.extension === selectedFileType)
            : displayableAttachments;

        const noteNameMatchesFilter = filterText !== '' && row.noteName.toLowerCase().includes(filterText);
        const attachments = filterText !== '' && !noteNameMatchesFilter
            ? typeFilteredAttachments.filter(att => att.filename.toLowerCase().includes(filterText))
            : typeFilteredAttachments;
        return { row: row, attachments: attachments };
    }).filter(group => group.attachments.length > 0);

    const total = groups.reduce((sum, group) => sum + group.attachments.length, 0);
    const pageSize = getPageSize();
    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const sliceStart = pageSize > 0 ? (currentPage - 1) * pageSize : 0;
    const sliceEnd = pageSize > 0 ? sliceStart + pageSize : total;
    let seen = 0;
    const pageGroups = [];
    groups.forEach(group => {
        const from = Math.max(0, sliceStart - seen);
        const to = Math.min(group.attachments.length, sliceEnd - seen);
        seen += group.attachments.length;
        if (to > from) pageGroups.push({ row: group.row, attachments: group.attachments.slice(from, to) });
    });
    renderPager(total, totalPages);

    const rowsHtmlArray = pageGroups.map(group => {
        const row = group.row;
        const visibleAttachments = group.attachments;

        if (viewMode === 'grid') {
            const noteUrl = `index.php?note=${row.noteId}${workspace ? '&workspace=' + encodeURIComponent(workspace) : ''}`;
            return visibleAttachments.map(att => {
                const isImage = isImageAttachment(att);
                let media;
                if (isImage && showThumbnails) {
                    let fileUrl = `/api/v1/notes/${row.noteId}/attachments/${att.id}`;
                    if (workspace) fileUrl += `?workspace=${encodeURIComponent(workspace)}`;
                    media = `<img data-src="${fileUrl}" alt="" class="lazy-thumb">`;
                } else {
                    const kind = gridKind(att);
                    media = `<i class="lucide lucide-${kind.icon} attachments-grid-icon attachments-grid-icon-${kind.kind}" aria-hidden="true"></i>`;
                }
                return `<div class="attachments-grid-item">
                    <a href="#" class="attachment-file-link attachments-grid-media" data-attachment-id="${att.id}" data-note-id="${row.noteId}" title="${escapeHtml(att.filename)}" tabindex="-1" aria-hidden="true">${media}</a>
                    <a href="#" class="attachment-file-link attachments-grid-name" data-attachment-id="${att.id}" data-note-id="${row.noteId}" title="${escapeHtml(att.filename)}">${escapeHtml(att.filename)}</a>
                    <a href="${noteUrl}" class="attachments-grid-note" title="${escapeHtml(row.noteName)}">${escapeHtml(row.noteName)}</a>
                </div>`;
            }).join('');
        }

        const attachmentsList = visibleAttachments.map(att => {
            const isImage = isImageAttachment(att);
            let preview = '';

            if (isImage && showThumbnails) {
                let fileUrl = `/api/v1/notes/${row.noteId}/attachments/${att.id}`;
                if (workspace) fileUrl += `?workspace=${encodeURIComponent(workspace)}`;
                preview = `<div class="attachment-image-preview"><img data-src="${fileUrl}" alt="" class="lazy-thumb"></div>`;
            }

            return `<div class="attachment-file-item">
                <i class="lucide lucide-paperclip"></i>
                <div class="attachment-file-content">
                    <a href="#" class="attachment-file-link" data-attachment-id="${att.id}" data-note-id="${row.noteId}" title="${escapeHtml(att.filename)}">${escapeHtml(att.filename)}</a>
                    ${preview}
                </div>
            </div>`;
        }).join('');

        return `
            <div class="attachment-row">
                <a href="index.php?note=${row.noteId}${workspace ? '&workspace=' + encodeURIComponent(workspace) : ''}" class="attachment-note-name" title="${escapeHtml(row.noteName)}">
                    ${escapeHtml(row.noteName)}
                </a>
                <div class="attachment-files-list">
                    ${attachmentsList}
                </div>
            </div>
        `;
    }).filter(h => h !== null);

    if (rowsHtmlArray.length === 0) {
        container.innerHTML = '<div class="empty-message"><p>' + escapeHtml(noResultsText) + '</p></div>';
        return;
    }

    container.classList.toggle('is-grid', viewMode === 'grid');
    container.innerHTML = viewMode === 'grid'
        ? '<div class="attachments-grid attachments-grid-' + gridSize + '">' + rowsHtmlArray.join('') + '</div>'
        : rowsHtmlArray.join('');

    initLazyThumbnails(container);

    // Attach click listeners using event delegation (Only once)
    if (!container.dataset.listenerAttached) {
        container.addEventListener('click', handleAttachmentClick);
        container.dataset.listenerAttached = 'true';
    }
}

let thumbObserver = null;

function initLazyThumbnails(container) {
    if (thumbObserver) {
        thumbObserver.disconnect();
        thumbObserver = null;
    }

    const pendingQueue = [];
    let activeCount = 0;
    let scheduledTimer = null;
    const MAX_CONCURRENT = 2;
    const DELAY_MS = 150; // min delay between launching requests

    function scheduleNext() {
        if (scheduledTimer !== null || activeCount >= MAX_CONCURRENT || pendingQueue.length === 0) return;
        scheduledTimer = setTimeout(() => {
            scheduledTimer = null;
            if (activeCount >= MAX_CONCURRENT || pendingQueue.length === 0) return;
            const img = pendingQueue.shift();
            activeCount++;
            img.src = img.dataset.src;
            const done = () => { activeCount--; scheduleNext(); };
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            scheduleNext(); // schedule the next slot if capacity allows
        }, DELAY_MS);
    }

    thumbObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                thumbObserver.unobserve(entry.target);
                pendingQueue.push(entry.target);
                scheduleNext();
            }
        });
    }, { rootMargin: '50px' });

    container.querySelectorAll('img.lazy-thumb').forEach(img => {
        thumbObserver.observe(img);
    });
}

function handleAttachmentClick(e) {
    const link = e.target.closest('.attachment-file-link');
    if (link) {
        e.preventDefault();
        const attachmentId = link.getAttribute('data-attachment-id');
        const noteId = link.getAttribute('data-note-id');
        downloadAttachment(attachmentId, noteId);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function downloadAttachment(attachmentId, noteId) {
    if (!noteId || !attachmentId) {
        console.error('Missing noteId or attachmentId');
        return;
    }
    window.open('/api/v1/notes/' + noteId + '/attachments/' + attachmentId, '_blank');
}
