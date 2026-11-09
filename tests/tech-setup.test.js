const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Runs public/js/user/tech_setup.js against a fake phone: a minimal DOM,
// Chrome's notification, push and install APIs, and the server. Timers run
// on demand. The setup panel is a reminder inside My Schedule: it shows while
// a step is missing, hides once both are done, and never blocks the page.
const source = fs.readFileSync(path.join(__dirname, '../public/js/user/tech_setup.js'), 'utf8');
const PUSH_KEY = 'AQID'; // base64url of bytes 1,2,3

function phone({
  pushKey = PUSH_KEY, standalone = false, permission = 'default', subscribed = false,
  askAnswer = 'granted', installedApps = [], hasRelatedAppsApi = true, serverOk = true, displayMode = '', storage = null
} = {}) {
  const element = () => ({
    hidden: false, disabled: false, textContent: '', dataset: {}, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }
  });
  const ids = ['setupModal', 'setupTitle', 'setupIntro', 'setupStepNotify', 'setupNotifyText', 'setupNotifyBtn',
    'setupStepInstall', 'setupInstallText', 'setupInstallBtn', 'setupInstallConfirmBtn'];
  const el = Object.fromEntries(ids.map(id => [id, element()]));
  el.setupModal.hidden = true;
  el.setupModal.dataset.pushKey = pushKey;
  el.setupNotifyBtn.hidden = el.setupInstallBtn.hidden = el.setupInstallConfirmBtn.hidden = true;
  el.setupNotifyBtn.textContent = 'Turn on notifications';
  el.setupInstallBtn.textContent = 'Install app';

  const container = { inert: false };
  const bodyClasses = new Set();
  const documentListeners = {};
  const windowListeners = {};
  const timers = [];
  const posts = [];
  const sub = {
    unsubscribed: false,
    options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
    toJSON: () => ({ endpoint: 'https://push.example/phone', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => { sub.unsubscribed = true; return true; }
  };
  let currentSub = subscribed ? sub : null;
  const registration = {
    pushManager: {
      getSubscription: async () => currentSub,
      subscribe: async () => { currentSub = sub; return sub; }
    }
  };
  const Notification = {
    permission,
    requestPermission: async () => { Notification.permission = askAnswer; return askAnswer; }
  };
  const navigator = {
    serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) }
  };
  if (hasRelatedAppsApi) {
    // 'hang': Chrome never answers.
    navigator.getInstalledRelatedApps = () => (installedApps === 'hang' ? new Promise(() => {}) : Promise.resolve(installedApps));
  }
  const window = {
    navigator, Notification, PushManager: function () {},
    matchMedia: query => ({ matches: (standalone && query.includes('standalone')) || (displayMode !== '' && query.includes(displayMode)) }),
    addEventListener(type, fn) { windowListeners[type] = fn; }
  };
  const document = {
    visibilityState: 'visible',
    getElementById: id => el[id] || null,
    querySelector: selector => (selector === '.container' ? container : null),
    body: { classList: { add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c) } },
    addEventListener(type, fn) { documentListeners[type] = fn; }
  };
  const fetch = async (url, options) => {
    posts.push([url, JSON.parse(options.body)]);
    return serverOk
      ? { ok: true, json: async () => ({ ok: true }) }
      : { ok: false, json: async () => ({ ok: false, error: 'Notifications need a one-time database setup.' }) };
  };

  vm.runInNewContext(source, {
    window, navigator, document, Notification, fetch, atob, Uint8Array,
    ...(storage ? { localStorage: storage } : {}),
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout: () => {}
  });

  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
  return {
    el, container, bodyClasses, posts, sub, Notification,
    get open() { return !el.setupModal.hidden; },
    settle,
    fire: async (type, event) => { windowListeners[type] && windowListeners[type](event); await settle(); },
    click: async button => { await button.listeners.click(); await settle(); },
    visible: async () => { documentListeners.visibilitychange(); await settle(); },
    // Fires every pending timer without waiting on each: one may be waiting
    // on a timer that fires in a later round.
    runTimers: async () => { timers.splice(0).forEach(fn => fn()); await settle(); }
  };
}

function installEvent(outcome) {
  const event = { prevented: false, prompted: false, userChoice: Promise.resolve({ outcome }) };
  event.preventDefault = () => { event.prevented = true; };
  event.prompt = () => { event.prompted = true; };
  return event;
}

test('a phone that is already set up never sees the modal', async () => {
  const p = phone({ standalone: true, permission: 'granted', subscribed: true });
  await p.settle();
  await p.runTimers();
  assert.equal(p.open, false);
  // Still re-ties the phone to whoever is logged in.
  assert.equal(p.posts[0][0], '/user_account/push/subscribe');
});

test('a new phone sees the reminder until both steps are done, then it hides itself', async () => {
  const p = phone();
  await p.settle();
  assert.equal(p.open, true);
  assert.equal(p.container.inert, false, 'the page behind is never blocked');
  assert.equal(p.bodyClasses.size, 0);
  assert.equal(p.el.setupStepNotify.dataset.state, 'todo');
  assert.equal(p.el.setupNotifyBtn.hidden, false);
  assert.equal(p.el.setupNotifyText.textContent, 'Turn on notifications so you never miss a schedule.');

  const prompt = installEvent('accepted');
  await p.fire('beforeinstallprompt', prompt);
  assert.equal(prompt.prevented, true);
  assert.equal(p.el.setupInstallBtn.hidden, false);
  assert.equal(p.el.setupInstallText.textContent, 'Install the MSI app on this phone to open your schedule in one tap.');

  await p.click(p.el.setupNotifyBtn);
  assert.equal(p.el.setupStepNotify.dataset.state, 'done');
  assert.deepEqual(p.posts.map(([url]) => url), ['/user_account/push/subscribe']);
  assert.equal(p.open, true, 'one step done is not enough');

  await p.click(p.el.setupInstallBtn);
  assert.equal(prompt.prompted, true);
  assert.equal(p.el.setupStepInstall.dataset.state, 'done');
  assert.equal(p.open, false, 'hides as soon as both are done');
});

test('allowing notifications in Chrome and coming back also finishes the step', async () => {
  const p = phone({ standalone: true, permission: 'denied' });
  await p.settle();
  p.Notification.permission = 'granted';
  await p.visible();
  assert.equal(p.el.setupStepNotify.dataset.state, 'done');
});

test('blocked notifications keep the modal up until they are allowed in Chrome', async () => {
  const p = phone({ standalone: true, permission: 'denied' });
  await p.settle();
  assert.equal(p.open, true);
  assert.equal(p.el.setupStepNotify.dataset.state, 'blocked');
  // Still tappable: "check again" after allowing them in Chrome.
  assert.equal(p.el.setupNotifyBtn.hidden, false);
  assert.match(p.el.setupNotifyBtn.textContent, /check again/);
  assert.match(p.el.setupNotifyText.textContent, /Permissions › Notifications › Allow/);

  // The technician allows them in Chrome's settings and taps the button.
  p.Notification.permission = 'granted';
  await p.click(p.el.setupNotifyBtn);
  assert.equal(p.el.setupStepNotify.dataset.state, 'done');
  await p.runTimers();
  assert.equal(p.open, false);
});

test('saying no to notifications leaves the step to do', async () => {
  const p = phone({ standalone: true, askAnswer: 'default' });
  await p.settle();
  await p.click(p.el.setupNotifyBtn);
  assert.equal(p.el.setupStepNotify.dataset.state, 'todo');
  assert.equal(p.open, true);
});

test('a server failure leaves the step to do and the phone unsubscribed', async () => {
  const p = phone({ standalone: true, serverOk: false });
  await p.settle();
  await p.click(p.el.setupNotifyBtn);
  assert.equal(p.el.setupStepNotify.dataset.state, 'todo');
  assert.match(p.el.setupNotifyText.textContent, /database setup/);
  assert.equal(p.sub.unsubscribed, true);
  assert.equal(p.open, true);
});

test('when Chrome holds back installation, the menu steps show until it is installed', async () => {
  const p = phone({ permission: 'granted', subscribed: true, installedApps: [] });
  await p.settle();
  assert.equal(p.open, false, 'nothing missing is known yet');
  await p.runTimers();
  assert.equal(p.open, true);
  assert.equal(p.el.setupInstallBtn.hidden, false, 'the install step stays tappable');
  assert.equal(p.el.setupInstallConfirmBtn.hidden, false);
  assert.match(p.el.setupInstallText.textContent, /Add to Home screen/);

  await p.fire('appinstalled');
  assert.equal(p.el.setupStepInstall.dataset.state, 'done');
  await p.runTimers();
  assert.equal(p.open, false);
});

test('dismissing Chrome\'s install dialog falls back to the menu steps', async () => {
  const p = phone({ permission: 'granted', subscribed: true });
  await p.settle();
  await p.fire('beforeinstallprompt', installEvent('dismissed'));
  await p.click(p.el.setupInstallBtn);
  assert.equal(p.el.setupStepInstall.dataset.state, 'todo');
  assert.match(p.el.setupInstallText.textContent, /Add to Home screen/);
  assert.equal(p.open, true);
});

test('an installed app opened in the browser counts as installed', async () => {
  const installed = phone({ permission: 'granted', subscribed: true, installedApps: [{ platform: 'webapp' }] });
  await installed.settle();
  await installed.runTimers();
  assert.equal(installed.el.setupStepInstall.dataset.state, 'done');
  assert.equal(installed.open, false);

  // Chrome can't say: never claim it is installed. Show how, and let the
  // technician say it themselves.
  const unknown = phone({ permission: 'granted', subscribed: true, hasRelatedAppsApi: false });
  await unknown.settle();
  await unknown.runTimers();
  assert.equal(unknown.open, true);
  assert.equal(unknown.el.setupStepInstall.dataset.state, 'todo');
  assert.doesNotMatch(unknown.el.setupInstallText.textContent, /is installed/);
  assert.equal(unknown.el.setupInstallBtn.hidden, false);
  assert.equal(unknown.el.setupInstallConfirmBtn.hidden, false);
  await unknown.click(unknown.el.setupInstallConfirmBtn);
  assert.equal(unknown.el.setupStepInstall.dataset.state, 'done');
  await unknown.runTimers();
  assert.equal(unknown.open, false);
});

test('without push keys on the server only the install step is required', async () => {
  const p = phone({ pushKey: '', standalone: true });
  await p.settle();
  await p.runTimers();
  assert.equal(p.el.setupStepNotify.hidden, true);
  assert.equal(p.open, false);
  assert.equal(p.posts.length, 0);
});

test('if Chrome never answers whether the app is installed, the technician confirms it', async () => {
  const p = phone({ permission: 'granted', subscribed: true, installedApps: 'hang' });
  await p.settle();
  await p.runTimers(); // the 3-second wait for Chrome's install offer
  await p.runTimers(); // the 2-second limit on Chrome's answer
  assert.equal(p.el.setupStepInstall.dataset.state, 'todo');
  assert.equal(p.el.setupInstallConfirmBtn.hidden, false);
  await p.click(p.el.setupInstallConfirmBtn);
  assert.equal(p.el.setupStepInstall.dataset.state, 'done');
  await p.runTimers();
  assert.equal(p.open, false);
});

test('an installed app window counts whatever display mode the browser reports', async () => {
  for (const displayMode of ['minimal-ui', 'window-controls-overlay', 'fullscreen']) {
    const p = phone({ displayMode, permission: 'granted', subscribed: true });
    await p.settle();
    await p.runTimers();
    assert.equal(p.el.setupStepInstall.dataset.state, 'done', displayMode);
    assert.equal(p.open, false, displayMode);
  }
});

test('once both steps are done the reminder is gone for good, so the technician only sees the schedule', async () => {
  const data = {};
  const storage = { getItem: key => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); } };

  // First visit: notifications on, app not installed; the technician says it is.
  const first = phone({ permission: 'granted', subscribed: true, hasRelatedAppsApi: false, storage });
  await first.settle();
  await first.runTimers();
  assert.equal(first.open, true);
  await first.click(first.el.setupInstallConfirmBtn);
  assert.equal(first.open, false);

  // Next visit: nothing to set up, so the panel never appears, not even briefly.
  const next = phone({ permission: 'granted', subscribed: true, hasRelatedAppsApi: false, storage });
  let everOpened = false;
  Object.defineProperty(next.el.setupModal, 'hidden', { get: () => !everOpened && true, set: value => { if (!value) everOpened = true; } });
  await next.settle();
  await next.runTimers();
  assert.equal(next.el.setupStepInstall.dataset.state, 'done');
  assert.equal(everOpened, false);
});

test('a phone that finishes the Chrome install is remembered', async () => {
  const data = {};
  const storage = { getItem: key => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); } };
  const p = phone({ permission: 'granted', subscribed: true, storage });
  await p.settle();
  await p.fire('appinstalled');
  assert.equal(data['msi.appInstalled'], '1');
});

test('a finished step is removed from the reminder, leaving only what is still missing', async () => {
  const p = phone({ permission: 'granted', subscribed: true, hasRelatedAppsApi: false });
  await p.settle();
  await p.runTimers();
  assert.equal(p.el.setupStepNotify.dataset.state, 'done');
  assert.equal(p.el.setupStepNotify.hidden, true, 'notifications are on, so that row is gone');
  assert.equal(p.el.setupStepInstall.hidden, false, 'the install row is still there');
  assert.equal(p.open, true);

  await p.click(p.el.setupInstallConfirmBtn);
  assert.equal(p.el.setupStepInstall.hidden, true);
  assert.equal(p.open, false, 'both done: the whole reminder is gone');
});
