<?php
/**
 * Read a setting from the environment, or from a file named by <KEY>_FILE.
 *
 * The same convention as the postgres and mariadb images (discussion #1815):
 * with POZNOTE_OIDC_CLIENT_SECRET_FILE=/run/secrets/oidc_client_secret, the
 * secret is read from that file, so `docker inspect` shows a path and not the
 * secret. Every key read through _env() gets the _FILE form.
 */

/**
 * The raw value of a variable: .env (loaded into $_ENV by config.php) first,
 * then the process environment. Null when it is not set at all.
 */
function poznoteEnvRaw(string $key): ?string {
    $val = $_ENV[$key] ?? null;
    if ($val !== null) {
        return (string)$val;
    }
    $val = getenv($key);
    return $val === false ? null : (string)$val;
}

/**
 * Read the file a <KEY>_FILE variable names, or null when it names none.
 *
 * A blank KEY counts as unset next to a file (docker-compose.yml may pass a
 * variable empty when .env does not set it). A value and a file together are
 * refused rather than one of them winning silently, and a file that cannot be
 * read is an error, never an empty secret. Only trailing line breaks are
 * removed (a secrets file usually ends with one), so a password ending with a
 * space keeps it. Read once per request.
 *
 * @throws RuntimeException naming the variable and the path, never the value.
 */
function poznoteEnvFromFile(string $key): ?string {
    static $cache = [];
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }

    $fileKey = $key . '_FILE';
    $path = trim((string)poznoteEnvRaw($fileKey));
    if ($path === '') {
        return $cache[$key] = null;
    }

    if (trim((string)poznoteEnvRaw($key)) !== '') {
        throw new RuntimeException("Both $key and $fileKey are set. Set only one of them.");
    }

    $contents = (is_file($path) && is_readable($path)) ? @file_get_contents($path) : false;
    if ($contents === false) {
        throw new RuntimeException(
            "$fileKey points to $path, which cannot be read. Check the path, and that the file "
            . "is readable inside the container by the user PHP runs as (www-data, uid 82, or uid 1000 with the "
            . "rootless image)."
        );
    }

    return $cache[$key] = rtrim($contents, "\r\n");
}

// getenv() returns false (not null) when a variable is not set. The ??
// operator only checks for null, so getenv('X') ?? 'default' would yield false
// instead of 'default'. This helper fixes that, and reads <KEY>_FILE.
function _env(string $key, $default = '') {
    $fromFile = poznoteEnvFromFile($key);
    if ($fromFile !== null) {
        return $fromFile;
    }
    $val = poznoteEnvRaw($key);
    return $val !== null ? $val : $default;
}
