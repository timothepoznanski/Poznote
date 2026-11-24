<?php
lib('idle-signout');

// Automatic sign-out after inactivity (discussion #1826). The delay comes
// from a text column and a cookie anyone can edit, and a wrong reading signs
// people out: every value that is not a plain number of minutes in range
// must read as "never".

test('an unset, broken or out-of-range delay is never', function () {
    foreach ([null, false, '', '   ', 'soon', '-5', '0', '5.5', '1441', '99999', [], '0x10'] as $raw) {
        assertSame(0, poznoteIdleSignoutMinutes($raw), var_export($raw, true));
    }
});

test('a whole number of minutes in range is kept', function () {
    assertSame(1, poznoteIdleSignoutMinutes('1'));
    assertSame(15, poznoteIdleSignoutMinutes(15));
    assertSame(30, poznoteIdleSignoutMinutes(' 30 '));
    assertSame(1440, poznoteIdleSignoutMinutes('1440'));
});

test('the Settings field takes any whole number from 0 (off) to a day', function () {
    assertSame(1440, POZNOTE_IDLE_SIGNOUT_MAX);
    assertSame(0, poznoteIdleSignoutMinutes('0'), '0 turns it off');
    assertSame(7, poznoteIdleSignoutMinutes('7'));
    assertSame(45, poznoteIdleSignoutMinutes('45'));
});

test('a session is idle past its delay plus the margin, not before', function () {
    $now = 1_000_000;
    $limit = 10 * 60 + POZNOTE_IDLE_SIGNOUT_GRACE_SECONDS;
    $session = ['idle_signout_minutes' => 10, 'last_user_activity' => $now - $limit];
    assertSame(false, poznoteSessionIdleExpired($session, $now), 'exactly at the limit');
    $session['last_user_activity'] = $now - $limit - 1;
    assertSame(true, poznoteSessionIdleExpired($session, $now));
});

test('the browser gets to sign out first: the margin covers a minute between reports', function () {
    assertTrue(POZNOTE_IDLE_SIGNOUT_GRACE_SECONDS > 60);
});

test('no delay, or no recorded activity, never expires', function () {
    $now = 1_000_000;
    assertSame(false, poznoteSessionIdleExpired([], $now));
    assertSame(false, poznoteSessionIdleExpired(['last_user_activity' => 0], $now), 'no delay');
    assertSame(false, poznoteSessionIdleExpired(['idle_signout_minutes' => 0, 'last_user_activity' => 0], $now));
    assertSame(false, poznoteSessionIdleExpired(['idle_signout_minutes' => 5], $now), 'session opened before the feature');
});

test('only a page the person opened counts as activity', function () {
    $nav = ['HTTP_SEC_FETCH_MODE' => 'navigate', 'HTTP_SEC_FETCH_DEST' => 'document', 'REQUEST_METHOD' => 'GET'];
    assertSame(true, poznoteRequestIsUserNavigation($nav));
    assertSame(false, poznoteRequestIsUserNavigation(['HTTP_SEC_FETCH_MODE' => 'cors', 'HTTP_SEC_FETCH_DEST' => 'empty', 'REQUEST_METHOD' => 'GET']), 'a background fetch');
    assertSame(false, poznoteRequestIsUserNavigation(['HTTP_SEC_FETCH_MODE' => 'navigate', 'HTTP_SEC_FETCH_DEST' => 'iframe', 'REQUEST_METHOD' => 'GET']), 'a frame');
    assertSame(false, poznoteRequestIsUserNavigation($nav + ['HTTP_SEC_PURPOSE' => 'prefetch']), 'a prefetch');
    assertSame(false, poznoteRequestIsUserNavigation($nav + ['HTTP_SEC_PURPOSE' => 'prefetch;prerender']), 'a prerender');
    assertSame(false, poznoteRequestIsUserNavigation([]), 'an API client');
});

test('only a stored "1" erases the offline copies, anything else keeps them', function () {
    assertSame(true, poznoteIdleSignoutEraseOffline('1'));
    foreach ([null, '', '0', 'true', 'yes', [], ' 0 '] as $raw) {
        assertSame(false, poznoteIdleSignoutEraseOffline($raw), var_export($raw, true));
    }
});

test('with no session left, the cookie says whether to keep the offline copies', function () {
    $saved = $_COOKIE;
    try {
        unset($_COOKIE[POZNOTE_IDLE_SIGNOUT_COOKIE]);
        assertSame(true, poznoteIdleSignoutKeepsOffline(), 'no cookie: kept, the default');
        $_COOKIE[POZNOTE_IDLE_SIGNOUT_COOKIE] = '15';
        assertSame(true, poznoteIdleSignoutKeepsOffline());
        $_COOKIE[POZNOTE_IDLE_SIGNOUT_COOKIE] = '15e';
        assertSame(false, poznoteIdleSignoutKeepsOffline(), 'the account chose to erase');
        $_COOKIE[POZNOTE_IDLE_SIGNOUT_COOKIE] = 'e';
        assertSame(true, poznoteIdleSignoutKeepsOffline(), 'a broken cookie keeps');
    } finally {
        $_COOKIE = $saved;
    }
});
