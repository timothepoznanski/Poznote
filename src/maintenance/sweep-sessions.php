<?php
declare(strict_types=1);

// Run by docker/init.sh at startup, before the permission pass, and by the
// scheduled backups worker every few minutes: deletes the session files that
// never signed in and have been idle for 24 minutes (see lib/session-sweep.php).

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../lib/session-sweep.php';

$dataDir = $argv[1] ?? getenv('POZNOTE_DATA_DIR');
if (!$dataDir) {
    $dataDir = dirname(__DIR__) . '/data';
}
$sessionsDir = rtrim((string)$dataDir, "/\\") . '/sessions';

if (!is_dir($sessionsDir)) {
    fwrite(STDOUT, '[session-sweep] no sessions directory, nothing to do' . PHP_EOL);
    exit(0);
}

$result = poznoteSweepIdleAnonymousSessions($sessionsDir);
fwrite(STDOUT, '[session-sweep] deleted ' . $result['deleted'] . ' idle anonymous session(s) out of '
    . $result['scanned'] . ' idle file(s)' . PHP_EOL);
