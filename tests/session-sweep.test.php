<?php
lib('session-sweep');

// Sessions that never signed in get 24 minutes of idle time; signed-in ones
// keep the session lifetime, left to PHP's own sweep. The rule must never
// delete a signed-in session, including one the decoder cannot read through.

function sweepBlob(array $pairs): string {
    $out = '';
    foreach ($pairs as $key => $value) {
        $out .= $key . '|' . serialize($value);
    }
    return $out;
}

function sweepTempDir(): string {
    $dir = sys_get_temp_dir() . '/poznote_session_sweep_' . bin2hex(random_bytes(6));
    mkdir($dir, 0700, true);
    return $dir;
}

function sweepRemoveDir(string $dir): void {
    foreach (glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $file) {
        if (is_file($file)) {
            unlink($file);
        }
    }
    @rmdir($dir);
}

test('an empty file and a csrf-only session are anonymous', function () {
    assertTrue(poznoteSessionFileIsAnonymous(''));
    assertTrue(poznoteSessionFileIsAnonymous(sweepBlob(['csrf_token' => str_repeat('a', 64)])));
    assertTrue(poznoteSessionFileIsAnonymous(sweepBlob(['post_login_redirect' => 'index.php?note=3'])));
});

test('a signed-in session is never anonymous', function () {
    $raw = sweepBlob(['csrf_token' => 'x', 'authenticated' => true, 'login_user_id' => 4]);
    assertFalse(poznoteSessionFileIsAnonymous($raw));
});

test('a session marked not authenticated is anonymous', function () {
    assertTrue(poznoteSessionFileIsAnonymous(sweepBlob(['authenticated' => false, 'pending_2fa_user' => 4])));
});

test('the key spelled inside a string value does not count as signed in', function () {
    $raw = sweepBlob(['csrf_token' => ';authenticated|b:1;']);
    assertTrue(poznoteSessionFileIsAnonymous($raw));
});

test('a file the decoder cannot read to the end is kept', function () {
    // Truncated after a valid first key: whatever followed is unknown.
    $raw = sweepBlob(['csrf_token' => 'x']) . 'authenticated|b:1';
    assertFalse(poznoteSessionFileIsAnonymous($raw));
    assertFalse(poznoteSessionFileIsAnonymous('not a session file'));
});

test('the sweep deletes idle anonymous files only', function () {
    $dir = sweepTempDir();
    $now = 1_800_000_000;
    $old = $now - POZNOTE_ANONYMOUS_SESSION_IDLE_SECONDS - 60;
    $recent = $now - 60;
    $files = [
        'sess_oldempty' => ['', $old],
        'sess_oldanon' => [sweepBlob(['csrf_token' => 'x']), $old],
        'sess_oldsigned' => [sweepBlob(['authenticated' => true, 'login_user_id' => 1]), $old],
        'sess_recentanon' => [sweepBlob(['csrf_token' => 'y']), $recent],
        'sess_oldbroken' => ['garbage', $old],
        'notasession' => ['', $old],
    ];
    foreach ($files as $name => [$content, $mtime]) {
        file_put_contents($dir . '/' . $name, $content);
        touch($dir . '/' . $name, $mtime);
    }

    $result = poznoteSweepIdleAnonymousSessions($dir, $now);

    assertSame(2, $result['deleted']);
    assertSame(4, $result['scanned']);
    assertFalse(is_file($dir . '/sess_oldempty'));
    assertFalse(is_file($dir . '/sess_oldanon'));
    assertTrue(is_file($dir . '/sess_oldsigned'));
    assertTrue(is_file($dir . '/sess_recentanon'));
    assertTrue(is_file($dir . '/sess_oldbroken'));
    assertTrue(is_file($dir . '/notasession'));
    sweepRemoveDir($dir);
});

test('a session locked by a running request is skipped', function () {
    $dir = sweepTempDir();
    $now = 1_800_000_000;
    $path = $dir . '/sess_busy';
    file_put_contents($path, '');
    touch($path, $now - POZNOTE_ANONYMOUS_SESSION_IDLE_SECONDS - 60);
    $lock = fopen($path, 'rb');
    flock($lock, LOCK_EX);

    $result = poznoteSweepIdleAnonymousSessions($dir, $now);

    assertSame(0, $result['deleted']);
    assertTrue(is_file($path));
    flock($lock, LOCK_UN);
    fclose($lock);
    sweepRemoveDir($dir);
});

test('a missing directory is not an error', function () {
    $result = poznoteSweepIdleAnonymousSessions(sys_get_temp_dir() . '/poznote_absent_' . bin2hex(random_bytes(6)));
    assertSame(['scanned' => 0, 'deleted' => 0], $result);
});
