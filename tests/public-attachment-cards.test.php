<?php
require_once dirname(__DIR__) . '/src/markdown_parser.php';
require_once dirname(__DIR__) . '/src/public_helpers.php';

// A public share follows the owner's "Attachment links as cards" setting, as
// the app does in the browser (js/markdown-parser.js, js/attachments.js): on,
// a link to an attachment alone on its line is drawn as a card; off, a written
// card is drawn as a plain link. Without the option nothing changes.

$md = "[Rapport \\[v2\\].pptx](/api/v1/notes/5/attachments/abc123)\n\n"
    . "Une phrase [x.pdf](/api/v1/notes/5/attachments/def) au milieu.\n\n"
    . "<a class=\"attachment-card attachment-card-pdf\" href=\"/api/v1/notes/5/attachments/ghi\">écrit.pdf</a>\n\n"
    . "```\n[c.pdf](/api/v1/notes/5/attachments/zzz)\n```\n";

test('markdown: no option leaves links and cards as written', function () use ($md) {
    $html = parseMarkdown($md);
    assertContains('<a href="/api/v1/notes/5/attachments/abc123" target="_blank" rel="noopener">Rapport [v2].pptx</a>', $html);
    assertContains('<a class="attachment-card attachment-card-pdf" href="/api/v1/notes/5/attachments/ghi">écrit.pdf</a>', $html);
});

test('markdown: setting on draws a lone attachment link as a card', function () use ($md) {
    $html = parseMarkdown($md, ['attachment_cards' => true]);
    assertContains('<div class="attachment-card-line"><a class="attachment-card attachment-card-slides" href="/api/v1/notes/5/attachments/abc123">Rapport [v2].pptx</a></div>', $html);
    assertContains('Une phrase <a href="/api/v1/notes/5/attachments/def" target="_blank" rel="noopener">x.pdf</a> au milieu.', $html);
    assertContains('[c.pdf](/api/v1/notes/5/attachments/zzz)</code>', $html);
});

test('markdown: setting off draws a written card as a link', function () use ($md) {
    $html = parseMarkdown($md, ['attachment_cards' => false]);
    assertContains('<p class="attachment-card-line-off"><a href="/api/v1/notes/5/attachments/ghi" target="_blank" rel="noopener">écrit.pdf</a></p>', $html);
    assertSame(false, str_contains($html, 'class="attachment-card '), 'no card left');
});

$rich = '<div><a href="/api/v1/notes/5/attachments/a1?token=t">doc.xlsx</a><br></div>'
    . '<p>Dans <a href="/api/v1/notes/5/attachments/a2?token=t">x.pdf</a> phrase</p>'
    . '<div><a class="attachment-card attachment-card-pdf" href="/api/v1/notes/5/attachments/a3?token=t" contenteditable="false">c.pdf</a></div>'
    . '<p><a href="https://example.com/api/v1/notes/5/attachments/a4">ext</a></p>';

test('rich text: setting on turns a lone attachment link into a card', function () use ($rich) {
    $html = sanitizePublicNoteHtml($rich, 'en', true);
    assertContains('<a href="/api/v1/notes/5/attachments/a1?token=t" class="attachment-card attachment-card-sheet">doc.xlsx</a>', $html);
    assertContains('Dans <a href="/api/v1/notes/5/attachments/a2?token=t">x.pdf</a> phrase', $html);
    assertContains('<a href="https://example.com/api/v1/notes/5/attachments/a4">ext</a>', $html);
});

test('rich text: setting off shows a written card as a link', function () use ($rich) {
    $html = sanitizePublicNoteHtml($rich, 'en', false);
    assertContains('<div><a href="/api/v1/notes/5/attachments/a3?token=t">c.pdf</a></div>', $html);
});

test('rich text: no option leaves the note as written', function () use ($rich) {
    $html = sanitizePublicNoteHtml($rich, 'en');
    assertContains('<a href="/api/v1/notes/5/attachments/a1?token=t">doc.xlsx</a>', $html);
    assertContains('class="attachment-card attachment-card-pdf"', $html);
});
