/**
 * Corrective one-off for a mistake in migrate-smr-dates.js.
 *
 * That script copied the machine-level `description` date into BOTH `smr_date`
 * and `initial_smr_date`. Only the first was right. `description` is the
 * machine's CURRENT note — every service update overwrites it — so its final
 * value is the most recent SMR, not the installation's.
 *
 * The consequence: the monitoring install row reads `initial_smr_date`, so a
 * unit installed in 2017 was being dated by a 2025 service visit, landing its
 * installation in the wrong period on every card that scopes by date.
 *
 * There is no better source to correct it from — `initial_description` holds a
 * bare date on zero machines, so the installation's own SMR date was never
 * recorded. The right value is therefore empty: with `initial_smr_date` blank
 * the install row falls back to `date_installed`, which is the real, known
 * installation date.
 *
 * `smr_date` is left alone; as "most recent SMR" it is correct.
 *
 *   node scripts/fix-initial-smr-date.js           # dry run
 *   node scripts/fix-initial-smr-date.js --apply   # performs the writes
 */

require('dotenv').config();
const supabase = require('../database/supabase');

const APPLY = process.argv.includes('--apply');

(async () => {
  const { data, error } = await supabase
    .from('machines')
    .select('id,serial_no,date_installed,smr_date,initial_smr_date')
    .order('id');
  if (error) throw error;

  const affected = data.filter(r => String(r.initial_smr_date || '').trim());
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${data.length} machines, ${affected.length} carry an initial_smr_date\n`);

  affected.slice(0, 20).forEach(r => {
    console.log(`  ${String(r.serial_no).padEnd(24)} installed ${String(r.date_installed).padEnd(12)} initial_smr_date ${r.initial_smr_date} -> cleared`);
  });
  if (affected.length > 20) console.log(`  … and ${affected.length - 20} more`);

  if (!APPLY) {
    console.log(`\nNothing written. Re-run with --apply to clear ${affected.length} values.`);
    return;
  }

  let done = 0;
  for (const row of affected) {
    const { error: upErr } = await supabase
      .from('machines')
      .update({ initial_smr_date: '' })
      .eq('id', row.id);
    if (upErr) {
      console.error(`  FAILED ${row.serial_no}: ${upErr.message}`);
      process.exitCode = 1;
    } else done++;
  }
  console.log(`\ncleared: ${done} of ${affected.length}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
