/**
 * Session guard: sends the page to the login form when its session is gone.
 *
 * A same-origin fetch or XMLHttpRequest answered with 401 means the session
 * behind the cookie no longer exists: neither the API nor the page gates
 * answer 401 for any other reason. That used to come with a Basic challenge,
 * and the browser opened its native username/password dialog over the app,
 * which cannot sign an SSO account in at all (issue #1389). The server now
 * withholds the challenge from the app's own calls, and this file does what
 * the dialog could not: confirm with login.php that the session is really
 * gone (a 401 from any other cause must not throw the user out), then go to
 * login.php with the current URL as the place to come back to.
 *
 * Second duty, same wrappers: a tab that missed an account switch. The
 * active account is session state (switch_account.php, the login-time
 * account choice), so after a switch made in another tab, or when this page
 * comes back from the back-forward cache, every call this page makes would
 * act on the new account with the ids of the old one. The server mirrors
 * the active account in the poznote_account cookie (auth.php
 * syncActiveAccountCookie()); this file remembers the value its page was
 * rendered with, sends it as X-Poznote-Account on every same-origin call so
 * the server can refuse a mismatch with 409 (enforceActiveAccountHeader()),
 * and reloads the page, without its query string, as soon as the cookie no
 * longer matches: on that 409, when the tab is shown or focused again, and on
 * a back-forward cache restore.
 *
 * Loaded standalone in <head> on every signed-in page, before any script
 * that talks to the server. Not loaded on login.php or on public pages.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || !window.location) {
        return;
    }

    var nativeFetch = typeof window.fetch === 'function' ? window.fetch : null;
    var redirecting = false;
    var checking = false;

    // login.php lives next to js/: resolving it from this script's own URL
    // works from the docroot, from admin/ and from an instance served under a
    // path prefix alike.
    var loginUrl = (function () {
        try {
            var script = document.currentScript;
            var src = script && script.src ? script.src : '';
            var marker = src.lastIndexOf('/js/');
            if (marker !== -1) {
                return src.slice(0, marker + 1) + 'login.php';
            }
        } catch (e) {
            console.debug('session-guard: script URL unavailable:', e);
        }
        return '/login.php';
    })();

    // ========== Account of this page ==========

    function readAccountCookie() {
        try {
            var match = document.cookie.match(/(?:^|;\s*)poznote_account=(\d+)/);
            return match ? match[1] : '';
        } catch (e) {
            return '';
        }
    }

    // The cookie was set by the response that rendered this page, so at this
    // point it names the account the page shows.
    var pageAccount = readAccountCookie();
    var reloadingForAccount = false;

    // The query string belongs to the old account (a note id, a workspace):
    // the same path without it opens the new account where it left off.
    function reloadForAccountSwitch() {
        if (reloadingForAccount || redirecting) {
            return;
        }
        reloadingForAccount = true;
        window.location.replace(window.location.pathname);
    }

    // This page is the one switching (js/profile.js): its last calls may
    // reach the server after the switch and come back 409, and reloading
    // then would cancel the navigation into the other account, landing note
    // included.
    // Not for ever: the person may decline to leave (unsaved changes prompt).
    window.poznoteAccountSwitchStarted = function () {
        reloadingForAccount = true;
        setTimeout(function () { reloadingForAccount = false; }, 10000);
    };

    function checkAccountCookie() {
        if (!pageAccount) {
            return;
        }
        var current = readAccountCookie();
        if (current && current !== pageAccount) {
            reloadForAccountSwitch();
        }
    }

    window.addEventListener('pageshow', function (e) {
        if (e && e.persisted) {
            reloadingForAccount = false;
            checkAccountCookie();
        }
    });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') checkAccountCookie();
    });
    window.addEventListener('focus', checkAccountCookie);

    function resolve(url) {
        try {
            return new URL(String(url), window.location.href);
        } catch (e) {
            return null;
        }
    }

    function isSameOrigin(url) {
        var parsed = resolve(url);
        return !!parsed && parsed.origin === window.location.origin;
    }

    function isLoginPage(url) {
        var parsed = resolve(url);
        return !!parsed && /(^|\/)login\.php$/.test(parsed.pathname);
    }

    function goToLogin() {
        if (redirecting) {
            return;
        }
        redirecting = true;
        var here = window.location.pathname + window.location.search + window.location.hash;
        window.location.replace(loginUrl + '?expired=1&redirect=' + encodeURIComponent(here));
    }

    // login.php renders the workspace-redirect stub, not the form, when a
    // session exists (the same probe login-page.js uses for the PWA).
    function confirmSessionGone() {
        if (checking || redirecting || !nativeFetch) {
            return;
        }
        checking = true;
        nativeFetch(loginUrl, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).then(function (response) {
            return response.text();
        }).then(function (html) {
            checking = false;
            if (html.indexOf('workspace-redirect-data') === -1) {
                goToLogin();
            } else {
                window.poznoteSessionGone = false;
            }
        }).catch(function (e) {
            checking = false;
            window.poznoteSessionGone = false;
            console.debug('session-guard: session probe failed:', e);
        });
    }

    // A 401 is the signal; so is being bounced to login.php, which is what a
    // page gate does for a browser too old to send Fetch Metadata. A 409
    // carrying the account_switched marker is the server refusing a call
    // from this page because the session moved to another account.
    function inspect(requestUrl, status, finalUrl, bodyText) {
        if (redirecting || !isSameOrigin(requestUrl) || isLoginPage(requestUrl)) {
            return;
        }
        if (status === 409 && typeof bodyText === 'string' && bodyText.indexOf('account_switched') !== -1) {
            reloadForAccountSwitch();
            return;
        }
        if (status === 401 || (finalUrl && isLoginPage(finalUrl))) {
            // The call that got this answer is about to report its failure
            // to the user. An error dialog would only cover the login page
            // this file sends them to (js/modal-alerts.js reads the flag).
            window.poznoteSessionGone = true;
            confirmSessionGone();
        }
    }

    // Same-origin calls carry the page's account; a custom header on a
    // cross-origin call would only force a preflight.
    function withAccountHeader(input, init) {
        if (!pageAccount) {
            return null;
        }
        var request;
        try {
            request = new Request(input, init);
        } catch (e) {
            return null;
        }
        if (!isSameOrigin(request.url) || request.headers.has('X-Poznote-Account')) {
            return null;
        }
        // A no-cors request only accepts safelisted headers and throws here:
        // it then goes out untagged rather than failing.
        try {
            request.headers.set('X-Poznote-Account', pageAccount);
        } catch (e) {
            return null;
        }
        return request;
    }

    if (nativeFetch) {
        window.fetch = function (input, init) {
            var requestUrl = '';
            if (typeof input === 'string') {
                requestUrl = input;
            } else if (input && typeof input.url === 'string') {
                requestUrl = input.url;
            } else if (input && typeof input.href === 'string') {
                requestUrl = input.href;
            }
            var tagged = withAccountHeader(input, init);
            var call = tagged ? nativeFetch.call(window, tagged) : nativeFetch.apply(window, arguments);
            return call.then(function (response) {
                try {
                    if (response.status === 409 && isSameOrigin(requestUrl)) {
                        response.clone().text().then(function (text) {
                            inspect(requestUrl, response.status, '', text);
                        }).catch(function () { /* not a switch */ });
                    } else {
                        inspect(requestUrl, response.status, response.redirected ? response.url : '');
                    }
                } catch (e) {
                    console.debug('session-guard: fetch inspection failed:', e);
                }
                return response;
            });
        };
    }

    var xhrProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (xhrProto && typeof xhrProto.open === 'function') {
        var nativeOpen = xhrProto.open;
        xhrProto.open = function (method, url) {
            this.__poznoteSessionGuardUrl = String(url);
            if (!this.__poznoteSessionGuardHooked) {
                this.__poznoteSessionGuardHooked = true;
                this.addEventListener('load', function () {
                    try {
                        var body = '';
                        if (this.status === 409 && (this.responseType === '' || this.responseType === 'text')) {
                            body = String(this.responseText || '');
                        }
                        inspect(this.__poznoteSessionGuardUrl, this.status, this.responseURL || '', body);
                    } catch (e) {
                        console.debug('session-guard: XHR inspection failed:', e);
                    }
                });
            }
            return nativeOpen.apply(this, arguments);
        };

        var nativeSend = xhrProto.send;
        if (typeof nativeSend === 'function') {
            xhrProto.send = function () {
                try {
                    if (pageAccount && this.__poznoteSessionGuardUrl && isSameOrigin(this.__poznoteSessionGuardUrl)) {
                        this.setRequestHeader('X-Poznote-Account', pageAccount);
                    }
                } catch (e) {
                    console.debug('session-guard: XHR account header failed:', e);
                }
                return nativeSend.apply(this, arguments);
            };
        }
    }

    // ========== Automatic sign-out after inactivity ==========
    //
    // Third duty (discussion #1826, src/lib/idle-signout.php). The delay the
    // account chose in Settings comes in the poznote_idle_signout cookie, set
    // by the server on navigations and when the setting is saved, so every
    // tab sees a change at once; no cookie, nothing happens.
    //
    // Only real interactions count (keys, pointer, wheel, touch), shared by
    // the tabs of this browser through localStorage: someone working in one
    // tab is not signed out by another left in the background. Background
    // calls (live refresh, reminders, offline sync) never count.
    //
    // When the delay has passed, this tab saves its open note, makes sure
    // nothing is waiting to be sent and that the server answers, then goes
    // through logout.php like the Logout button. It never signs out with
    // changes that did not reach the server, and never without a server: on
    // a network cut, logout.php is the offline page's local sign-out, which
    // erases what has not been sent. Either way it tries again a little
    // later, and the server ends the session meanwhile (its own check, with
    // a margin over the delay). Online only: the offline page has no delay.

    var ACTIVITY_KEY = 'poznote_idle_last_activity';
    var PING_KEY = 'poznote_idle_last_ping';
    var PENDING_KEY = 'poznote_idle_signout_pending';
    var BLOCKED_KEY = 'poznote_idle_signout_blocked';
    var SIGNED_OUT_KEY = 'poznote_idle_signed_out';
    var PING_INTERVAL = 60000;
    var CHECK_INTERVAL = 15000;
    var RETRY_DELAY = 30000;
    var ACTIVITY_THROTTLE = 2000;

    var appBase = loginUrl.replace(/login\.php$/, '');
    var lastLocalActivity = Date.now();
    var idleSigningOut = false;
    var idleRetryAt = 0;

    function idleMinutes() {
        try {
            var match = document.cookie.match(/(?:^|;\s*)poznote_idle_signout=(\d+)/);
            var minutes = match ? parseInt(match[1], 10) : 0;
            return minutes > 0 && minutes <= 1440 ? minutes : 0;
        } catch (e) {
            return 0;
        }
    }

    function readStamp(key) {
        try {
            var value = parseInt(window.localStorage.getItem(key) || '', 10);
            return value > 0 ? value : 0;
        } catch (e) {
            return 0;
        }
    }

    function writeStamp(key, value) {
        try {
            window.localStorage.setItem(key, String(value));
        } catch (e) {
            console.debug('session-guard: localStorage unavailable:', e);
        }
    }

    function pingActivity(now) {
        if (!nativeFetch || now - readStamp(PING_KEY) < PING_INTERVAL) {
            return;
        }
        writeStamp(PING_KEY, now);
        nativeFetch(appBase + 'api/v1/users/me/activity', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).catch(function (e) {
            console.debug('session-guard: activity report failed:', e);
        });
    }

    function lastActivity() {
        return Math.max(lastLocalActivity, readStamp(ACTIVITY_KEY));
    }

    function onActivity() {
        var now = Date.now();
        if (now - lastLocalActivity < ACTIVITY_THROTTLE) {
            return;
        }
        var minutes = idleMinutes();
        // The first touch after the delay (a laptop opened again, a tab whose
        // timers were asleep) is the moment to sign out, not a reason to stay:
        // whoever touches the computer then is not proven to be its owner.
        if (minutes && now - lastActivity() >= minutes * 60000) {
            checkIdle();
            return;
        }
        lastLocalActivity = now;
        // Kept up to date with no delay set too, so that turning the setting
        // on does not find a stamp from days ago and sign out at once.
        writeStamp(ACTIVITY_KEY, now);
        if (minutes) {
            pingActivity(now);
        }
    }

    // The note shown in the editor, as js/ai-chat.js finds it.
    function openNoteId() {
        var rightCol = document.getElementById('right_col');
        var entries = rightCol ? rightCol.querySelectorAll('.noteentry[data-note-id]') : [];
        if (entries.length === 1) {
            var shownId = parseInt(entries[0].getAttribute('data-note-id'), 10);
            if (shownId > 0) return shownId;
        }
        var id = parseInt(window.noteid, 10);
        return id > 0 ? id : 0;
    }

    function noteHasUnsavedChanges(id) {
        return !!id && typeof window.hasUnsavedChangesOnScreen === 'function'
            && !!window.hasUnsavedChangesOnScreen(id);
    }

    // Calls back with true once the open note has nothing the server has
    // not seen. A save can be dropped without calling back (the note held
    // by another editor), hence the timer.
    function saveOpenNote(done) {
        var id = openNoteId();
        if (!noteHasUnsavedChanges(id)) {
            done(true);
            return;
        }
        if (typeof window.saveNoteImmediately !== 'function') {
            done(false);
            return;
        }
        var finished = false;
        var finish = function () {
            if (finished) return;
            finished = true;
            done(!noteHasUnsavedChanges(id));
        };
        var timer = setTimeout(finish, 5000);
        try {
            window.saveNoteImmediately({ onSaved: function () { clearTimeout(timer); setTimeout(finish, 300); } });
        } catch (e) {
            console.debug('session-guard: saving the open note failed:', e);
            clearTimeout(timer);
            finish();
        }
    }

    // Changes made offline and not sent yet (js/offline-store.js): logout
    // would erase them.
    function hasUnsentOfflineChanges(done) {
        var store = window.PoznoteOffline;
        var userId = parseInt(pageAccount || readAccountCookie(), 10);
        if (!store || typeof store.getOutbox !== 'function' || !(userId > 0)
            || (typeof store.isSupported === 'function' && !store.isSupported())) {
            done(false);
            return;
        }
        store.getOutbox(userId).then(function (entries) {
            done(!!(entries && entries.length));
        }).catch(function (e) {
            console.debug('session-guard: offline changes unreadable:', e);
            done(true);
        });
    }

    function serverReachable(done) {
        if (!nativeFetch) {
            done(false);
            return;
        }
        var controller = window.AbortController ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, 6000) : null;
        nativeFetch(appBase + 'api_health.php', {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller ? controller.signal : undefined
        }).then(function (response) {
            clearTimeout(timer);
            done(response.ok);
        }).catch(function () {
            clearTimeout(timer);
            done(false);
        });
    }

    function postponeIdleSignOut() {
        idleSigningOut = false;
        idleRetryAt = Date.now() + RETRY_DELAY;
    }

    function goToIdleLogout() {
        if (redirecting) {
            return;
        }
        redirecting = true;
        writeStamp(SIGNED_OUT_KEY, Date.now());
        var here = window.location.pathname + window.location.search + window.location.hash;
        window.location.replace(appBase + 'logout.php?idle=1&redirect=' + encodeURIComponent(here));
    }

    // Saves this tab's note; a tab that cannot holds the others back.
    function prepareForIdleSignOut(done) {
        saveOpenNote(function (clean) {
            if (!clean) {
                writeStamp(BLOCKED_KEY, Date.now());
            }
            done(clean);
        });
    }

    function idleSignOut() {
        if (idleSigningOut || redirecting) {
            return;
        }
        idleSigningOut = true;
        var startedAt = Date.now();
        // The other tabs save their note too (storage event below), and say
        // so if they cannot.
        writeStamp(PENDING_KEY, startedAt);
        prepareForIdleSignOut(function (clean) {
            if (!clean) {
                postponeIdleSignOut();
                return;
            }
            hasUnsentOfflineChanges(function (unsent) {
                if (unsent) {
                    postponeIdleSignOut();
                    return;
                }
                serverReachable(function (reachable) {
                    // Someone came back meanwhile, or another tab could not
                    // save in the time this one took.
                    if (!reachable || readStamp(BLOCKED_KEY) >= startedAt
                        || Date.now() - lastActivity() < idleMinutes() * 60000) {
                        postponeIdleSignOut();
                        return;
                    }
                    goToIdleLogout();
                });
            });
        });
    }

    function checkIdle() {
        var minutes = idleMinutes();
        if (!minutes || idleSigningOut || redirecting || Date.now() < idleRetryAt) {
            return;
        }
        if (Date.now() - lastActivity() >= minutes * 60000) {
            idleSignOut();
        }
    }

    ['keydown', 'pointerdown', 'wheel', 'touchstart', 'input'].forEach(function (type) {
        window.addEventListener(type, onActivity, { capture: true, passive: true });
    });
    // A moving mouse is someone at the computer too; already throttled.
    window.addEventListener('mousemove', onActivity, { capture: true, passive: true });

    window.addEventListener('storage', function (e) {
        if (!e || !idleMinutes()) {
            return;
        }
        if (e.key === PENDING_KEY && !idleSigningOut) {
            prepareForIdleSignOut(function () { /* the signing-out tab reads the blocked mark */ });
        } else if (e.key === SIGNED_OUT_KEY && !redirecting) {
            // Another tab signed out: this one stops showing notes at once.
            // Its note was saved when the sign-out was announced.
            saveOpenNote(function (clean) {
                if (clean) goToIdleLogout();
            });
        }
    });

    // Opening a page is activity. Timers are slowed down in a background
    // tab or a sleeping device: the check runs again as soon as it comes back.
    writeStamp(ACTIVITY_KEY, lastLocalActivity);
    setInterval(checkIdle, CHECK_INTERVAL);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') checkIdle();
    });
    window.addEventListener('focus', checkIdle);
    window.addEventListener('pageshow', checkIdle);
})();
