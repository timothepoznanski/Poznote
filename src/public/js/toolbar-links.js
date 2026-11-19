// Toolbar: link insertion.

// The Markdown link the caret or the selection of a CodeMirror editor lies
// in: { start, end, text, url } over the source, or null. `offsets` defaults
// to the editor's current selection.
function findMarkdownLinkAround(markdownEditor, offsets) {
  const cmApi = window.PoznoteMarkdownCodeMirror;
  if (!markdownEditor || !cmApi || typeof cmApi.isCodeMirrorEditor !== 'function' || !cmApi.isCodeMirrorEditor(markdownEditor)) return null;
  const cmOffsets = offsets || cmApi.getSelectionOffsets(markdownEditor);
  if (!cmOffsets) return null;
  const source = String(cmApi.getValue(markdownEditor) || '');
  const from = Math.min(cmOffsets.start, cmOffsets.end);
  const to = Math.max(cmOffsets.start, cmOffsets.end);
  const lineStart = source.lastIndexOf('\n', from - 1) + 1;
  let lineEnd = source.indexOf('\n', to);
  if (lineEnd === -1) lineEnd = source.length;
  const line = source.slice(lineStart, lineEnd);
  // (not an image, not an escaped bracket; the text may hold balanced brackets,
  // "[[v2] notes](url)", the address balanced parentheses,
  // "https://en.wikipedia.org/wiki/Foo_(bar)", or be <url>)
  const linkInLine = /(^|[^!\\])\[((?:[^\[\]\\\n]|\\.|\[(?:[^\[\]\\\n]|\\.)*\](?!\())*)\]\((?:<([^<>\n]*)>|((?:[^\s()]|\([^\s()]*\))+))(?:\s+"[^"]*")?\)/g;
  let found;
  while ((found = linkInLine.exec(line))) {
    const linkStart = lineStart + found.index + found[1].length;
    const linkEnd = lineStart + found.index + found[0].length;
    if (from >= linkStart && to <= linkEnd) {
      // (the text as the note shows it: without the backslashes in front
      // of its brackets and of what rich text typed as plain characters)
      return { start: linkStart, end: linkEnd, text: found[2].replace(/\\([!-\/:-@\[-`{-~])/g, '$1'), url: found[3] !== undefined ? found[3] : found[4] };
    }
  }
  return null;
}
window.findMarkdownLinkAround = findMarkdownLinkAround;

// Link insertion functionality
function addLinkToNote() {
  try {
    // Check if we're in markdown mode
    const inMarkdown = typeof isInMarkdownEditor === 'function' && isInMarkdownEditor();

    const sel = window.getSelection();
    const activeRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    const hasSelection = activeRange && !activeRange.collapsed;
    let selectedText = hasSelection ? getNormalizedRangeText(activeRange) : '';

    // For markdown, handle differently
    if (inMarkdown) {
      const markdownEditor = getMarkdownEditorFromRange(activeRange);
      let markdownOffsets = markdownEditor && activeRange
        ? getRangeOffsetsWithinEditor(markdownEditor, activeRange)
        : null;

      // Check if selection looks like a markdown link
      const linkPattern = /\[((?!\])[^\[\]]*(?:\[[^\[\]]*\](?!\()[^\[\]]*)*)\]\(<?((?:[^\s()]|\([^\s()]*\))+)>?\)/;
      const match = selectedText.match(linkPattern);
      
      let existingUrl = 'https://';
      let existingText = selectedText;
      
      if (match) {
        existingText = match[1];
        existingUrl = match[2];
      }

      // The caret or the selection inside a link: that link is the one to
      // edit or remove. Where its syntax is not shown (the live views) the
      // selection is never "[text](url)" itself, only some of its text, and
      // a link written there would have ended up inside the first one.
      const linkAround = match ? null : findMarkdownLinkAround(markdownEditor);
      if (linkAround) {
        existingText = linkAround.text;
        existingUrl = linkAround.url;
        markdownOffsets = { start: linkAround.start, end: linkAround.end };
      }

      // Save range for markdown mode too
      window.savedRanges.link = activeRange ? activeRange.cloneRange() : null;

      showLinkModal(existingUrl, existingText, function (url, text) {
        if (url === null) {
          // Remove link - replace with just text
          if (markdownEditor && markdownOffsets) {
            replaceMarkdownRangeByOffsets(markdownEditor, markdownOffsets.start, markdownOffsets.end, existingText);
          } else if (window.savedRanges.link) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(window.savedRanges.link);
            document.execCommand('insertText', false, existingText);
          }
          window.savedRanges.link = null;
          return;
        }

        if (!url) {
          window.savedRanges.link = null;
          return;
        }

        if (markdownEditor) {
          try { markdownEditor.focus({ preventScroll: true }); } catch (e) { markdownEditor.focus(); }
        }

        const linkMarkdown = buildSafeMarkdownLink(text || existingText || url || 'link', url);
        if (!linkMarkdown) {
          if (typeof showNotificationPopup === 'function') {
            showNotificationPopup((window.t || function (key, params, fallback) { return fallback; })('slash_menu.invalid_url', null, 'Invalid URL'), 'error');
          }
          window.savedRanges.link = null;
          return;
        }

        // Apply markdown link syntax
        if (markdownEditor && markdownOffsets) {
          replaceMarkdownRangeByOffsets(markdownEditor, markdownOffsets.start, markdownOffsets.end, linkMarkdown);
        } else if (typeof applyMarkdownLink === 'function') {
          applyMarkdownLink(url, text);
        }

        window.savedRanges.link = null;
      });
      return;
    }

    // HTML mode - original logic
    // Check if the selection is within an existing link
    let existingLink = null;
    let existingUrl = 'https://';

    if (hasSelection && activeRange) {
      const range = activeRange;
      const container = range.commonAncestorContainer;

      // Check if the selection is inside a link element
      if (container.nodeType === Node.TEXT_NODE) {
        existingLink = container.parentElement.closest('a');
      } else if (container.nodeType === Node.ELEMENT_NODE) {
        existingLink = container.closest('a');
      }

      // If we found an existing link, get its URL
      if (existingLink && existingLink.href) {
        existingUrl = existingLink.href;
      }
    }

    // Save the current selection before opening modal to preserve it
    if (hasSelection) {
      window.savedRanges.link = sel.getRangeAt(0).cloneRange();
      window.savedExistingLink = existingLink;
    } else {
      window.savedRanges.link = null;
      window.savedExistingLink = null;
    }

    showLinkModal(existingUrl, selectedText, function (url, text) {
      // If url is null, it means we want to remove the link
      if (url === null) {
        if (window.savedExistingLink) {
          // Remove the link but keep the text content
          const linkText = window.savedExistingLink.textContent;
          const textNode = document.createTextNode(linkText);
          window.savedExistingLink.parentNode.replaceChild(textNode, window.savedExistingLink);

          // Save the note automatically
          const noteentry = document.querySelector('.noteentry');
          if (noteentry && typeof window.saveNoteImmediately === 'function') {
            window.saveNoteImmediately();
          }
        }

        // Clean up
        window.savedRanges.link = null;
        window.savedExistingLink = null;
        return;
      }

      if (!url) return;

      // If we're editing an existing link, just update it
      if (window.savedExistingLink) {
        window.savedExistingLink.href = url;
        if (text) {
          window.savedExistingLink.textContent = text;
        }
      } else {
        // Create a new link element
        const a = document.createElement('a');
        a.href = url;
        a.textContent = text || url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';

        if (window.savedRanges.link) {
          // Restore the saved selection and replace it with the link
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(window.savedRanges.link);

          // Replace the selected text with the link
          window.savedRanges.link.deleteContents();
          window.savedRanges.link.insertNode(a);

          // Clear selection and position cursor after the link
          sel.removeAllRanges();
          const newRange = document.createRange();
          newRange.setStartAfter(a);
          newRange.setEndAfter(a);
          sel.addRange(newRange);
        } else {
          // No saved selection, insert at current cursor position or end of editor
          const sel = window.getSelection();
          if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.insertNode(a);
            // Position cursor after the link
            range.setStartAfter(a);
            range.setEndAfter(a);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            // Fallback: append to editor
            const noteentry = document.querySelector('.noteentry');
            if (noteentry) {
              noteentry.appendChild(a);
            }
          }
        }
      }

      // Save the note automatically
      const noteentry = document.querySelector('.noteentry');
      if (noteentry && typeof window.saveNoteImmediately === 'function') {
        window.saveNoteImmediately();
      }

      // Clean up saved range and existing link reference
      window.savedRanges.link = null;
      window.savedExistingLink = null;
    });
  } catch (err) {
    console.error('Error in addLinkToNote:', err);
  }
}

// Right-click on a link in a note: the "Manage link" dialog for that link,
// in place of the insert menu (js/slash-command.js calls this before opening
// its menu). Returns true when the dialog opened, false to leave the event to
// the menu that would have had it.
//
// Not for: a link that is not the note's editable text (attachment card,
// widget, locked or read-only note, task list, Markdown preview), a link in
// a rich text table cell (the table menu takes the cell, in capture), and a
// selection that reaches beyond the link (the selection's formatting menu).
function openLinkModalFromContextMenu(event) {
  const target = event && event.target;
  if (!target || !target.closest) return false;

  const cmApi = window.PoznoteMarkdownCodeMirror;
  const markdownEditor = target.closest('.markdown-editor');
  if (markdownEditor && cmApi && typeof cmApi.isCodeMirrorEditor === 'function' && cmApi.isCodeMirrorEditor(markdownEditor)) {
    return openMarkdownLinkModalAtPoint(markdownEditor, target, event.clientX, event.clientY);
  }

  const anchor = target.closest('a[href]');
  if (!anchor) return false;
  return openHtmlLinkModal(anchor);
}
window.openLinkModalFromContextMenu = openLinkModalFromContextMenu;

function openMarkdownLinkModalAtPoint(markdownEditor, target, x, y) {
  const cmApi = window.PoznoteMarkdownCodeMirror;
  if (typeof cmApi.getPosAtCoords !== 'function') return false;
  if (markdownEditor.classList.contains('markdown-editor-readonly')) return false;
  const notecard = markdownEditor.closest('.notecard');
  if (notecard && notecard.getAttribute('data-note-locked') === '1') return false;
  // The text of a line only: a widget drawn in place of a line (media,
  // attachment card, table, diagram) has its own menu or none. The nearest
  // editing host decides: the editor's content, or a widget's
  // contenteditable="false" (the host around the editor is "false" too)
  const host = target.closest('[contenteditable]');
  if (!target.closest('.cm-line') || !host || host.getAttribute('contenteditable') !== 'true') return false;

  const pos = cmApi.getPosAtCoords(markdownEditor, x, y);
  if (typeof pos !== 'number') return false;
  const link = findMarkdownLinkAround(markdownEditor, { start: pos, end: pos });
  if (!link) return false;

  const selection = cmApi.getSelectionOffsets(markdownEditor);
  if (selection && selection.start !== selection.end) {
    const from = Math.min(selection.start, selection.end);
    const to = Math.max(selection.start, selection.end);
    if (from < link.start || to > link.end) return false;
  }

  const tr = window.t || function (key, params, fallback) { return fallback; };
  showLinkModal(link.url, link.text, function (url, text) {
    if (url === null) {
      replaceMarkdownRangeByOffsets(markdownEditor, link.start, link.end, link.text);
      return;
    }
    if (!url) return;
    const linkMarkdown = buildSafeMarkdownLink(text || link.text || url, url);
    if (!linkMarkdown) {
      if (typeof showNotificationPopup === 'function') showNotificationPopup(tr('slash_menu.invalid_url', null, 'Invalid URL'), 'error');
      return;
    }
    // (the source as it was when the dialog opened: nothing changed it since,
    // or the offsets no longer hold the link and nothing is written)
    const current = findMarkdownLinkAround(markdownEditor, { start: link.start, end: link.start });
    if (!current || current.start !== link.start || current.end !== link.end) return;
    replaceMarkdownRangeByOffsets(markdownEditor, link.start, link.end, linkMarkdown);
  });
  return true;
}

function openHtmlLinkModal(anchor) {
  const noteEntry = anchor.closest('.noteentry');
  if (!noteEntry || noteEntry.getAttribute('contenteditable') !== 'true') return false;
  if (noteEntry.getAttribute('data-note-type') === 'tasklist') return false;
  // The nearest editing host decides: a card or a widget is not text
  const host = anchor.closest('[contenteditable]');
  if (!host || host.getAttribute('contenteditable') !== 'true') return false;
  if (anchor.querySelector('img, video, audio, iframe, figure')) return false;

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    if (!anchor.contains(range.startContainer) || !anchor.contains(range.endContainer)) return false;
  }

  const noteId = String(noteEntry.id || '').replace(/^entry/, '');
  const oldHref = anchor.getAttribute('href') || '';
  const oldText = anchor.textContent;
  const tr = window.t || function (key, params, fallback) { return fallback; };

  const save = function () {
    // (the note may not have had the focus: window.noteid is -1 until then)
    if (noteId) window.noteid = noteId;
    if (typeof window.markNoteAsModified === 'function') window.markNoteAsModified();
    if (typeof window.saveNoteImmediately === 'function') window.saveNoteImmediately();
  };

  showLinkModal(oldHref, oldText, function (url, text) {
    if (!anchor.isConnected) return;
    if (url === null) {
      anchor.parentNode.replaceChild(document.createTextNode(anchor.textContent), anchor);
      save();
      return;
    }
    if (!url) return;
    const trimmed = String(url).trim();
    if (typeof normalizeMarkdownLinkDestination === 'function' && !normalizeMarkdownLinkDestination(trimmed)) {
      if (typeof showNotificationPopup === 'function') showNotificationPopup(tr('slash_menu.invalid_url', null, 'Invalid URL'), 'error');
      return;
    }

    let changed = false;
    if (trimmed !== oldHref) {
      anchor.setAttribute('href', trimmed);
      // A link to a note named its note: another address is another target
      anchor.removeAttribute('data-note-id');
      anchor.removeAttribute('data-note-reference');
      anchor.classList.remove('note-internal-link');
      changed = true;
    }
    // Only a new text replaces the old one: rewriting the same text would
    // flatten the formatting inside the link
    if (text && text !== oldText.trim()) {
      anchor.textContent = text;
      changed = true;
    }
    if (changed) save();
  });
  return true;
}
