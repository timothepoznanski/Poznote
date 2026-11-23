<?php
declare(strict_types=1);

// Run by docker/init.sh at startup, as the user PHP-FPM runs as: checks every
// POZNOTE_*_FILE variable (#1815, see lib/env.php) before the web server
// starts. A request that hits a bad one fails with an error written to
// /var/log/php_errors.log inside the container, where nobody looks; here the
// reason lands in `docker compose logs` and the container does not start.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../lib/env.php';

// Names that end in _FILE and are not this container's to check:
// - POZNOTE_SERVICE_TOKEN_FILE is not the _FILE convention, it is the path of
//   the token Poznote shares with the MCP server, a setting older than #1815;
// - the two MCP ones are read by the mcp-server container, where their file is
//   mounted. They reach this one too when they are set in .env (env_file
//   passes the whole file), and PHP never reads them.
// The same list is in docker/init.sh.
const POZNOTE_FILE_NAMES_NOT_CHECKED = [
    'POZNOTE_SERVICE_TOKEN_FILE',
    'POZNOTE_MCP_AUTH_TOKEN_FILE',
    'POZNOTE_MCP_AUTH_CLIENT_SECRET_FILE',
];

$names = array_keys(array_merge(getenv(), $_ENV));
sort($names);

$failed = false;
foreach ($names as $name) {
    if (!preg_match('/^POZNOTE_[A-Z0-9_]+_FILE$/', (string)$name) || in_array($name, POZNOTE_FILE_NAMES_NOT_CHECKED, true)) {
        continue;
    }
    $key = substr((string)$name, 0, -strlen('_FILE'));
    try {
        if (poznoteEnvFromFile($key) !== null) {
            fwrite(STDOUT, "[secret-files] $key read from {$name}" . PHP_EOL);
        }
    } catch (RuntimeException $e) {
        fwrite(STDERR, 'ERROR: ' . $e->getMessage() . PHP_EOL);
        $failed = true;
    }
}

exit($failed ? 1 : 0);
