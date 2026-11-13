<?php
lib('i18n', 'datetime');

function swissGermanI18nLeaves(array $dictionary, string $prefix = ''): array {
    $leaves = [];
    foreach ($dictionary as $key => $value) {
        $path = $prefix === '' ? $key : $prefix . '.' . $key;
        if (is_array($value)) {
            $leaves += swissGermanI18nLeaves($value, $path);
        } else {
            $leaves[$path] = $value;
        }
    }
    return $leaves;
}

// Missing keys fall back to English at runtime; only stale keys fail.
test('Swiss Standard German has no key unknown to English and preserves placeholders and HTML', function () {
    $english = swissGermanI18nLeaves(loadI18nDictionary('en'));
    $swiss = swissGermanI18nLeaves(loadI18nDictionary('de-ch'));
    assertSame([], array_values(array_diff(array_keys($swiss), array_keys($english))), 'keys unknown to English');
    foreach ($swiss as $key => $translated) {
        $source = $english[$key];
        assertTrue(is_string($translated) && trim($translated) !== '', $key);
        // Tag names, not attributes: a link may point to the German README.
        foreach (['/\{\{[^}]+\}\}/', '/<\/?[a-z][a-z0-9]*/i', '/<code>.*?<\/code>/s'] as $pattern) {
            preg_match_all($pattern, $source, $original);
            preg_match_all($pattern, $translated, $localized);
            sort($original[0]);
            sort($localized[0]);
            assertSame($original[0], $localized[0], $key);
        }
    }
});

test('Swiss Standard German never uses the eszett', function () {
    foreach (swissGermanI18nLeaves(loadI18nDictionary('de-ch')) as $key => $value) {
        assertFalse(mb_strpos($value, 'ß') !== false, $key . ' contains ß');
    }
});

test('Swiss browsers select de-ch, other German browsers keep de', function () {
    $langs = poznoteSupportedLanguages();
    assertSame('de-ch', poznoteNormalizeLanguageCode('DE-CH'));
    assertSame('de-ch', poznoteDetectBrowserLanguage('de-CH,de;q=0.9,en;q=0.8', $langs));
    assertSame('de', poznoteDetectBrowserLanguage('de-DE,de;q=0.9', $langs));
    assertSame('de', poznoteDetectBrowserLanguage('de-AT', $langs));
    assertSame('de', poznoteDetectBrowserLanguage('de', $langs));
    assertSame('Deutsch (Schweiz)', t('settings.language.german_swiss', [], null, 'de-ch'));
});

test('Swiss Standard German dates reuse the German names', function () {
    assertSame(getDateNameLocale('de'), getDateNameLocale('de-ch'));
});
