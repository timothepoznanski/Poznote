<?php
/**
 * The instance secret: the key that encrypts Git tokens, personal AI keys and
 * recoverable share passwords at rest, and signs workspace activity links.
 * It lives in data/.app_secret, created on first use.
 */

require_once __DIR__ . '/env.php';

function poznoteAppSecretFile(): string {
    return dirname(__DIR__) . '/data/.app_secret';
}

/**
 * Transition, to remove in 7.0. POZNOTE_APP_SECRET was offered in
 * .env.template from 2026-03-20 to 6.0.0 and used to win over the file. An
 * instance that still sets it may have encrypted data with it while the file
 * holds another key (the variable filled in after the file was generated).
 *
 * While the variable is set, the key is derived from it exactly as it always
 * was, so an update changes nothing, whatever happens to the file. Its value
 * is also copied into the file (the file it replaces is kept next to it as
 * .app_secret.replaced), so that removing the variable afterwards changes
 * nothing either. Returns null when the variable is not set.
 */
function poznoteLegacyAppSecret(string $keyFile): ?string {
    $legacy = poznoteEnvRaw('POZNOTE_APP_SECRET');
    if (!$legacy) {
        return null;
    }

    // The file is read trimmed: a value with spaces around it cannot be
    // stored there and give the same key, so that one stays in the variable.
    if ($legacy !== trim($legacy)) {
        return $legacy;
    }

    $current = file_exists($keyFile) ? trim((string)@file_get_contents($keyFile)) : null;
    if ($current !== $legacy) {
        $replaced = $keyFile . '.replaced';
        if ($current !== null && !file_exists($replaced) && @copy($keyFile, $replaced)) {
            @chmod($replaced, 0600);
        }
        if (poznoteWriteAppSecretFile($keyFile, $legacy)) {
            error_log('[poznote] POZNOTE_APP_SECRET copied to data/.app_secret; it can be removed from your .env.');
        }
    }

    return $legacy;
}

function poznoteWriteAppSecretFile(string $keyFile, string $secret): bool {
    $dir = dirname($keyFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    if (@file_put_contents($keyFile, $secret) === false) {
        return false;
    }
    @chmod($keyFile, 0600);
    return true;
}

/**
 * 32-byte key derived from data/.app_secret, created if it is missing.
 *
 * Read on every call, as the three functions this replaces did: the workers
 * are long-lived processes, and a key kept in memory would outlive a file
 * another process wrote in the meantime.
 */
function poznoteAppSecretKey(): string {
    $keyFile = poznoteAppSecretFile();
    $legacy = poznoteLegacyAppSecret($keyFile);
    if ($legacy !== null) {
        return hash('sha256', $legacy, true);
    }

    // An existing file is used as it is, even empty: replacing it would make
    // everything encrypted with it unreadable.
    if (file_exists($keyFile)) {
        $secret = trim((string)file_get_contents($keyFile));
    } else {
        $secret = bin2hex(random_bytes(32));
        poznoteWriteAppSecretFile($keyFile, $secret);
    }

    return hash('sha256', $secret, true);
}
