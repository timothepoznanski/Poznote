<?php
lib('remember-me-duration');

// The remember-me duration is now an instance setting, so the number that
// decides how long a sign-in cookie lives can come from a text column anyone
// with master.db can edit. The reading has to be total: never zero (a cookie
// that expires on issue), never negative, never longer than a browser keeps.

test('an unset or unreadable value is the 30 days Poznote always used', function () {
    assertSame(30, poznoteRememberMeDays(null));
    assertSame(30, poznoteRememberMeDays(false));
    assertSame(30, poznoteRememberMeDays(''));
    assertSame(30, poznoteRememberMeDays('   '));
    assertSame(30, poznoteRememberMeDays('forever'));
    assertSame(30, poznoteRememberMeDays([]));
});

test('a number in range is kept, as a string or as an int', function () {
    assertSame(1, poznoteRememberMeDays('1'));
    assertSame(7, poznoteRememberMeDays(7));
    assertSame(90, poznoteRememberMeDays('90'));
    assertSame(400, poznoteRememberMeDays('400'));
});

test('a number out of range is brought back inside it', function () {
    assertSame(1, poznoteRememberMeDays('0'), 'zero would expire the cookie on issue');
    assertSame(1, poznoteRememberMeDays('-5'));
    assertSame(400, poznoteRememberMeDays('3650'), 'browsers cap a cookie at 400 days');
});

test('a decimal is truncated rather than refused', function () {
    assertSame(7, poznoteRememberMeDays('7.9'));
    assertSame(1, poznoteRememberMeDays('0.5'));
});

test('the bounds are the ones the Settings field announces', function () {
    assertSame(1, POZNOTE_REMEMBER_ME_DAYS_MIN);
    assertSame(400, POZNOTE_REMEMBER_ME_DAYS_MAX);
    assertSame(30, POZNOTE_REMEMBER_ME_DAYS_DEFAULT);
});
