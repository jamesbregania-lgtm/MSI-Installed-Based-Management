/**
 * Entry rules for machine records, shared by the asset and client routes so
 * the server enforces the same thing the forms show.
 *
 * Applied only where a value is genuinely new input — never to the serial
 * number and install date that the client routes resubmit as lookup keys for
 * an existing machine, and never to the history an update resubmits verbatim.
 * Records predating these rules stay editable.
 */

const SERIAL_LENGTH = 10;

/**
 * A date is only "in the future" once it is more than this far past the end of
 * the server's own day. The forms stamp entries with the *browser's* calendar
 * date, and the server need not sit in the same timezone: a Manila technician
 * filing at 7am is still on yesterday's date to a server running in UTC, and
 * was being told a same-day report was in the future. A day of slack absorbs
 * any offset on earth while still catching what this check is actually for —
 * a mistyped year like 2032.
 */
const FUTURE_GRACE_MS = 24 * 60 * 60 * 1000;

function normalizeSerial(value) {
  return String(value || '').trim();
}

function serialLengthError(value) {
  const serial = normalizeSerial(value);
  if (!serial) return 'Serial number is required.';
  if (serial.length === SERIAL_LENGTH) return null;
  return `Serial number must be exactly ${SERIAL_LENGTH} characters — "${serial}" has ${serial.length}.`;
}

/**
 * Builds a date only when the parts describe a real calendar day. `new Date`
 * on its own rolls an impossible one forward — month 16 becomes April of the
 * next year, 31 April becomes 1 May — which silently turned unreadable legacy
 * values into future dates.
 */
function buildEntryDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

/**
 * Accepts the shapes the forms and the store use: yyyy-mm-dd and dd/mm/yyyy.
 *
 * Slash dates come in both orders in practice — the forms write dd/mm/yyyy,
 * but a chunk of the legacy rows were saved mm/dd/yyyy. dd/mm wins whenever it
 * describes a real day, and mm/dd is the fallback for the ones it cannot
 * ("09/16/2026"), rather than letting month 16 roll the year forward.
 */
function parseEntryDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return buildEntryDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    return buildEntryDate(year, second, first) || buildEntryDate(year, first, second);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * An unparseable date is not reported as future — that is a separate problem,
 * and the existing required-field checks already cover a missing one.
 */
function isFutureDate(value) {
  const parsed = parseEntryDate(value);
  if (!parsed) return false;

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return parsed.getTime() > endOfToday.getTime() + FUTURE_GRACE_MS;
}

function futureDateError(value, label = 'Date') {
  return isFutureDate(value) ? `${label} cannot be in the future.` : null;
}

module.exports = {
  SERIAL_LENGTH,
  serialLengthError,
  parseEntryDate,
  isFutureDate,
  futureDateError
};
