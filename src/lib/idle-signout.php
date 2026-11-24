<?php
/**
 * Automatic sign-out after inactivity (discussion #1826).
 *
 * A per-account setting, `idle_signout_minutes` (empty or 0 = never). It only
 * applies while Poznote is online: the offline version has no inactivity
 * delay, the documentation says so.
 *
 * Two halves:
 *
 *  - The browser (js/session-guard.js, loaded on every signed-in page) counts
 *    real interactions only, shared between the tabs of the browser. When the
 *    delay has passed it saves the open note, makes sure nothing is waiting to
 *    be sent and that the server answers, then goes through logout.php, the
 *    same path as the Logout button (remember-me cookie revoked, offline
 *    copies removed). Never with unsent changes, never without a server: on a
 *    network cut logout.php would be the offline page's local sign-out, which
 *    erases what has not been sent.
 *  - The server ends a session that has not reported any activity for longer
 *    than the delay plus a margin, on its next request
 *    (poznoteSessionIdleExpired()), for the browser put to sleep or the frozen
 *    tab. Background requests (live refresh, reminder poll, offline sync) never
 *    count as activity: only a page navigation and the browser's activity
 *    report do (poznoteRecordSessionActivity()).
 *
 * The delay travels in the session for the server check (no database read per
 * request) and in a cookie readable by the page scripts, set on navigations
 * and when the setting is saved, so every tab sees a change at once.
 *
 * The automatic sign-out keeps the offline copies of the notes in the browser
 * by default, unlike the Logout button, which always erases them (logout()
 * skips the "just logged out" cookie that has the login page forget them).
 * What would let someone open them is removed instead, by the login page
 * (js/offline-login.js): the "Continue as" entry of an account without a
 * password and the offline unlock of the tab. A second setting,
 * `idle_signout_erase_offline` (off by default), erases them as Logout does.
 * It travels with the delay, as an "e" after the minutes in the cookie, so a
 * sign-out whose session the server already ended still knows it.
 */

/**
 * Largest delay, in minutes (a day). The Settings card takes any whole number
 * from 0 (off) to this.
 */
const POZNOTE_IDLE_SIGNOUT_MAX = 1440;

/**
 * Margin of the server check over the delay: the browser reports activity at
 * most once a minute and must get to sign out first, after saving the note.
 */
const POZNOTE_IDLE_SIGNOUT_GRACE_SECONDS = 120;

/** Cookie the page scripts read the delay from. */
const POZNOTE_IDLE_SIGNOUT_COOKIE = 'poznote_idle_signout';

/**
 * Delay from a stored or typed value: a whole number of minutes from 1 to
 * POZNOTE_IDLE_SIGNOUT_MAX, anything else is 0 (never). A broken value must
 * never sign anyone out.
 */
function poznoteIdleSignoutMinutes($raw): int {
    if (!is_scalar($raw)) {
        return 0;
    }
    $value = trim((string)$raw);
    if ($value === '' || !ctype_digit($value)) {
        return 0;
    }
    $minutes = (int)$value;
    return ($minutes >= 1 && $minutes <= POZNOTE_IDLE_SIGNOUT_MAX) ? $minutes : 0;
}

/**
 * Whether a session has been idle past its delay. Pure: reads the
 * session-shaped array only.
 *
 * A session without a recorded activity (opened before this feature) is not
 * expired: the caller records the current time and the delay starts there.
 */
function poznoteSessionIdleExpired(array $session, int $now): bool {
    $minutes = (int)($session['idle_signout_minutes'] ?? 0);
    if ($minutes <= 0 || !isset($session['last_user_activity'])) {
        return false;
    }
    return $now - (int)$session['last_user_activity'] > $minutes * 60 + POZNOTE_IDLE_SIGNOUT_GRACE_SECONDS;
}

/**
 * A page opened by the person: a top-level GET navigation, not a prefetch or
 * a prerender the browser started on its own. Pure.
 */
function poznoteRequestIsUserNavigation(array $server): bool {
    require_once __DIR__ . '/request-kind.php';
    if (poznoteClassifyRequest($server) !== POZNOTE_REQUEST_DOCUMENT) {
        return false;
    }
    $method = strtoupper((string)($server['REQUEST_METHOD'] ?? 'GET'));
    if (!in_array($method, ['GET', 'HEAD', 'POST'], true)) {
        return false;
    }
    $purpose = strtolower((string)($server['HTTP_SEC_PURPOSE'] ?? $server['HTTP_PURPOSE'] ?? ''));
    return strpos($purpose, 'prefetch') === false && strpos($purpose, 'prerender') === false;
}

/** Records that the person is using Poznote now. */
function poznoteRecordSessionActivity(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        $_SESSION['last_user_activity'] = time();
    }
}

/** The erase-offline setting from its stored value: only "1" erases. */
function poznoteIdleSignoutEraseOffline($raw): bool {
    return is_scalar($raw) && trim((string)$raw) === '1';
}

/**
 * Applies a delay to the current session and to the cookie the page scripts
 * read. 0 removes both.
 */
function poznoteApplyIdleSignoutMinutes(int $minutes, bool $eraseOffline = false): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        if ($minutes > 0) {
            $_SESSION['idle_signout_minutes'] = $minutes;
            $_SESSION['idle_signout_erase_offline'] = $eraseOffline;
            if (!isset($_SESSION['last_user_activity'])) {
                $_SESSION['last_user_activity'] = time();
            }
        } else {
            unset($_SESSION['idle_signout_minutes'], $_SESSION['idle_signout_erase_offline']);
        }
    }
    poznoteWriteIdleSignoutCookie($minutes, $eraseOffline);
}

/**
 * Whether an automatic sign-out keeps the offline copies (the default): the
 * session says so, or, once the server has already ended it, the cookie.
 * Read by logout() before it clears both.
 */
function poznoteIdleSignoutKeepsOffline(): bool {
    if (session_status() === PHP_SESSION_ACTIVE && isset($_SESSION['idle_signout_erase_offline'])) {
        return !$_SESSION['idle_signout_erase_offline'];
    }
    return !preg_match('/^\d+e$/', (string)($_COOKIE[POZNOTE_IDLE_SIGNOUT_COOKIE] ?? ''));
}

function poznoteWriteIdleSignoutCookie(int $minutes, bool $eraseOffline = false): void {
    $current = (string)($_COOKIE[POZNOTE_IDLE_SIGNOUT_COOKIE] ?? '');
    $wanted = $minutes > 0 ? $minutes . ($eraseOffline ? 'e' : '') : '';
    if ($current === $wanted || headers_sent()) {
        return;
    }
    if ($wanted === '') {
        unset($_COOKIE[POZNOTE_IDLE_SIGNOUT_COOKIE]);
    } else {
        $_COOKIE[POZNOTE_IDLE_SIGNOUT_COOKIE] = $wanted;
    }
    // A browser session cookie: the next page opened after the browser
    // restarts writes it again, before any script reads it.
    setcookie(POZNOTE_IDLE_SIGNOUT_COOKIE, $wanted, [
        'expires'  => $wanted === '' ? time() - 3600 : 0,
        'path'     => '/',
        'domain'   => '',
        'secure'   => $GLOBALS['isSecure'] ?? false,
        'httponly' => false,
        'samesite' => 'Lax',
    ]);
}

/**
 * Whether the delay applies to the current session at all: a session opened
 * without a password would open again at once, and an API identity is judged
 * from its credentials on every request.
 */
function poznoteIdleSignoutAppliesToSession(): bool {
    if (session_status() !== PHP_SESSION_ACTIVE || empty($_SESSION['authenticated'])) {
        return false;
    }
    if (($_SESSION['auth_method'] ?? '') === 'auto') {
        return false;
    }
    return empty($_SESSION['login_user']['_api_auth_method']);
}

/**
 * Reads the active account's delay into the session and the cookie
 * (db_connect.php, once the account database is open). On page navigations,
 * and once per account for the other requests, so a session opened before
 * the feature or an account switch picks it up.
 *
 * A session confined to a workspace shared by another account keeps the
 * delay of the person's own account rather than taking the owner's.
 */
function poznoteSyncIdleSignout(PDO $con, int $activeUserId): void {
    if ($activeUserId <= 0) {
        return;
    }
    if (!poznoteIdleSignoutAppliesToSession()) {
        poznoteApplyIdleSignoutMinutes(0);
        return;
    }
    if (function_exists('isSharedWorkspaceScopeActive') && isSharedWorkspaceScopeActive()) {
        return;
    }
    $isNavigation = poznoteRequestIsUserNavigation($_SERVER);
    if (!$isNavigation && (int)($_SESSION['idle_signout_user_id'] ?? 0) === $activeUserId) {
        return;
    }
    try {
        $stmt = $con->query("SELECT key, value FROM settings WHERE key IN ('idle_signout_minutes', 'idle_signout_erase_offline')");
        $values = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    } catch (Throwable $e) {
        // Unreadable: keep what the session has, never sign out on a guess.
        return;
    }
    $_SESSION['idle_signout_user_id'] = $activeUserId;
    poznoteApplyIdleSignoutMinutes(
        poznoteIdleSignoutMinutes($values['idle_signout_minutes'] ?? ''),
        poznoteIdleSignoutEraseOffline($values['idle_signout_erase_offline'] ?? '')
    );
}
