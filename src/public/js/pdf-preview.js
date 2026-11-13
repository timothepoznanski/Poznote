// First page of a PDF attachment, drawn as an image in its preview tile.
//
// The tiles above a note and the preview of an attachment card
// (js/attachments.js, lib/attachments.php) used to frame the PDF in the
// browser's own viewer, which draws a scrollbar, a dark ground around the
// page and, for a PDF that asks for it, the whole page shrunk between two
// black bands. A preview is a picture of the document, not a reader: the tile
// is a link to the file, and this script puts the first page in it.
//
// pdf.js (js/pdfjs/, vendored, ~1.7 MB with its worker) is imported only when
// a PDF tile comes near the screen. Each file is drawn once per page load,
// at the largest size the preview slider allows, and kept as a blob URL: a
// tile redrawn by a Markdown preview, a CodeMirror widget or a note reload
// gets the same image at once. A PDF pdf.js cannot read keeps the file icon.
(function () {
    'use strict';

    var SELECTOR = '.note-attachment-preview-pdf-page[data-pdf-src]:not([data-pdf-state])';
    // Widest tile the "Preview size" slider gives (lib/attachment-preview-size.php)
    var MAX_TILE_WIDTH = 360;
    var MAX_PARALLEL = 2;

    var assetVersion = (function () {
        try {
            var script = document.currentScript;
            var match = script && script.src && script.src.match(/[?&]v=([^&]+)/);
            return match ? match[1] : '';
        } catch (e) {
            return '';
        }
    })();

    function assetUrl(path) {
        var url = new URL(path, document.baseURI).href;
        return assetVersion ? url + '?v=' + assetVersion : url;
    }

    var pdfjsPromise = null;
    function loadPdfjs() {
        if (!pdfjsPromise) {
            pdfjsPromise = import(assetUrl('js/pdfjs/pdf.min.js')).then(function (lib) {
                lib.GlobalWorkerOptions.workerSrc = assetUrl('js/pdfjs/pdf.worker.min.js');
                return lib;
            }, function (error) {
                pdfjsPromise = null;
                throw error;
            });
        }
        return pdfjsPromise;
    }

    var images = new Map(); // src -> Promise<blob URL>
    var queue = [];
    var running = 0;

    function pump() {
        while (running < MAX_PARALLEL && queue.length) {
            var job = queue.shift();
            running++;
            job().then(done, done);
        }
    }

    function done() {
        running--;
        pump();
    }

    function drawFirstPage(src) {
        return loadPdfjs().then(function (lib) {
            var task = lib.getDocument({
                url: src,
                withCredentials: true,
                // Only what the first page needs, read by range requests
                disableAutoFetch: true,
                disableStream: true,
                isEvalSupported: false
            });
            return task.promise.then(function (pdf) {
                return pdf.getPage(1).then(function (page) {
                    var base = page.getViewport({ scale: 1 });
                    var pixels = MAX_TILE_WIDTH * Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
                    var viewport = page.getViewport({ scale: pixels / base.width });
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.round(viewport.width);
                    canvas.height = Math.round(viewport.height);
                    // pdf.js paints the sheet white before the page
                    return page.render({ canvas: canvas, viewport: viewport }).promise.then(function () {
                        return new Promise(function (resolve, reject) {
                            canvas.toBlob(function (blob) {
                                if (blob) resolve(URL.createObjectURL(blob));
                                else reject(new Error('empty canvas'));
                            }, 'image/png');
                        });
                    });
                });
            }).finally(function () {
                task.destroy();
            });
        });
    }

    function imageFor(src) {
        if (!images.has(src)) {
            images.set(src, new Promise(function (resolve, reject) {
                queue.push(function () {
                    return drawFirstPage(src).then(resolve, reject);
                });
                pump();
            }));
        }
        return images.get(src);
    }

    function show(tile) {
        var src = tile.getAttribute('data-pdf-src');
        tile.setAttribute('data-pdf-state', 'loading');
        imageFor(src).then(function (url) {
            var img = document.createElement('img');
            img.className = 'note-attachment-preview-pdf-image';
            img.alt = '';
            img.decoding = 'async';
            img.src = url;
            tile.textContent = '';
            tile.appendChild(img);
            tile.setAttribute('data-pdf-state', 'ready');
        }, function () {
            tile.setAttribute('data-pdf-state', 'error');
        });
    }

    var visibility = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                visibility.unobserve(entry.target);
                show(entry.target);
            });
        }, { rootMargin: '300px' })
        : null;

    function scan(root) {
        var tiles = (root || document).querySelectorAll(SELECTOR);
        Array.prototype.forEach.call(tiles, function (tile) {
            tile.setAttribute('data-pdf-state', 'waiting');
            if (visibility) visibility.observe(tile);
            else show(tile);
        });
    }

    // Tiles arrive with a note, a redrawn Markdown preview, a CodeMirror
    // widget or a rebuilt attachment row: one observer catches them all
    var scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            scan(document);
        });
    }

    function start() {
        scan(document);
        new MutationObserver(function (mutations) {
            // Typing adds nodes too: only look again when a PDF tile came in
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType === 1 && (node.matches('.note-attachment-preview-pdf-page') || node.querySelector('.note-attachment-preview-pdf-page'))) {
                        schedule();
                        return;
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
