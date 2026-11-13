<?php
/**
 * Accounts opened without a password (Settings > Admin Tools > Open without
 * login, discussion #1608, reworked for several accounts on 2026-11-13).
 *
 * An administrator ticks the accounts that may be opened without a password.
 * When the only active account of the instance is ticked, a browser that
 * reaches it is signed in directly, with no login screen at all (the case
 * #1608 asked for). Otherwise the login page keeps asking the other accounts
 * for their password, and offers the ticked ones in a list of their own.
 *
 * The questions that decide what that means are answered here, away from the
 * session and the database, so they can be tested on their own: which
 * accounts are ticked, when one is opened without a screen, and for which
 * callers.
 */

require_once __DIR__ . '/request-kind.php';

/**
 * The accounts ticked by the administrator, as positive ids without
 * duplicates. Nothing while the option is off.
 *
 * Before the list existed the option opened one account, the administrator
 * who turned it on, recorded in login_disabled_user_id: an instance that never
 * saved the list keeps exactly that account ticked.
 *
 * @param mixed $enabled  login_disabled ('1' / '0')
 * @param mixed $ids      login_disabled_user_ids, a JSON array of ids, '' when never saved
 * @param mixed $legacyId login_disabled_user_id, the single account of the first version
 * @return int[]
 */
function poznoteAutoLoginAccountIds($enabled, $ids, $legacyId): array
{
    if (!filter_var($enabled, FILTER_VALIDATE_BOOL)) {
        return [];
    }

    $raw = is_string($ids) ? trim($ids) : '';
    if ($raw === '') {
        $legacy = (int)$legacyId;
        return $legacy > 0 ? [$legacy] : [];
    }

    return poznoteNormalizeAutoLoginAccountIds(json_decode($raw, true));
}

/**
 * Positive ids without duplicates, in the order given. Anything that is not a
 * list of whole numbers gives nothing rather than a guess: a JSON object is
 * not a list, {"a":1} must not tick account 1.
 *
 * @param mixed $decoded
 * @return int[]
 */
function poznoteNormalizeAutoLoginAccountIds($decoded): array
{
    if (!is_array($decoded) || !array_is_list($decoded)) {
        return [];
    }

    $ids = [];
    foreach ($decoded as $value) {
        if (is_int($value) || (is_string($value) && ctype_digit($value))) {
            $id = (int)$value;
            if ($id > 0 && !in_array($id, $ids, true)) {
                $ids[] = $id;
            }
        }
    }
    return $ids;
}

/**
 * The ticked accounts that can be opened, in the order of $profiles (by
 * username). An account that is gone or deactivated is left out rather than
 * replaced by another one.
 *
 * @param array $profiles Active profiles (id, username, is_admin).
 * @param int[] $ids      The ticked accounts.
 */
function poznotePasswordlessProfiles(array $profiles, array $ids): array
{
    if ($ids === []) {
        return [];
    }

    return array_values(array_filter($profiles, static function ($profile) use ($ids): bool {
        return in_array((int)($profile['id'] ?? 0), $ids, true);
    }));
}

/**
 * The account opened with no login screen at all: only when it is the single
 * active account of the instance and it is ticked. As soon as a second
 * account exists, whoever reaches the instance has to say who they are, so
 * the login page is shown with the ticked accounts offered on it.
 *
 * @param array $profiles Active profiles (id, username, is_admin).
 * @param int[] $ids      The ticked accounts.
 */
function poznoteResolveAutoLoginProfile(array $profiles, array $ids): ?array
{
    if (count($profiles) !== 1) {
        return null;
    }

    $passwordless = poznotePasswordlessProfiles($profiles, $ids);
    return $passwordless[0] ?? null;
}

/**
 * Whether this caller is signed in without credentials.
 *
 * Only a browser is: a page, or a call made by a page's script. An API
 * client (no browser signal at all) keeps authenticating the way it always
 * did, and so does any request that brings credentials of its own, which
 * must be judged on them. This keeps scripts and integrations unchanged and
 * the activity log free of one "login" per API call; it is not a protection,
 * since anyone who can reach the instance can open it in a browser.
 *
 * @param array $server         Typically $_SERVER.
 * @param bool  $hasCredentials The request carries API credentials.
 */
function poznoteRequestQualifiesForAutoLogin(array $server, bool $hasCredentials): bool
{
    if ($hasCredentials) {
        return false;
    }

    return poznoteClassifyRequest($server) !== POZNOTE_REQUEST_CLIENT;
}
