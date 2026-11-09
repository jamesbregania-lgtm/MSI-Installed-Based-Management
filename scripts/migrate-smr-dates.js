/**
 * One-off: lift the bare dates out of `description` into the new smr_date
 * fields, leaving `description` untouched.
 *
 * The legacy values are a mix of mm/dd/yyyy and dd/mm/yyyy with nothing marking
 * which is which, so the convention is worked out per value:
 *
 *   1. the value decides it itself  — 13/05 can only be dd/mm, 05/13 only mm/dd
 *   2. otherwise, an unambiguous sibling on the same machine decides it
 *   3. otherwise it is left alone and listed, because guessing 03/12 wrong
 *      moves a service date by nine months
 *
 * --assume-mdy adds a fourth step: read anything still undecided as mm/dd.
 * That was the owner's stated convention for these entries, and it matches the
 * data (93 values can only be mm/dd against 5 that can only be dd/mm). It does
 * NOT override steps 1 and 2 — a value that can only be dd/mm stays dd/mm.
 *
 * `description` is deliberately NOT cleared. The original string stays put, so
 * a wrong reading can be spotted and corrected against the source.
 *
 * Idempotent: a value already converted is simply rewritten to the same ISO.
 *
 *   node scripts/migrate-smr-dates.js                        # dry run
 *   node scripts/migrate-smr-dates.js --apply                # writes
 *   node scripts/migrate-smr-dates.js --assume-mdy --apply   # writes, incl. ambiguous
 */

require('dotenv').config();
const supabase = require('../database/supabase');

const APPLY = process.argv.includes('--apply');
const ASSUME_MDY = process.argv.includes('--assume-mdy');
const BARE_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function convention(value) {
  const m = String(value || '').trim().match(BARE_DATE);
  if (!m) return null;
  const first = Number(m[1]);
  const second = Number(m[2]);
  if (first > 12 && second <= 12) return 'dmy';
  if (second > 12 && first <= 12) return 'mdy';
  return null; // both <= 12, undecidable on its own
}

function toIso(value, conv) {
  const m = String(value || '').trim().match(BARE_DATE);
  if (!m || !conv) return null;
  const first = Number(m[1]);
  const second = Number(m[2]);
  const year = m[3];
  const day = conv === 'dmy' ? first : second;
  const month = conv === 'dmy' ? second : first;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Reject a date the calendar doesn't have, e.g. 31 February.
  const check = new Date(Number(year), month - 1, day);
  if (check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return iso;
}

function isBareDate(value) {
  return BARE_DATE.test(String(value || '').trim());
}

(async () => {
  const { data: rows, error } = await supabase.from('machines').select('*').order('id');
  if (error) throw error;

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} machines\n`);

  const today = new Date(); today.setHours(23, 59, 59, 999);
  const skipped = [];
  const futureDated = [];
  const planned = [];
  let converted = 0;
  let assumedCount = 0;

  for (const row of rows) {
    const updates = Array.isArray(row.updates) ? row.updates : [];

    // Collect every bare date on this machine, then let the unambiguous ones
    // settle the convention for the rest.
    const candidates = [];
    if (isBareDate(row.description)) candidates.push({ level: 'machine', value: String(row.description).trim() });
    updates.forEach((u, i) => {
      if (isBareDate(u && u.description)) candidates.push({ level: 'update', index: i, value: String(u.description).trim() });
    });
    if (!candidates.length) continue;

    const found = new Set(candidates.map(c => convention(c.value)).filter(Boolean));
    const machineConvention = found.size === 1 ? [...found][0] : null;

    const patch = {};
    const nextUpdates = updates.map(u => ({ ...u }));
    let touched = false;

    for (const c of candidates) {
      const ownConvention = convention(c.value);
      const conv = ownConvention || machineConvention || (ASSUME_MDY ? 'mdy' : null);
      const assumed = !ownConvention && !machineConvention && Boolean(conv);
      const where = `${row.serial_no} ${c.level === 'machine' ? 'install' : 'upd#' + c.index}`;

      if (!conv) {
        skipped.push(`${c.value}  [${where}]  reason: mm/dd vs dd/mm undecidable`);
        continue;
      }

      const iso = toIso(c.value, conv);
      if (!iso) {
        skipped.push(`${c.value}  [${where}]  reason: not a real calendar date`);
        continue;
      }

      if (new Date(iso) > today) futureDated.push(`${c.value} -> ${iso}  [${where}]`);

      if (c.level === 'machine') {
        // smr_date only. `description` is the machine's CURRENT note, rewritten
        // by every update, so its date is the most recent SMR — not the
        // installation's. Writing it to initial_smr_date as well dated a 2017
        // install by a 2025 service visit. The install's own SMR was never
        // recorded anywhere, so initial_smr_date stays empty and the install
        // row falls back to date_installed. See fix-initial-smr-date.js.
        patch.smr_date = iso;
      } else {
        nextUpdates[c.index].smrDate = iso;
        touched = true;
      }
      converted++;
      if (assumed) assumedCount++;
      planned.push(`${c.value} -> ${iso}  (${conv}${assumed ? ', assumed' : ''})  [${where}]`);
    }

    if (touched) patch.updates = nextUpdates;
    if (!Object.keys(patch).length) continue;

    if (APPLY) {
      const { error: upErr } = await supabase.from('machines').update(patch).eq('id', row.id);
      if (upErr) {
        console.error(`  FAILED ${row.serial_no}: ${upErr.message}`);
        process.exitCode = 1;
      }
    }
  }

  console.log('--- planned conversions (first 30) ---');
  planned.slice(0, 30).forEach(s => console.log('   ', s));
  if (planned.length > 30) console.log(`    … and ${planned.length - 30} more`);

  console.log(`\n--- skipped, left in description (${skipped.length}) ---`);
  skipped.forEach(s => console.log('   ', s));

  if (futureDated.length) {
    console.log(`\n--- converted but land in the future (${futureDated.length}) — worth a look ---`);
    futureDated.forEach(s => console.log('   ', s));
  }

  console.log(`\nconverted: ${converted} (${assumedCount} read as mm/dd by assumption)   skipped: ${skipped.length}`);
  console.log(APPLY ? 'Changes written.' : 'Nothing written. Re-run with --apply to perform it.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
