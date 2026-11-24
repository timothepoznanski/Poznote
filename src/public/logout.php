<?php
require_once __DIR__ . '/../auth.php';

// ?idle=1: the automatic sign-out after inactivity (js/session-guard.js),
// with the page to come back to once signed in again.
$idleSignout = ($_GET['idle'] ?? '') === '1';
$idleRedirect = null;
if ($idleSignout && isset($_GET['redirect'])) {
    require_once __DIR__ . '/../lib/safe-redirect.php';
    $idleRedirect = poznoteSanitizeLocalRedirect($_GET['redirect']);
}
logout($idleSignout, $idleRedirect);
