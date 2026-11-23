<?php
/**
 * _env() and <KEY>_FILE (#1815): a secret read from a file, so `docker
 * inspect` shows a path and not the value. Each test uses its own key, the
 * file being read once per request.
 */

require_once __DIR__ . '/../src/lib/env.php';

function envFileTestWrite(string $contents): string {
    $path = tempnam(sys_get_temp_dir(), 'pz-env-');
    file_put_contents($path, $contents);
    return $path;
}

function envFileTestSet(string $key, ?string $value): void {
    if ($value === null) {
        unset($_ENV[$key]);
        putenv($key);
        return;
    }
    $_ENV[$key] = $value;
}

test('a variable without _FILE reads as before, default when unset', function () {
    envFileTestSet('PZ_TEST_ENV_PLAIN', 'value');
    assertSame('value', _env('PZ_TEST_ENV_PLAIN', 'default'));
    assertSame('default', _env('PZ_TEST_ENV_UNSET', 'default'));
    envFileTestSet('PZ_TEST_ENV_PLAIN', null);
});

test('_FILE is read, only trailing line breaks removed', function () {
    $path = envFileTestWrite("s3cret \r\n\n");
    envFileTestSet('PZ_TEST_ENV_FILE_FILE', $path);
    assertSame('s3cret ', _env('PZ_TEST_ENV_FILE', 'default'), 'a trailing space is part of the secret');
    envFileTestSet('PZ_TEST_ENV_FILE_FILE', null);
    unlink($path);
});

test('a blank value next to a file is not a conflict', function () {
    $path = envFileTestWrite("from-file\n");
    envFileTestSet('PZ_TEST_ENV_BLANK', '');
    envFileTestSet('PZ_TEST_ENV_BLANK_FILE', $path);
    assertSame('from-file', _env('PZ_TEST_ENV_BLANK'));
    envFileTestSet('PZ_TEST_ENV_BLANK', null);
    envFileTestSet('PZ_TEST_ENV_BLANK_FILE', null);
    unlink($path);
});

test('a blank _FILE leaves the plain variable in charge', function () {
    envFileTestSet('PZ_TEST_ENV_NOFILE', 'value');
    envFileTestSet('PZ_TEST_ENV_NOFILE_FILE', '  ');
    assertSame('value', _env('PZ_TEST_ENV_NOFILE'));
    envFileTestSet('PZ_TEST_ENV_NOFILE', null);
    envFileTestSet('PZ_TEST_ENV_NOFILE_FILE', null);
});

test('a value and a file together are refused', function () {
    $path = envFileTestWrite('from-file');
    envFileTestSet('PZ_TEST_ENV_BOTH', 'value');
    envFileTestSet('PZ_TEST_ENV_BOTH_FILE', $path);
    $message = '';
    try {
        _env('PZ_TEST_ENV_BOTH');
    } catch (RuntimeException $e) {
        $message = $e->getMessage();
    }
    assertContains('Set only one', $message);
    envFileTestSet('PZ_TEST_ENV_BOTH', null);
    envFileTestSet('PZ_TEST_ENV_BOTH_FILE', null);
    unlink($path);
});

test('an unreadable file is an error naming the path, never an empty secret', function () {
    $missing = sys_get_temp_dir() . '/pz-env-missing-' . bin2hex(random_bytes(4));
    envFileTestSet('PZ_TEST_ENV_MISSING_FILE', $missing);
    $message = '';
    try {
        _env('PZ_TEST_ENV_MISSING', 'default');
    } catch (RuntimeException $e) {
        $message = $e->getMessage();
    }
    assertContains('PZ_TEST_ENV_MISSING_FILE', $message);
    assertContains($missing, $message);
    envFileTestSet('PZ_TEST_ENV_MISSING_FILE', null);
});

test('a directory is not a secret file', function () {
    envFileTestSet('PZ_TEST_ENV_DIR_FILE', sys_get_temp_dir());
    $threw = false;
    try {
        _env('PZ_TEST_ENV_DIR');
    } catch (RuntimeException $e) {
        $threw = true;
    }
    assertTrue($threw);
    envFileTestSet('PZ_TEST_ENV_DIR_FILE', null);
});

test('the process environment is read as well as $_ENV', function () {
    $path = envFileTestWrite("from-getenv\n");
    putenv('PZ_TEST_ENV_GETENV_FILE=' . $path);
    assertSame('from-getenv', _env('PZ_TEST_ENV_GETENV'));
    putenv('PZ_TEST_ENV_GETENV_FILE');
    unlink($path);
});
