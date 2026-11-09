const webpush = require('web-push');
const {
  listSubscriptionsForUser,
  deleteSubscriptionsByEndpoint
} = require('../database/push-subscriptions.store');

// VAPID keys identify this server to the phones' push services. Generate a
// pair once with `npx web-push generate-vapid-keys` and set them in the
// hosting panel. Without them, notifications are simply switched off.
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:noreply@matsoltechnical.com').trim();

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } catch (err) {
    console.error('[push] VAPID keys are invalid; notifications are off:', err.message);
  }
}

function isPushConfigured() {
  return configured;
}

function getPushPublicKey() {
  return configured ? VAPID_PUBLIC_KEY : '';
}

// A push that can't be delivered within a day is no longer useful news.
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const PUSH_TIMEOUT_MS = 8000;

/**
 * Send one notification to every phone `username` turned notifications on
 * for. Never throws — a failed push must not fail the admin's save. Returns
 * how many phones accepted it (0 when off, not set up, or no phones).
 */
async function notifyUser(username, notification) {
  if (!configured) return 0;
  let subscriptions;
  try {
    subscriptions = await listSubscriptionsForUser(username);
  } catch (err) {
    console.error('[push] could not load subscriptions:', err.message || err);
    return 0;
  }
  if (!subscriptions.length) return 0;

  const payload = JSON.stringify(notification);
  const gone = [];
  const results = await Promise.all(subscriptions.map(sub =>
    webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      payload,
      { TTL: PUSH_TTL_SECONDS, urgency: 'high', timeout: PUSH_TIMEOUT_MS }
    ).then(() => true, err => {
      // 404/410: the phone unsubscribed or the browser data was cleared.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) gone.push(sub.endpoint);
      else console.error(`[push] send to ${username} failed:`, err && (err.statusCode || err.message));
      return false;
    })
  ));

  if (gone.length) {
    await deleteSubscriptionsByEndpoint(gone).catch(err => {
      console.error('[push] could not remove expired subscriptions:', err.message || err);
    });
  }
  return results.filter(Boolean).length;
}

// "Wed, Nov 5" from "2026-11-05". Dates are plain calendar dates, so they are
// formatted in UTC to stop the server's own time zone shifting the day.
function formatScheduleDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

function formatScheduleTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The notification a technician gets for a schedule event. */
function scheduleNotification(kind, schedule) {
  const titles = {
    created: 'New schedule',
    changed: 'Schedule changed',
    cancelled: 'Schedule cancelled',
    reopened: 'Schedule back on',
    removed: 'Schedule removed'
  };
  const when = [formatScheduleDate(schedule.date), formatScheduleTime(schedule.time)].filter(Boolean).join(', ');
  const place = [schedule.clientName, schedule.location].filter(Boolean).join(' · ');
  return {
    title: titles[kind] || 'Schedule update',
    body: `${place}\n${when}`,
    // One notification per schedule on the phone: a later change replaces
    // the earlier one instead of stacking up.
    tag: `schedule-${schedule.id}`,
    url: '/user_account#schedule'
  };
}

module.exports = {
  isPushConfigured,
  getPushPublicKey,
  notifyUser,
  scheduleNotification
};
