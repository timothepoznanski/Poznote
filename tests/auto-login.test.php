<?php
lib('auto-login');

// "Open without login" opens accounts without a password (discussion #1608,
// reworked for several accounts on 2026-11-13). The decisions that carry the
// risk are pinned here: which accounts are ticked (and the single account of
// the first version is never lost on the way), when one is opened with no
// login screen at all, and that only a browser is let in that way.

$profiles = [
    ['id' => 2, 'username' => 'Bob', 'is_admin' => 1],
    ['id' => 7, 'username' => 'alice', 'is_admin' => 0],
    ['id' => 5, 'username' => 'zed', 'is_admin' => 1],
];

test('the ticked accounts are read from the list', function () {
    assertSame([7, 2], poznoteAutoLoginAccountIds('1', '[7,2]', ''));
    assertSame([7, 2], poznoteAutoLoginAccountIds('1', '["7", 2, 7, 0, -3, "x", 1.5]', ''), 'whole positive numbers once, nothing guessed');
    assertSame([], poznoteAutoLoginAccountIds('1', '[]', '5'), 'a saved empty list wins over the first version');
    assertSame([], poznoteAutoLoginAccountIds('1', 'not json', ''));
    assertSame([], poznoteAutoLoginAccountIds('1', '{"a":1}', ''), 'an object is not a list of accounts');
    assertSame([], poznoteAutoLoginAccountIds('1', '7', ''), 'nor is a bare number');
});

test('nothing is ticked while the option is off', function () {
    assertSame([], poznoteAutoLoginAccountIds('0', '[7,2]', ''));
    assertSame([], poznoteAutoLoginAccountIds('', '', '5'));
});

test('an instance that never saved the list keeps the account of the first version', function () {
    assertSame([5], poznoteAutoLoginAccountIds('1', '', '5'));
    assertSame([], poznoteAutoLoginAccountIds('1', '', ''));
    assertSame([], poznoteAutoLoginAccountIds('1', '', '0'));
});

test('the login page offers the ticked accounts that still exist, by username', function () use ($profiles) {
    $offered = array_column(poznotePasswordlessProfiles($profiles, [5, 7, 99]), 'username');
    assertSame(['alice', 'zed'], $offered, 'in the order of the profiles, a deleted account left out');
    assertSame([], poznotePasswordlessProfiles($profiles, []));
});

test('the only account of the instance, ticked, opens with no login screen', function () {
    $single = [['id' => 5, 'username' => 'zed', 'is_admin' => 1]];
    assertSame('zed', poznoteResolveAutoLoginProfile($single, [5])['username']);
    assertSame(null, poznoteResolveAutoLoginProfile($single, []), 'not ticked');
    assertSame(null, poznoteResolveAutoLoginProfile($single, [9]), 'another account ticked');
});

test('as soon as a second account exists, the login page is shown', function () use ($profiles) {
    assertSame(null, poznoteResolveAutoLoginProfile($profiles, [5]), 'even with a single account ticked');
    assertSame(null, poznoteResolveAutoLoginProfile($profiles, [2, 5, 7]), 'even with every account ticked');
    assertSame(null, poznoteResolveAutoLoginProfile([], [5]));
});

test('a page and its script calls are signed in', function () {
    assertSame(true, poznoteRequestQualifiesForAutoLogin([
        'HTTP_SEC_FETCH_MODE' => 'navigate',
        'HTTP_SEC_FETCH_DEST' => 'document',
    ], false));
    assertSame(true, poznoteRequestQualifiesForAutoLogin(['HTTP_SEC_FETCH_MODE' => 'cors'], false));
    assertSame(true, poznoteRequestQualifiesForAutoLogin(['HTTP_X_REQUESTED_WITH' => 'XMLHttpRequest'], false));
    assertSame(true, poznoteRequestQualifiesForAutoLogin(['HTTP_ACCEPT' => 'text/html'], false), 'browser without Fetch Metadata');
});

test('an API client is not', function () {
    assertSame(false, poznoteRequestQualifiesForAutoLogin([], false));
    assertSame(false, poznoteRequestQualifiesForAutoLogin(['HTTP_ACCEPT' => 'application/json'], false));
});

test('a request with credentials of its own is judged on them', function () {
    assertSame(false, poznoteRequestQualifiesForAutoLogin(['HTTP_SEC_FETCH_MODE' => 'cors'], true));
});
