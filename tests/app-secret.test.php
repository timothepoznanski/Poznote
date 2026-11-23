<?php
/**
 * POZNOTE_APP_SECRET is on its way out (lib/app-secret.php): while an instance
 * still sets it, the key comes from it exactly as before, and its value is
 * copied into data/.app_secret so that removing it later changes nothing.
 */

require_once __DIR__ . '/../src/lib/app-secret.php';

function appSecretTestFile(?string $contents): string {
    $path = sys_get_temp_dir() . '/pz-app-secret-' . bin2hex(random_bytes(4));
    if ($contents !== null) {
        file_put_contents($path, $contents);
    }
    return $path;
}

function appSecretTestEnv(?string $value): void {
    if ($value === null) {
        unset($_ENV['POZNOTE_APP_SECRET']);
        putenv('POZNOTE_APP_SECRET');
    } else {
        $_ENV['POZNOTE_APP_SECRET'] = $value;
    }
}

test('without the variable, the file is left alone and nothing is returned', function () {
    appSecretTestEnv(null);
    $path = appSecretTestFile("file-secret\n");
    assertSame(null, poznoteLegacyAppSecret($path));
    assertSame("file-secret\n", file_get_contents($path));
    unlink($path);
});

test('a variable that differs from the file wins, as it always did, and the file follows', function () {
    appSecretTestEnv('env-secret');
    $path = appSecretTestFile("file-secret\n");
    assertSame('env-secret', poznoteLegacyAppSecret($path), 'the key still comes from the variable');
    assertSame('env-secret', file_get_contents($path), 'so that removing the variable keeps the same key');
    assertSame("file-secret\n", file_get_contents($path . '.replaced'), 'the key it replaces is kept');
    assertSame('600', decoct(fileperms($path . '.replaced') & 0777));
    appSecretTestEnv(null);
    unlink($path);
    unlink($path . '.replaced');
});

test('a kept key is not overwritten by a second replacement', function () {
    $path = appSecretTestFile('first');
    appSecretTestEnv('second');
    poznoteLegacyAppSecret($path);
    appSecretTestEnv('third');
    poznoteLegacyAppSecret($path);
    assertSame('third', file_get_contents($path));
    assertSame('first', file_get_contents($path . '.replaced'));
    appSecretTestEnv(null);
    unlink($path);
    unlink($path . '.replaced');
});

test('a variable equal to the file does not rewrite it', function () {
    appSecretTestEnv('same-secret');
    $path = appSecretTestFile("same-secret\n");
    assertSame('same-secret', poznoteLegacyAppSecret($path));
    assertSame("same-secret\n", file_get_contents($path));
    assertFalse(file_exists($path . '.replaced'));
    appSecretTestEnv(null);
    unlink($path);
});

test('a variable and no file writes the file, private', function () {
    appSecretTestEnv('env-secret');
    $path = appSecretTestFile(null);
    assertSame('env-secret', poznoteLegacyAppSecret($path));
    assertSame('env-secret', file_get_contents($path));
    assertSame('600', decoct(fileperms($path) & 0777));
    assertFalse(file_exists($path . '.replaced'));
    appSecretTestEnv(null);
    unlink($path);
});

test('a file that cannot be written does not change the key', function () {
    appSecretTestEnv('env-secret');
    // A path under a regular file: neither the folder nor the file can exist.
    $blocker = appSecretTestFile('not a folder');
    assertSame('env-secret', poznoteLegacyAppSecret($blocker . '/.app_secret'));
    assertSame('not a folder', file_get_contents($blocker));
    appSecretTestEnv(null);
    unlink($blocker);
});

test('a value with spaces around it stays in the variable, the file is not touched', function () {
    appSecretTestEnv(' spaced ');
    $path = appSecretTestFile('file-secret');
    assertSame(' spaced ', poznoteLegacyAppSecret($path), 'hashed raw, as the old code did');
    assertSame('file-secret', file_get_contents($path));
    appSecretTestEnv(null);
    unlink($path);
});

test('an empty variable counts as unset', function () {
    appSecretTestEnv('');
    $path = appSecretTestFile('file-secret');
    assertSame(null, poznoteLegacyAppSecret($path));
    assertSame('file-secret', file_get_contents($path));
    appSecretTestEnv(null);
    unlink($path);
});
