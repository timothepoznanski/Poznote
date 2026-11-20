<?php
/**
 * Short lifetime for sessions that never signed in.
 *
 * PHP sweeps session files with one lifetime for all of them, and Poznote sets
 * it to the session lifetime (7 days by default) so that a signed-in browser
 * stays signed in. Every request that arrives without a cookie also gets a
 * session, though: bots and crawlers on the login page, a visitor who typed a
 * share password, a login that was started and abandoned. Under the long
 * lifetime those files piled up by the hundred thousand on an instance polled
 * every few seconds, and the startup permission pass walked through all of
 * them.
 *
 * A session that is not signed in is deleted once it has been idle for
 * POZNOTE_ANONYMOUS_SESSION_IDLE_SECONDS, the 24 minutes PHP applied to every
 * session before the lifetime was raised. Signed-in sessions are left to PHP.
 */

require_once __DIR__ . '/session.php';
require_once __DIR__ . '/session-store.php';

const POZNOTE_ANONYMOUS_SESSION_IDLE_SECONDS = 1440;

/** Larger files are not read: no anonymous session comes close. */
const POZNOTE_SESSION_SWEEP_MAX_BYTES = 1048576;

/**
 * True when a session file's contents can be thrown away: empty, or fully
 * decoded and not signed in. A file the decoder cannot read to the end is
 * kept, since what it holds past that point is unknown.
 */
function poznoteSessionFileIsAnonymous(string $raw): bool {
    if ($raw === '') {
        return true;
    }
    $data = poznoteDecodeSessionFile($raw, ['authenticated'], $complete);
    return $complete && empty($data['authenticated']);
}

/**
 * Delete the session files of $directory that are not signed in and have been
 * idle longer than $maxIdleSeconds.
 *
 * A file is only deleted under its own lock, the one PHP holds for the whole
 * request that opened the session, so a session in use right now is skipped,
 * and its idle time is checked again once the lock is held.
 *
 * @return array{scanned: int, deleted: int}
 */
function poznoteSweepIdleAnonymousSessions(
    string $directory,
    ?int $now = null,
    int $maxIdleSeconds = POZNOTE_ANONYMOUS_SESSION_IDLE_SECONDS
): array {
    $result = ['scanned' => 0, 'deleted' => 0];
    $handle = @opendir($directory);
    if ($handle === false) {
        return $result;
    }
    $cutoff = ($now ?? time()) - $maxIdleSeconds;

    while (($entry = readdir($handle)) !== false) {
        if (strncmp($entry, 'sess_', 5) !== 0) {
            continue;
        }
        $path = $directory . '/' . $entry;
        $modified = @filemtime($path);
        if ($modified === false || $modified > $cutoff || !is_file($path)) {
            continue;
        }
        $result['scanned']++;
        if (@filesize($path) > POZNOTE_SESSION_SWEEP_MAX_BYTES) {
            continue;
        }

        $file = @fopen($path, 'rb');
        if ($file === false) {
            continue;
        }
        if (!flock($file, LOCK_EX | LOCK_NB)) {
            fclose($file);
            continue;
        }
        clearstatcache(true, $path);
        $modified = @filemtime($path);
        $raw = stream_get_contents($file);
        if ($modified !== false && $modified <= $cutoff && is_string($raw)
            && poznoteSessionFileIsAnonymous($raw) && @unlink($path)) {
            $result['deleted']++;
        }
        flock($file, LOCK_UN);
        fclose($file);
    }
    closedir($handle);

    return $result;
}
