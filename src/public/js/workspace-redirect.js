/**
 * Workspace redirect - handles workspace selection after authentication
 * Used by login.php, oidc_callback.php for CSP-compliant redirects after authentication
 * Note: last_opened_workspace is now stored in database, not localStorage
 */
(function() {
    'use strict';
    
    // Get config from JSON data element
    var dataElement = document.getElementById('workspace-redirect-data');
    if (!dataElement) return;
    
    // The server already refuses a target that leaves the app
    // (lib/safe-redirect.php). This asks the browser's own URL parser the same
    // question, since it is the one that decides where the navigation goes:
    // "javascript:" has no origin, "/\host" and "//host" have another one.
    function resolveInsideApp(target) {
        if (typeof target !== 'string' || target === '') return null;
        try {
            var url = new URL(target, window.location.href);
            var isWeb = url.protocol === 'http:' || url.protocol === 'https:';
            return isWeb && url.origin === window.location.origin ? url.href : null;
        } catch (e) {
            return null;
        }
    }

    try {
        var config = JSON.parse(dataElement.textContent);
        var redirectAfter = resolveInsideApp(config.redirectAfter);

        // If a specific redirect URL is provided (from OIDC flow), use it
        if (redirectAfter) {
            window.location.href = redirectAfter;
        } else {
            // Redirect to index without workspace parameter - server will handle
            // workspace selection based on database settings (last_opened_workspace, default_workspace)
            // On a phone the page opens on the notes list, with the last
            // opened note behind it. Arriving in the app (the PWA starts
            // here, so does every sign-in) stays on that list, the open
            // note marked and scrolled into view in the tree
            // (js/index-events.js); nothing slides to the note on its own.
            window.location.href = 'index.php';
        }
    } catch (e) {
        // Final fallback - redirect to index without workspace
        window.location.href = 'index.php';
    }
})();
