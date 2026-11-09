require('dotenv').config();
const supabase = require('../database/supabase');

// Frequency -> expiry mapping:
//   Quarterly -> expiry_months: 3
//   Monthly   -> expiry_months: 1
//   Weekly    -> expiry_days: 7 (critical parts; image notes them as condition-triggered,
//                but a 7-day cadence is used here as directed)
const QUARTERLY = { expiry_months: 3, expiry_hours: null, expiry_days: null };
const MONTHLY = { expiry_months: 1, expiry_hours: null, expiry_days: null };
const WEEKLY = { expiry_months: null, expiry_hours: null, expiry_days: 7 };

const TTO_PARTS = [
  // Basic parts
  { part_number: 'ENM10053110', description: 'Movement roller assembly', model_series: 'X40', ...QUARTERLY },
  { part_number: 'ENM10053157', description: 'Cassette locating pin', model_series: 'X40', ...QUARTERLY },
  { part_number: '10029510', description: 'Locating roller assembly', model_series: 'X40, X45, X65', ...QUARTERLY },
  { part_number: 'ENM10054399', description: 'Tension roller and slide kit', model_series: 'X40', ...QUARTERLY },
  { part_number: 'ENM10053305', description: 'Ribbon supply and rewind assemblies 32mm', model_series: 'X40, X45', ...MONTHLY },
  { part_number: 'ENM10053306', description: 'Ribbon supply and rewind assemblies 53mm', model_series: 'X60', ...MONTHLY },
  { part_number: '10029512', description: 'Movement roller assembly', model_series: 'X60', ...QUARTERLY },
  { part_number: '10029511', description: 'Tension sensor roller assembly', model_series: 'X60', ...QUARTERLY },
  { part_number: '5210989', description: 'Linear guide rail and carriage assembly', model_series: 'X60', ...QUARTERLY },
  { part_number: 'ENM10041552', description: 'Cassette locating pin', model_series: 'X60', ...QUARTERLY },
  { part_number: '10041551', description: 'Pneumatic print solenoid assembly', model_series: 'X40', ...MONTHLY },
  { part_number: 'ENM10064469', description: 'Pneumatic prime solenoid assembly', model_series: 'X40', ...MONTHLY },
  { part_number: '10056464', description: 'Brake grommets', model_series: 'X30, X40, X45, X60', ...MONTHLY },
  { part_number: 'ENM10073411', description: 'Spool body waste assembly', model_series: 'X30', ...QUARTERLY },
  { part_number: 'ENM10073413', description: 'Spool body waste assembly', model_series: 'X30', ...QUARTERLY },
  { part_number: 'ENM10041552', description: 'Pneumatic kit', model_series: 'X60', ...QUARTERLY },
  { part_number: 'EN5686443', description: 'Printer power and signal cable 3.0m', model_series: 'X40, X60', ...QUARTERLY },
  { part_number: 'ENM10070850', description: 'Support pin X2', model_series: 'X30', ...QUARTERLY },
  { part_number: 'ENM10073399', description: 'Cassette assembly RH (Right hand)', model_series: 'X30', ...QUARTERLY },
  { part_number: 'ENM10070784', description: 'Cassette guide pin X2', model_series: 'X30', ...QUARTERLY },
  { part_number: 'ENM10069285', description: 'Cassette assembly LH (Left hand)', model_series: 'X30', ...QUARTERLY },
  // Critical parts
  { part_number: 'ENM10104643', description: 'TTO X series printhead 32mm integrated flex', model_series: 'X40', ...WEEKLY },
  { part_number: 'ENM10104642', description: 'TTO X series printhead 53mm integrated flex', model_series: 'X60', ...WEEKLY },
  { part_number: 'ENM10041170', description: 'Print module assembly', model_series: 'X40, X60', ...WEEKLY },
  { part_number: 'ENM10069361', description: 'Printhead assembly', model_series: 'X30', ...WEEKLY },
  { part_number: 'ENM10063468', description: 'Main PCB', model_series: 'X30', ...QUARTERLY },
  { part_number: 'ENM10073517', description: 'Guide block assembly (LH printer)', model_series: 'X30', ...QUARTERLY },
  { part_number: 'ENM10073518', description: 'Guide block assembly (RH printer)', model_series: 'X30', ...QUARTERLY }
].map(p => ({ ...p, unit: 'TTO' }));

(async () => {
  const { error: delError, count: delCount } = await supabase
    .from('parts_catalog')
    .delete({ count: 'exact' })
    .ilike('unit', 'TTO');
  if (delError) {
    console.error('DELETE FAILED', delError);
    process.exit(1);
  }
  console.log(`Deleted ${delCount ?? 0} existing TTO row(s).`);

  const { data: inserted, error: insError } = await supabase
    .from('parts_catalog')
    .insert(TTO_PARTS)
    .select('part_number, description, model_series, expiry_months, expiry_hours, expiry_days');
  if (insError) {
    console.error('INSERT FAILED', insError);
    process.exit(1);
  }
  console.log(`Inserted ${inserted.length} TTO row(s).`);
  console.log(JSON.stringify(inserted, null, 2));
})();
