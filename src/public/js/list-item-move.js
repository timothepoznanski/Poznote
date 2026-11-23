/**
 * Ctrl+Shift+ArrowUp / Ctrl+Shift+ArrowDown (Cmd+Shift on a Mac) moves the
 * list item holding the caret one place up or down among its siblings, in
 * an HTML note (discussion #1819): bulleted, numbered and checklist items,
 * the item's nested list going with it. A selection over several items of
 * the same list moves them together. An item never leaves its list: at the
 * top or the bottom nothing happens. Outside a list the keys keep their
 * native meaning (select to the start or the end of the paragraph).
 * Markdown notes have the same keys in the CodeMirror editor
 * (build/markdown-editor/src/list-move.js).
 *
 * The move is made on the DOM, which the browser's own undo history never
 * sees, so it goes through the undo steps of js/slash-command.js
 * (window.poznoteHtmlUndoableStep): Ctrl+Z puts the item back.
 */
(function () {
    'use strict';

    var isMacPlatform = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

    function isMoveKey(e) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
        if (!e.shiftKey || e.altKey || e.isComposing) return false;
        return isMacPlatform ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);
    }

    function isList(node) {
        return !!node && node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL');
    }

    function isItem(node) {
        return !!node && node.nodeType === 1 && node.tagName === 'LI';
    }

    function itemAt(node, noteEntry) {
        var element = node && node.nodeType === 3 ? node.parentElement : node;
        var item = element && element.closest ? element.closest('li') : null;
        if (!item || !noteEntry.contains(item) || !item.isContentEditable) return null;
        return isList(item.parentElement) ? item : null;
    }

    // The item a nested list belongs to: the <li> it sits in, or, for the
    // <ul> that the browser's own indent leaves directly in the parent list,
    // the <li> just before it
    function parentItem(item, noteEntry) {
        var list = item.parentElement;
        var holder = list ? list.parentElement : null;
        if (!holder || !noteEntry.contains(holder)) return null;
        if (isItem(holder)) return holder;
        if (isList(holder)) {
            for (var node = list.previousElementSibling; node; node = node.previousElementSibling) {
                if (isItem(node)) return node;
                if (!isList(node)) return null;
            }
        }
        return null;
    }

    function ancestorItems(item, noteEntry) {
        var chain = [];
        for (var current = item; current; current = parentItem(current, noteEntry)) {
            chain.push(current);
        }
        return chain;
    }

    // An item and the browser-style nested lists that follow it
    function unitEnd(item) {
        var end = item;
        for (var node = item.nextElementSibling; isList(node); node = node.nextElementSibling) {
            end = node;
        }
        return end;
    }

    function unitNodes(item) {
        var end = unitEnd(item);
        var nodes = [];
        for (var node = item; node; node = node.nextSibling) {
            nodes.push(node);
            if (node === end) break;
        }
        return nodes;
    }

    function previousItem(item) {
        for (var node = item.previousElementSibling; node; node = node.previousElementSibling) {
            if (isItem(node)) return node;
            if (!isList(node)) return null;
        }
        return null;
    }

    function nextItem(item) {
        var node = unitEnd(item).nextElementSibling;
        return isItem(node) ? node : null;
    }

    // The first and the last item to move: the caret's item, or for a
    // selection the items at the deepest level holding both of its ends
    function selectedItems(selection, noteEntry) {
        var range = selection.getRangeAt(0);
        var startItem = itemAt(range.startContainer, noteEntry);
        if (!startItem) return null;
        var endItem = range.collapsed ? startItem : itemAt(range.endContainer, noteEntry);
        if (!endItem) return null;

        var endChain = ancestorItems(endItem, noteEntry);
        var startChain = ancestorItems(startItem, noteEntry);
        for (var i = 0; i < startChain.length; i++) {
            for (var j = 0; j < endChain.length; j++) {
                if (startChain[i].parentElement === endChain[j].parentElement) {
                    var first = startChain[i];
                    var last = endChain[j];
                    if (first !== last && (first.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_PRECEDING)) {
                        var swap = first;
                        first = last;
                        last = swap;
                    }
                    return { first: first, last: last };
                }
            }
        }
        return null;
    }

    function moveNodes(nodes, parent, before) {
        nodes.forEach(function (node) {
            parent.insertBefore(node, before);
        });
    }

    function restoreSelection(selection, saved) {
        if (!saved.anchorNode || !saved.anchorNode.isConnected || !saved.focusNode || !saved.focusNode.isConnected) return;
        try {
            selection.setBaseAndExtent(saved.anchorNode, saved.anchorOffset, saved.focusNode, saved.focusOffset);
        } catch (err) {
            // (a boundary that no longer fits its node: the selection stays where the browser put it)
        }
    }

    function moveSelectedItems(noteEntry, down) {
        var selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        var items = selectedItems(selection, noteEntry);
        if (!items) return false;

        // The items are found: from here on the keys are ours, even when the
        // items are already at the top or the bottom of their list
        var list = items.first.parentElement;
        var neighbour = down ? nextItem(items.last) : previousItem(items.first);
        if (!neighbour) return true;

        // The neighbouring item is the one moved, to the other side of the
        // selected items, which keeps the caret's nodes where they are
        var neighbourNodes = unitNodes(neighbour);
        var originalNext = neighbourNodes[neighbourNodes.length - 1].nextSibling;
        var saved = {
            anchorNode: selection.anchorNode,
            anchorOffset: selection.anchorOffset,
            focusNode: selection.focusNode,
            focusOffset: selection.focusOffset
        };

        var apply = function () {
            var before = down ? items.first : unitEnd(items.last).nextSibling;
            moveNodes(neighbourNodes, list, before);
            restoreSelection(selection, saved);
        };
        var revert = function () {
            moveNodes(neighbourNodes, list, originalNext);
            restoreSelection(selection, saved);
        };

        if (typeof window.poznoteHtmlUndoableStep === 'function') {
            window.poznoteHtmlUndoableStep(noteEntry, apply, revert);
        } else {
            apply();
            noteEntry.dispatchEvent(new Event('input', { bubbles: true }));
        }

        var focusElement = saved.focusNode && saved.focusNode.nodeType === 3 ? saved.focusNode.parentElement : saved.focusNode;
        if (focusElement && typeof focusElement.scrollIntoView === 'function') {
            focusElement.scrollIntoView({ block: 'nearest' });
        }
        return true;
    }

    function handleKeydown(e) {
        if (e.defaultPrevented || !isMoveKey(e)) return;
        var target = e.target;
        var noteEntry = target && target.closest ? target.closest('.noteentry') : null;
        if (!noteEntry || noteEntry.getAttribute('contenteditable') !== 'true') return;
        if (target.closest('input, textarea, select, .cm-editor')) return;

        if (moveSelectedItems(noteEntry, e.key === 'ArrowDown')) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    // Registered once every script has run, so the lock guard of
    // js/note-edit-lock.js (capture phase too) sees the keys first
    document.addEventListener('DOMContentLoaded', function () {
        document.addEventListener('keydown', handleKeydown, true);
    });
})();
