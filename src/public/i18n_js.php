<?php
/**
 * The browser's translation dictionary as a script, for index.php.
 *
 * js/globals.js used to fetch it from GET /api/v1/system/i18n on
 * DOMContentLoaded, so everything the deferred bundles wrote before the answer
 * came back (placeholders, button titles, panel headings) showed in English
 * first and changed a moment later. Loaded as a deferred script placed before
 * the bundles, it runs before any of them: window.t() answers in the account's
 * language from the first line of application code.
 *
 * The strings are the same for everyone using a language, nothing here is
 * private, so no session is opened. The URL carries a version built from the
 * dictionaries (poznoteI18nScriptUrl()), which makes the response cacheable for
 * good instead of being downloaded again on every page, as the fetch was.
 */

require_once __DIR__ . '/../lib/i18n.php';

$lang = poznoteNormalizeLanguageCode($_GET['lang'] ?? 'en') ?? 'en';
$strings = poznoteMergedI18nStrings($lang);

header('Content-Type: text/javascript; charset=UTF-8');
header('Cache-Control: public, max-age=31536000, immutable');
header('X-Content-Type-Options: nosniff');

$payload = json_encode(
    ['lang' => $lang, 'strings' => $strings, 'preloaded' => true],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP
);
if ($payload === false) {
    // Nothing usable: leave js/globals.js to fetch the dictionary as before
    exit;
}

echo 'window.POZNOTE_I18N = ' . $payload . ";\n";
