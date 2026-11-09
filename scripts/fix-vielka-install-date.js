/**
 * One-off: correct the installation report date on E319250216 (Vielka Soap).
 *
 * The machine row says the unit was installed 14/06/2019; its installation
 * report says 14/06/2031. 2031 has not happened, so the report carries a typo
 * — a 1 struck instead of a 9 — and the machine row holds the right year.
 *
 * This matters now because of the install-report classification fix: until
 * that landed the dashboard used the machine row's date and never read the
 * report's, so the bad value was invisible. Reading the report correctly would
 * put this installation in 2031 unless the date is corrected first.
 *
 * Deliberately narrow: one row, one field, and only when it still reads
 * 14/06/2031, so re-running after the fix does nothing.
 *
 *   node scripts/fix-vielka-install-date.js           # dry run
 *   node scripts/fix-vielka-install-date.js --apply   # performs the write
 */

require('dotenv').config();
const supabase = require('../database/supabase');

const APPLY = process.argv.includes('--apply');
const SERIAL = 'E319250216';
const WRONG = '14/06/2031';
const RIGHT = '14/06/2019';

(async () => {
  const { data, error } = await supabase
    .from('machines')
    .select('id,serial_no,client_name,date_installed,reports')
    .eq('serial_no', SERIAL);
  if (error) throw error;

  if (!data.length) {
    console.log(`No machine with serial ${SERIAL}. Nothing to do.`);
    return;
  }

  for (const row of data) {
    const reports = Array.isArray(row.reports) ? row.reports : [];
    const idx = reports.findIndex(r => r.updateIndex === null || r.updateIndex === undefined);

    if (idx < 0) {
      console.log(`${row.serial_no}: no installation report found — skipped.`);
      continue;
    }

    const current = String(reports[idx].date || '').trim();
    console.log(`${row.serial_no} (${row.client_name})`);
    console.log(`   machine.date_installed : ${row.date_installed}`);
    console.log(`   install report date    : ${current}`);

    if (current !== WRONG) {
      console.log(`   already ${current} — nothing to change.\n`);
      continue;
    }

    const next = reports.map((r, i) => (i === idx ? { ...r, date: RIGHT } : r));
    console.log(`   -> would set the report date to ${RIGHT}\n`);

    if (!APPLY) continue;

    const { error: upErr } = await supabase
      .from('machines')
      .update({ reports: next })
      .eq('id', row.id);
    if (upErr) {
      console.error(`   FAILED: ${upErr.message}`);
      process.exitCode = 1;
    } else {
      console.log(`   written.\n`);
    }
  }

  console.log(APPLY ? 'Done.' : 'Nothing written. Re-run with --apply to perform it.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
