/**
 * One-off: correct installation dates typed with a swapped year.
 *
 * Five Monde units were stored as 2032. The serial number carries the real
 * install year in its 3rd and 4th characters — E3|23|050099 is code "E3",
 * year 2023 — so 2032 is a digit swap of 2023, the same slip as the 2031/2019
 * typo already corrected on E319250216.
 *
 * Both the machine row and its installation report hold the date, so each
 * machine needs two changes.
 *
 * Narrow on purpose: only a machine whose installation date is still in the
 * future, only when the serial yields a plausible past year, and only the year
 * portion — day and month are left exactly as they are. Re-running after the
 * fix does nothing, because no date is future-dated any more.
 *
 *   node scripts/fix-future-install-years.js           # dry run
 *   node scripts/fix-future-install-years.js --apply   # performs the writes
 */

require('dotenv').config();
const supabase = require('../database/supabase');

const APPLY = process.argv.includes('--apply');
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function parseDmy(value) {
  const m = String(value || '').trim().match(DMY);
  if (!m) return null;
  return { day: m[1], month: m[2], year: Number(m[3]), text: m[0] };
}

/** E3|23|050099 -> 2023. Characters 3 and 4 of the serial are the install year. */
function installYearFromSerial(serial) {
  const digits = String(serial || '').slice(2, 4);
  if (!/^\d{2}$/.test(digits)) return null;
  const year = 2000 + Number(digits);
  const thisYear = new Date().getFullYear();
  return year >= 2005 && year <= thisYear ? year : null;
}

function withYear(parsed, year) {
  return `${parsed.day}/${parsed.month}/${year}`;
}

(async () => {
  const { data, error } = await supabase
    .from('machines')
    .select('id,serial_no,client_name,date_installed,reports')
    .order('id');
  if (error) throw error;

  const today = new Date(); today.setHours(23, 59, 59, 999);
  let changed = 0, skipped = 0;

  for (const row of data) {
    const installed = parseDmy(row.date_installed);
    if (!installed) continue;

    const asDate = new Date(installed.year, Number(installed.month) - 1, Number(installed.day));
    if (asDate <= today) continue; // not future-dated, nothing to correct

    const year = installYearFromSerial(row.serial_no);
    if (!year) {
      console.log(`${row.serial_no}: future date ${row.date_installed} but the serial gives no usable year — SKIPPED, needs a human.\n`);
      skipped++;
      continue;
    }

    const reports = Array.isArray(row.reports) ? row.reports : [];
    const idx = reports.findIndex(r => r.updateIndex === null || r.updateIndex === undefined);
    const report = idx >= 0 ? parseDmy(reports[idx].date) : null;

    const nextInstalled = withYear(installed, year);
    const patch = { date_installed: nextInstalled };

    console.log(`${row.serial_no}  (${row.client_name})`);
    console.log(`   serial says install year ${year}`);
    console.log(`   date_installed        : ${row.date_installed}  ->  ${nextInstalled}`);

    if (report) {
      const nextReport = withYear(report, year);
      console.log(`   install report date   : ${reports[idx].date}  ->  ${nextReport}`);
      patch.reports = reports.map((r, i) => (i === idx ? { ...r, date: nextReport } : r));
    } else {
      console.log(`   install report date   : (none found)`);
    }
    console.log('');

    changed++;
    if (!APPLY) continue;

    const { error: upErr } = await supabase.from('machines').update(patch).eq('id', row.id);
    if (upErr) {
      console.error(`   FAILED: ${upErr.message}\n`);
      process.exitCode = 1;
    }
  }

  console.log(`machines to correct: ${changed}${skipped ? `   skipped: ${skipped}` : ''}`);
  console.log(APPLY ? 'Changes written.' : 'Nothing written. Re-run with --apply to perform it.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
