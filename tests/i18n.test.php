<?php
lib('i18n');

// This file exists because of a bug I shipped: rewriting a path dropped a
// trailing slash, loadI18nDictionary() started reading a file that does not
// exist, and every page kept answering HTTP 200 with no translations at all.
// A status-code sweep cannot see that. A count can.

test('every shipped language loads a non-empty dictionary', function () {
    foreach (poznoteSupportedLanguages() as $lang) {
        $dict = loadI18nDictionary($lang);
        if (count($dict) < 20) {
            fail("dictionary for '{$lang}' has " . count($dict) . ' entries, expected a real one');
        }
    }
});

test('an unknown language yields an empty dictionary rather than an error', function () {
    assertSame([], loadI18nDictionary('klingon'));
});

test('language codes are normalised, and unknown ones refused', function () {
    assertSame('fr', poznoteNormalizeLanguageCode('FR'));
    assertSame('zh-cn', poznoteNormalizeLanguageCode('zh-cn'));
    assertSame(null, poznoteNormalizeLanguageCode('klingon'));
});

/** The heading anchors GitHub gives a Markdown file (code blocks skipped). */
function i18nTestReadmeAnchors(string $markdownFile): array
{
    $anchors = [];
    $inFence = false;
    foreach (file($markdownFile, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (strncmp($line, '```', 3) === 0) {
            $inFence = !$inFence;
            continue;
        }
        if ($inFence || !preg_match('/^#{1,6}\s+(.+?)\s*$/u', $line, $m)) {
            continue;
        }
        $slug = mb_strtolower($m[1], 'UTF-8');
        $slug = (string)preg_replace('/[^\p{L}\p{M}\p{N}\s_-]/u', '', $slug);
        $anchors[(string)preg_replace('/\s/u', '-', $slug)] = true;
    }
    return $anchors;
}

// A link from the interface to a README section: the translated README of the
// dictionary's own language, and a heading that exists there. Retranslating a
// heading changes its anchor, and the link would silently land at the top.
test('README links in the dictionaries point to their language and to a real heading', function () {
    $root = dirname(__DIR__);
    $files = glob($root . '/src/i18n/*.json') ?: [];
    assertTrue(count($files) >= 10, 'dictionaries found');
    $checked = 0;
    foreach ($files as $file) {
        $lang = basename($file, '.json');
        preg_match_all('~https://github\.com/timothepoznanski/poznote(?:/blob/main/docs/README\.([a-z-]+)\.md)?#([^"\'\\\\\s]+)~u',
            (string)file_get_contents($file), $links, PREG_SET_ORDER);
        foreach ($links as $link) {
            $target = $link[1] === '' ? 'en' : $link[1];
            $readme = $target === 'en' ? $root . '/README.md' : $root . '/docs/README.' . $target . '.md';
            assertTrue($target === 'en' || $target === $lang, "$lang.json links to the $target README");
            assertTrue(is_file($readme), "$lang.json: $readme exists");
            assertTrue(isset(i18nTestReadmeAnchors($readme)[rawurldecode($link[2])]), "$lang.json: #{$link[2]} is a heading of " . basename($readme));
            $checked++;
        }
    }
    assertTrue($checked >= 1, 'README links found');
});
