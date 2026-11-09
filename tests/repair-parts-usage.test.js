const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildRepairPartsUsage } = require('../lib/repair-parts-usage');

// Repair Parts Monitoring ranks the parts picked under "Parts Used" on Repair
// activities, per unit type, inside the selected Show Data For range.

const day = d => new Date(`${d}T09:00:00`).getTime();
const repair = (unitName, modelName, date, repairParts) =>
  ({ activityKind: 'repair', unitName, modelName, dateSort: day(date), repairParts });

const rows = [
  repair('CIJ', '9030', '2026-11-06', ['ENM 38941 GUTTER BLOCK', 'ENM 10114562 FILTER']),
  repair('CIJ', '9040', '2026-11-06', ['enm 38941 gutter block']),
  repair('CIJ', '9030', '2026-11-05', ['ENM 38941 GUTTER BLOCK', 'ENM 38941 GUTTER BLOCK']),
  repair('LASER', 'L1', '2026-11-06', ['LENS']),
  repair('CIJ', '9030', '2026-10-01', ['OLD MONTH PART']),
  repair('CIJ', '9030', '2026-11-06', []),
  { activityKind: 'cannibalize', unitName: 'CIJ', modelName: '9030', dateSort: day('2026-11-06'), repairParts: ['NOT A REPAIR'] },
  { activityKind: 'maintenance', unitName: 'CIJ', modelName: '9030', dateSort: day('2026-11-06') }
];

test('groups by unit type, ranks parts by use and counts a part once per repair', () => {
  const range = { start: new Date('2026-11-01T00:00:00'), end: new Date('2026-11-30T23:59:59') };
  const usage = buildRepairPartsUsage(rows, range);
  assert.deepEqual(usage.groups.map(g => g.unit), ['CIJ', 'LASER']);
  const cij = usage.groups[0];
  assert.deepEqual(cij.parts.map(p => [p.name, p.count]), [
    ['ENM 38941 GUTTER BLOCK', 3],
    ['ENM 10114562 FILTER', 1]
  ]);
  assert.equal(cij.total, 4);
  assert.equal(cij.repairs, 3);
  assert.deepEqual(cij.parts[0].models, [{ model: '9030', count: 2 }, { model: '9040', count: 1 }]);
  assert.equal(usage.repairs, 4, 'repairs with no parts are not counted');
  assert.equal(usage.totalUsed, 5);
  assert.ok(!JSON.stringify(usage).includes('NOT A REPAIR'), 'only Repair activities count');
});

test('follows the selected date range', () => {
  const today = { start: new Date('2026-11-06T00:00:00'), end: new Date('2026-11-06T23:59:59') };
  const usage = buildRepairPartsUsage(rows, today);
  assert.equal(usage.groups[0].parts[0].count, 2);
  assert.ok(!JSON.stringify(usage).includes('OLD MONTH PART'));

  const allTime = buildRepairPartsUsage(rows, { start: null, end: null });
  assert.ok(JSON.stringify(allTime).includes('OLD MONTH PART'));
});

test('nothing in range gives an empty panel', () => {
  const usage = buildRepairPartsUsage(rows, { start: new Date('2025-01-01'), end: new Date('2025-01-31') });
  assert.deepEqual(usage, { groups: [], repairs: 0, totalUsed: 0, distinctParts: 0 });
});
