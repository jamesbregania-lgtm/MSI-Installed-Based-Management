/**
 * One-off: refile every 5800 machine recorded under DOD as LCIJ.
 *
 * 5800 is an LCIJ model. It was listed under both DOD and LCIJ in the parts
 * catalog, so it could be picked either way on Add Printer, and 26 of the 27
 * 5800 machines were encoded as DOD. The catalog entry under DOD has been
 * removed, which stops new ones — this corrects the rows already stored.
 *
 * Only the `unit` column changes. Model, serial, client, dates, updates and
 * reports are untouched: the unit was mislabelled, the service history is real.
 *
 * Running hours are unaffected either way. 5800 is exempt by model (see
 * public/js/shared/running-hours.js), and DOD is exempt by unit, so every one
 * of these rows reads 0 before and after.
 *
 * Deliberately narrow: matched on unit=DOD AND model=5800, so re-running after
 * the move finds nothing. Writes a JSON backup of the affected rows first.
 *
 *   node scripts/refile-5800-dod-to-lcij.js           # dry run, changes nothing
 *   node scripts/refile-5800-dod-to-lcij.js --apply   # performs the write
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../database/supabase');

const APPLY = process.argv.includes('--apply');
const FROM_UNIT = 'DOD';
const TO_UNIT = 'LCIJ';

// "5800", "5800 " and "58-00" are the same model; "5800-S" is not.
const modelKey = value => String(value == null ? '' : value).toUpperCase().replace(/[\s-]+/g, '');
const unitKey = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase();

(async () => {
  const { data, error } = await supabase
    .from('machines')
    .select('id, client_name, unit, model, serial_no, date_installed, running_hours')
    .order('id');
  if (error) throw error;

  const targets = (data || []).filter(
    row => unitKey(row.unit) === FROM_UNIT && modelKey(row.model) === '5800'
  );

  if (!targets.length) {
    console.log(`No ${FROM_UNIT} 5800 rows found. Nothing to do.`);
    return;
  }

  console.log(`${targets.length} machine row(s) to refile ${FROM_UNIT} -> ${TO_UNIT}:\n`);
  for (const row of targets) {
    console.log(
      `  id=${String(row.id).padStart(4)}  ${String(row.serial_no || '').padEnd(12)}` +
      `  ${String(row.model || '').padEnd(6)}  hrs=${row.running_hours}` +
      `  ${row.client_name || ''}  (installed ${row.date_installed || '—'})`
    );
  }

  const nonZeroHours = targets.filter(row => Number(row.running_hours) !== 0);
  if (nonZeroHours.length) {
    console.log(
      `\nNote: ${nonZeroHours.length} row(s) carry non-zero running hours. ` +
      'Both DOD and LCIJ 5800 are hour-exempt, so this move does not change them.'
    );
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to perform the write.');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(__dirname, '..', 'backups', `machines-5800-dod-to-lcij-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(targets, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  const ids = targets.map(row => row.id);
  const { data: updated, error: updateError } = await supabase
    .from('machines')
    .update({ unit: TO_UNIT })
    .in('id', ids)
    .select('id');
  if (updateError) throw updateError;

  console.log(`Refiled ${updated ? updated.length : 0} row(s) to ${TO_UNIT}.`);
})().catch(err => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
