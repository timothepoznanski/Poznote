<?php
require_once dirname(__DIR__) . '/src/markdown_parser.php';
require_once dirname(__DIR__) . '/src/html_to_markdown.php';

// An ordered list keeps its first number (#1831): "12. / 13." after a paragraph
// read 1. / 2. The note draws the numbers with a CSS counter, which cannot read
// the start attribute, so the list also carries the matching counter-reset,
// the markup rich-text notes store since #1534. js/markdown-parser.js follows
// the same rule.

test('a list starting at 12 keeps its number', function () {
    $html = parseMarkdown("1. First\n2. Second\n\n... skipping here\n\n12. Twelve\n13. Thirteen");
    assertContains('<ol><li data-line="0">First</li>', $html);
    assertContains('<ol start="12" style="counter-reset: item 11;"><li data-line="5">Twelve</li><li data-line="6">Thirteen</li></ol>', $html);
});

test('a list starting at 1 is unchanged', function () {
    assertSame(false, str_contains(parseMarkdown("1. a\n2. b"), 'start='), 'no start attribute');
});

test('only the first number counts, like CommonMark', function () {
    assertContains('<ol start="3" style="counter-reset: item 2;">', parseMarkdown("3. a\n7. b"));
    assertSame(false, str_contains(parseMarkdown("1. a\n1. b\n1. c"), 'start='), 'repeated 1. stays plain');
});

test('a list starting at 0', function () {
    assertContains('<ol start="0" style="counter-reset: item -1;">', parseMarkdown("0. zero\n1. one"));
});

test('a nested list keeps its own first number', function () {
    assertContains('<ol start="5" style="counter-reset: item 4;"><li data-line="1">sub</li></ol>', parseMarkdown("1. a\n   5. sub\n2. b"));
});

test('a dotted marker reads its last number', function () {
    assertSame(3, markdownOrderedListStart('2.3.'));
    assertSame(null, markdownOrderedListStart('2.1.'));
    assertSame(12, markdownOrderedListStart('12.'));
    assertSame(null, markdownOrderedListStart('1234567.'));
});

test('converting back to Markdown keeps the first number', function () {
    $md = poznoteHtmlToMarkdown('<ol start="12" style="counter-reset: item 11;"><li>Twelve</li><li>Thirteen</li></ol>');
    assertContains("12. Twelve\n13. Thirteen", $md);
});
