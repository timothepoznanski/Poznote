<?php
/**
 * How long a "Remember me" cookie keeps signing someone in.
 *
 * An instance-wide setting rather than a per-account one: the login form
 * shows the duration before any account is known, so there is nobody to read
 * a per-account value from. Administrators set it in Settings > Admin Tools >
 * Users & access; it is stored in master.db as remember_me_days.
 *
 * The number is also the retention of the ended-cookies list
 * (revoked_remember_tokens): both call sites of revokeRememberMeToken() date
 * their row from this duration, so a cookie can never outlive its revocation.
 */

/** What the Settings field accepts, and what it starts from. */
const POZNOTE_REMEMBER_ME_DAYS_MIN = 1;
// Chrome and Firefox cap a cookie's expiry at 400 days, so a longer promise
// is one the browser would not keep.
const POZNOTE_REMEMBER_ME_DAYS_MAX = 400;
const POZNOTE_REMEMBER_ME_DAYS_DEFAULT = 30;

/**
 * Read a remember_me_days value. A number out of range is brought back inside
 * it, which is what the field would have done; anything that is not a number
 * at all (never set, hand-edited, master.db unreadable) falls back to the
 * 30 days Poznote has always used, never to the shortest or the longest.
 */
function poznoteRememberMeDays($value): int
{
    if ($value === null || $value === false || $value === '' || !is_numeric($value)) {
        return POZNOTE_REMEMBER_ME_DAYS_DEFAULT;
    }
    return max(
        POZNOTE_REMEMBER_ME_DAYS_MIN,
        min(POZNOTE_REMEMBER_ME_DAYS_MAX, (int)$value)
    );
}

/**
 * The configured duration in days. Read once per request: a cookie is checked
 * on every request that carries one, and this must not cost a master.db read
 * each time.
 */
function poznoteRememberMeDurationDays(): int
{
    static $days = null;
    if ($days !== null) {
        return $days;
    }
    try {
        require_once dirname(__DIR__) . '/users/db_master.php';
        $days = poznoteRememberMeDays(getGlobalSetting('remember_me_days', ''));
    } catch (Throwable $e) {
        error_log('Poznote: could not read remember_me_days: ' . $e->getMessage());
        $days = POZNOTE_REMEMBER_ME_DAYS_DEFAULT;
    }
    return $days;
}

/** The same duration in seconds, which is what the cookie takes. */
function poznoteRememberMeDurationSeconds(): int
{
    return poznoteRememberMeDurationDays() * 24 * 60 * 60;
}
