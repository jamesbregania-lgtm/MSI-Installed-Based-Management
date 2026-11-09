require('dotenv').config();
const fs = require('fs');
const supabase = require('../database/supabase');
const { correctHistoryEntry } = require('../database/machines.store');

const PLAN_PATH = process.argv[2];
if (!PLAN_PATH) {
  console.error('Usage: node fix-report-technicians.js <path-to-final_insert.json>');
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));

(async () => {
  let ok = 0, failed = 0;
  for (const row of rows) {
    const { data: machine, error } = await supabase
      .from('machines')
      .select('id, reports')
      .eq('serial_no', row.serialNo)
      .maybeSingle();

    if (error || !machine) {
      console.error(`SKIP ${row.serialNo}: not found (${error ? error.message : 'no match'})`);
      failed++;
      continue;
    }

    try {
      await correctHistoryEntry(
        machine.id,
        { type: 'install' },
        { technicians: row.technicians },
        'Data Encoder Two'
      );
      console.log(`OK   ${row.serialNo} (machine id ${machine.id}) -> technicians: ${JSON.stringify(row.technicians)}`);
      ok++;
    } catch (err) {
      console.error(`FAIL ${row.serialNo} (machine id ${machine.id}): ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone. Fixed: ${ok}, Failed: ${failed}, Total: ${rows.length}`);
})();
