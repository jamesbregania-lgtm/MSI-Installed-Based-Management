require('dotenv').config();
const fs = require('fs');
const { addMachine } = require('../database/machines.store');
const { findClientById } = require('../database/clients.store');

const PLAN_PATH = process.argv[2];
if (!PLAN_PATH) {
  console.error('Usage: node encode-2026-installs.js <path-to-final_insert.json>');
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));

(async () => {
  let ok = 0, failed = 0;
  for (const row of rows) {
    const client = await findClientById(row.clientId);
    if (!client) {
      console.error(`SKIP row ${row.orig_row}: client "${row.clientId}" not found`);
      failed++;
      continue;
    }

    const machine = {
      clientId: row.clientId,
      clientName: client.name,
      location: client.location,
      unit: row.unit,
      model: row.model,
      serialNo: row.serialNo,
      dateInstalled: row.dateInstalled,
      runningHours: 0,
      status: 'Active',
      description: 'N/A',
      submittedBy: 'Data Encoder Two',
      technicians: row.technicians,
      reports: [
        {
          date: row.dateInstalled,
          submittedBy: 'Data Encoder Two',
          updateIndex: null,
          technicians: [],
          problem: 'N/A',
          action: 'N/A',
          recommendation: 'N/A',
          refNo: row.refNo
        }
      ]
    };

    try {
      await addMachine(machine);
      console.log(`OK   row ${row.orig_row}: ${row.serialNo} (${client.name}, ${row.unit}/${row.model})`);
      ok++;
    } catch (err) {
      console.error(`FAIL row ${row.orig_row}: ${row.serialNo} -> ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone. Inserted: ${ok}, Failed: ${failed}, Total attempted: ${rows.length}`);
})();
