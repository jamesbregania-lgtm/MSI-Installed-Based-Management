/* ── PHONE SETUP ──
   Technicians should have schedule notifications on and the MSI app installed.
   While either is missing, a reminder panel shows at the top of My Schedule.
   It never blocks anything: no popup, the page stays usable. The panel hides
   itself once both steps are done.

   Notifications: permission → push subscription through the service worker
   (/sw.js) → handed to the server, which pushes schedule changes to this phone.
   Skipped when the server has no push keys (data-push-key is empty).

   Install: done when running as the installed app, after Chrome reports the
   install (appinstalled), or when Chrome confirms it is installed already
   (getInstalledRelatedApps; see related_applications in the manifest). Chrome's
   own install dialog is used when Chrome offers it (beforeinstallprompt);
   otherwise the step shows how to install from Chrome's menu. The step is never
   marked done on a guess: when Chrome can't say, the technician says it
   themselves with "I already installed it".

   Every step that isn't done keeps a button the technician can tap: turn on /
   check again for notifications, install / "I already installed it" for the app. */
(() => {
    const modal = document.getElementById('setupModal');
    if (!modal) return;
    const byId = id => document.getElementById(id);
    const pushKey = modal.dataset.pushKey || '';

    const steps = {
        notify: { el: byId('setupStepNotify'), text: byId('setupNotifyText'), btn: byId('setupNotifyBtn') },
        install: { el: byId('setupStepInstall'), text: byId('setupInstallText'), btn: byId('setupInstallBtn'), confirm: byId('setupInstallConfirmBtn') }
    };
    Object.values(steps).forEach(step => { step.label = step.btn.textContent; });
    // checking → todo / blocked → done
    const state = { notify: pushKey ? 'checking' : 'done', install: 'checking' };
    if (!pushKey) {
        steps.notify.el.hidden = true;
    }

    // Show the reminder as soon as any step is known to be missing; hide it
    // once every step is done.
    function update() {
        const values = Object.values(state);
        if (values.every(value => value === 'done')) {
            modal.hidden = true;
            return;
        }
        if (values.some(value => value === 'todo' || value === 'blocked')) modal.hidden = false;
    }

    // button: show the step's main button (optionally relabelled);
    // confirm: show the "I already installed it" button.
    function setStep(name, status, message, { button = false, label = '', confirm = false } = {}) {
        const step = steps[name];
        state[name] = status;
        step.el.dataset.state = status;
        // A finished step is removed, not left green: only what's still missing shows.
        step.el.hidden = status === 'done';
        if (message) step.text.textContent = message;
        step.btn.hidden = !button;
        if (button) step.btn.textContent = label || step.label;
        if (step.confirm) step.confirm.hidden = !confirm;
        update();
    }

    // One service worker serves both steps: it receives the pushes, and Chrome
    // only offers installation once it is in place.
    const swReady = 'serviceWorker' in navigator
        ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready)
        : Promise.reject(new Error('no service worker'));
    swReady.catch(() => {});

    /* ── Step 1: notifications ── */

    // The push key arrives base64url-encoded; subscribe() wants bytes.
    function keyBytes(base64url) {
        const base64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
        return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }

    function sameKey(buffer, bytes) {
        if (!buffer) return false;
        const a = new Uint8Array(buffer);
        return a.length === bytes.length && a.every((value, i) => value === bytes[i]);
    }

    async function post(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
        return data;
    }

    async function subscribe() {
        const registration = await swReady;
        const serverKey = keyBytes(pushKey);
        let subscription = await registration.pushManager.getSubscription();
        // Keys changed on the server: the old subscription can't be used.
        if (subscription && !sameKey(subscription.options && subscription.options.applicationServerKey, serverKey)) {
            await subscription.unsubscribe();
            subscription = null;
        }
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
        }
        try {
            await post('/user_account/push/subscribe', { subscription: subscription.toJSON() });
        } catch (err) {
            // The server didn't keep it; don't leave the phone half set up.
            await subscription.unsubscribe().catch(() => {});
            throw err;
        }
    }

    const notifyMessages = {
        off: 'Turn on notifications so you never miss a schedule.',
        on: 'Notifications are on.',
        blocked: 'Notifications are blocked. In Chrome, tap the icon left of the address, then Permissions › Notifications › Allow, then tap the button below.',
        unsupported: 'This browser cannot receive notifications. Open this site in Google Chrome.'
    };
    const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    let notifyBusy = false;

    // Permission already granted needs no tap: the phone is (re)subscribed
    // quietly, which also ties it to whoever is logged in now.
    async function checkNotify() {
        if (!pushKey || notifyBusy) return;
        if (!pushSupported) return setStep('notify', 'blocked', notifyMessages.unsupported);
        if (Notification.permission === 'denied') return setStep('notify', 'blocked', notifyMessages.blocked, { button: true, label: 'I allowed it, check again' });
        if (Notification.permission !== 'granted') return setStep('notify', 'todo', notifyMessages.off, { button: true });
        notifyBusy = true;
        try {
            await subscribe();
            setStep('notify', 'done', notifyMessages.on);
        } catch (err) {
            setStep('notify', 'todo', err.message || notifyMessages.off, { button: true });
        } finally {
            notifyBusy = false;
        }
    }

    steps.notify.btn.addEventListener('click', async () => {
        if (notifyBusy) return;
        notifyBusy = true;
        steps.notify.btn.disabled = true;
        try {
            const permission = await Notification.requestPermission();
            notifyBusy = false;
            if (permission === 'granted') {
                notifyBusy = true;
                await subscribe();
                setStep('notify', 'done', notifyMessages.on);
            } else {
                await checkNotify();
            }
        } catch (err) {
            setStep('notify', 'todo', err.message || 'Could not turn on notifications. Please try again.', { button: true });
        } finally {
            notifyBusy = false;
            steps.notify.btn.disabled = false;
        }
    });

    // Back from Chrome's settings after allowing notifications there.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state.notify !== 'done') checkNotify();
    });

    /* ── Step 2: install the app ── */

    const installMessages = {
        prompt: 'Install the MSI app on this phone to open your schedule in one tap.',
        manual: 'Install the MSI app on this phone: tap ⋮ at the top right of Chrome, then "Add to Home screen" › Install. Already installed it? Tap the button below.',
        done: 'The MSI app is installed.'
    };
    // Any app-style window counts: a desktop or phone install can report
    // standalone, minimal-ui, fullscreen or window-controls-overlay.
    const runningAsApp = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay']
        .some(mode => window.matchMedia(`(display-mode: ${mode})`).matches)
        || window.navigator.standalone === true;
    let installEvent = null;

    // Once the app is known to be installed, this phone is never asked again:
    // the reminder disappears for good and the technician sees only the schedule.
    const REMEMBER_KEY = 'msi.appInstalled';
    const remembered = () => { try { return localStorage.getItem(REMEMBER_KEY) === '1'; } catch (e) { return false; } };
    const remember = () => { try { localStorage.setItem(REMEMBER_KEY, '1'); } catch (e) { /* storage blocked: asked again next visit */ } };
    const installDone = () => { remember(); setStep('install', 'done', installMessages.done); };

    if (runningAsApp || remembered()) {
        installDone();
    } else {
        window.addEventListener('beforeinstallprompt', event => {
            // Use the modal's button instead of Chrome's own mini-bar.
            event.preventDefault();
            installEvent = event;
            if (state.install !== 'done') setStep('install', 'todo', installMessages.prompt, { button: true });
        });

        window.addEventListener('appinstalled', () => {
            installEvent = null;
            installDone();
        });

        steps.install.btn.addEventListener('click', async () => {
            if (!installEvent) return setStep('install', 'todo', installMessages.manual, { button: true, confirm: true });
            const event = installEvent;
            installEvent = null;
            event.prompt();
            const choice = await event.userChoice.catch(() => null);
            if (choice && choice.outcome === 'accepted') {
                installDone();
            } else {
                // A dismissed dialog can't be reopened from here; Chrome's menu still works.
                setStep('install', 'todo', installMessages.manual, { button: true, confirm: true });
            }
        });

        // "I already installed it": Chrome can't always tell (plain http, older
        // Chrome), so the technician can say so. Never assumed on their behalf.
        if (steps.install.confirm) {
            steps.install.confirm.addEventListener('click', installDone);
        }

        // Give Chrome a moment to offer installation. If it doesn't, ask
        // Chrome whether the app is installed already. If Chrome can't say,
        // show how to install and let the technician confirm it themselves.
        setTimeout(async () => {
            if (state.install !== 'checking') return;
            const manual = { button: true, confirm: true };
            if (typeof navigator.getInstalledRelatedApps !== 'function') {
                return setStep('install', 'todo', installMessages.manual, manual);
            }
            try {
                // An answer that never comes must not leave the modal stuck.
                const installed = await Promise.race([
                    navigator.getInstalledRelatedApps(),
                    new Promise((resolve, reject) => setTimeout(() => reject(new Error('no answer')), 2000))
                ]);
                if (state.install !== 'checking') return;
                if (installed.length) installDone();
                else setStep('install', 'todo', installMessages.manual, manual);
            } catch (e) {
                setStep('install', 'todo', installMessages.manual, manual);
            }
        }, 3000);
    }

    checkNotify();
})();
