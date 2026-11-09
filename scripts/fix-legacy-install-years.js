/**
 * One-off: repair three installation dates whose year is wrong.
 *
 * Two of them lost the "20" prefix when they were keyed in — 0012 for 2012,
 * 0026 for 2025 — and the third, 2000, was a placeholder typed against a report
 * that says outright "No Indicated date of installation". All three were read
 * as pre-2026 installs, so they sat inside the legacy grandfather window and
 * reported no maintenance warning; a date of year 12 also renders a maintenance
 * due date of 1914 in the machine table.
 *
 * The year the user supplied for each is corroborated by the serial, whose 3rd
 * and 4th characters carry the install year — CN|12|131215 is 2012, FR|15|330208
 * is 2015, PL|25|280077 is 2025 — the same convention fix-future-install-years.js
 * relies on. The script refuses to write when the two disagree.
 *
 * Both the machine row and its installation report hold the date, so each
 * machine needs two changes. Only the year moves; day and month are left as
 * they are, since nothing here gives a better value for them.
 *
 *   node scripts/fix-legacy-install-years.js           # dry run
 *   node scripts/fix-legacy-install-years.js --apply   # performs the writes
 */

require('dotenv').config();
const supabase = require('../database/supabase');

const APPLY = process.argv.includes('--apply');
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/;

// serial -> the correct install year, as confirmed by the user.
const CORRECTIONS = {
  CN12131215: 2012,
  FR15330208: 2015,
  PL25280077: 2025
};

function parseDmy(value) {
  const m = String(value || '').trim().match(DMY);
  if (!m) return null;
  return { day: m[1], month: m[2], year: Number(m[3]) };
}

/** CN|12|131215 -> 2012. Characters 3 and 4 of the serial are the install year. */
function installYearFromSerial(serial) {
  const digits = String(serial || '').slice(2, 4);
  if (!/^\d{2}$/.test(digits)) return null;
  return 2000 + Number(digits);
}

(async () => {
  const serials = Object.keys(CORRECTIONS);
  const { data, error } = await supabase
    .from('machines')
    .select('id,serial_no,client_name,date_installed,reports')
    .in('serial_no', serials);
  if (error) throw error;

  let changed = 0;
  let skipped = 0;

  for (const serial of serials) {
    const rows = (data || []).filter(r => r.serial_no === serial);
    if (rows.length !== 1) {
      console.log(`${serial}: expected exactly 1 machine, found ${rows.length} — SKIPPED.\n`);
      skipped++;
      continue;
    }

    const row = rows[0];
    const wanted = CORRECTIONS[serial];
    const fromSerial = installYearFromSerial(serial);

    if (fromSerial !== wanted) {
      console.log(`${serial}: serial implies ${fromSerial} but ${wanted} was given — SKIPPED, needs a human.\n`);
      skipped++;
      continue;
    }

    const installed = parseDmy(row.date_installed);
    if (!installed) {
      console.log(`${serial}: install date ${JSON.stringify(row.date_installed)} is not d/m/y — SKIPPED.\n`);
      skipped++;
      continue;
    }

    if (installed.year === wanted) {
      console.log(`${serial}: already ${wanted}, nothing to do.\n`);
      continue;
    }

    const nextInstalled = `${installed.day}/${installed.month}/${wanted}`;
    const patch = { date_installed: nextInstalled };

    console.log(`${serial}  (${row.client_name})`);
    console.log(`   date_installed      : ${row.date_installed}  ->  ${nextInstalled}`);

    // The installation report is the one with no updateIndex.
    const reports = Array.isArray(row.reports) ? row.reports : [];
    const idx = reports.findIndex(r => r.updateIndex === null || r.updateIndex === undefined);
    const report = idx >= 0 ? parseDmy(reports[idx].date) : null;

    if (report && report.year === installed.year) {
      const nextReport = `${report.day}/${report.month}/${wanted}`;
      console.log(`   install report date : ${reports[idx].date}  ->  ${nextReport}`);
      patch.reports = reports.map((r, i) => (i === idx ? { ...r, date: nextReport } : r));
    } else if (report) {
      console.log(`   install report date : ${reports[idx].date}  (left alone, year differs from the machine row)`);
    } else {
      console.log(`   install report date : (none found)`);
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
