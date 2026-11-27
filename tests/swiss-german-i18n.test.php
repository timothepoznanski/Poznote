<?php
lib('i18n', 'datetime');

// Swiss Standard German (PR #1755, phelex). de-ch.json only carries the strings
// the Swiss orthography changes; everything else is read from de.json through
// poznoteI18nLanguageChain(). tools/generate-de-ch.py writes the file.

/** The same rules as tools/generate-de-ch.py. */
function swissGermanOrthography(string $text): string {
    $text = str_replace('ß', 'ss', $text);
    $text = (string)preg_replace('/„(.*?)“/su', '«$1»', $text);
    return (string)preg_replace('/‚(.*?)‘/su', '‹$1›', $text);
}

function swissGermanExpectedOverrides(array $german): array {
    $out = [];
    foreach ($german as $key => $value) {
        if (is_array($value)) {
            $sub = swissGermanExpectedOverrides($value);
            if ($sub) {
                $out[$key] = $sub;
            }
        } elseif (is_string($value) && swissGermanOrthography($value) !== $value) {
            $out[$key] = swissGermanOrthography($value);
        }
    }
    return $out;
}

function swissGermanLeaves(array $dictionary, string $prefix = ''): array {
    $leaves = [];
    foreach ($dictionary as $key => $value) {
        $path = $prefix === '' ? (string)$key : $prefix . '.' . $key;
        if (is_array($value)) {
            $leaves += swissGermanLeaves($value, $path);
        } else {
            $leaves[$path] = $value;
        }
    }
    return $leaves;
}

test('de-ch.json is exactly what tools/generate-de-ch.py writes from de.json', function () {
    $expected = swissGermanExpectedOverrides(loadI18nDictionary('de'));
    $actual = loadI18nDictionary('de-ch');
    assertTrue(count($actual) > 0, 'de-ch.json loads');
    if ($actual !== $expected) {
        fail('src/i18n/de-ch.json is out of date: run python3 tools/generate-de-ch.py after changing de.json');
    }
});

test('every German string reaches Swiss users, without eszett or German quotes', function () {
    $checked = 0;
    foreach (swissGermanLeaves(loadI18nDictionary('de')) as $key => $german) {
        $swiss = t($key, [], null, 'de-ch');
        assertSame(swissGermanOrthography($german), $swiss, $key);
        assertFalse(mb_strpos($swiss, 'ß') !== false || mb_strpos($swiss, '„') !== false, $key);
        $checked++;
    }
    assertTrue($checked > 1000, 'German strings checked');
});

test('the browser dictionary of de-ch is German with the Swiss strings laid over it', function () {
    $swiss = swissGermanLeaves(poznoteMergedI18nStrings('de-ch'));
    $german = swissGermanLeaves(poznoteMergedI18nStrings('de'));
    assertSame(array_keys($german), array_keys($swiss));
    foreach ($german as $key => $value) {
        assertSame(is_string($value) ? swissGermanOrthography($value) : $value, $swiss[$key], $key);
    }
    // A key German has not translated yet still falls back to English.
    $untranslated = array_diff_key(swissGermanLeaves(loadI18nDictionary('en')), swissGermanLeaves(loadI18nDictionary('de')));
    foreach (array_slice($untranslated, 0, 5, true) as $key => $english) {
        assertSame($english, t($key, [], null, 'de-ch'), $key);
    }
    assertSame('Deutsch (Schweiz)', t('settings.language.german_swiss', [], null, 'de-ch'));
});

test('Swiss browsers select de-ch, other German browsers keep de', function () {
    $langs = poznoteSupportedLanguages();
    assertSame('de-ch', poznoteNormalizeLanguageCode('DE-CH'));
    assertSame('de-ch', poznoteDetectBrowserLanguage('de-CH,de;q=0.9,en;q=0.8', $langs));
    assertSame('de', poznoteDetectBrowserLanguage('de-DE,de;q=0.9', $langs));
    assertSame('de', poznoteDetectBrowserLanguage('de-AT', $langs));
    assertSame('de', poznoteDetectBrowserLanguage('de', $langs));
    assertSame('fr', poznoteDetectBrowserLanguage('fr-CH,de-CH;q=0.8', $langs));
});

test('Swiss Standard German dates use the German names', function () {
    assertSame(getDateNameLocale('de'), getDateNameLocale('de-ch'));
});
