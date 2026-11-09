const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// Technicians may only pick parts that exist in the admin Parts list: the
// server refuses any other part name on a Repair, Cannibalize or Parts Return.

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parts-test-'));
process.env.UPLOAD_DIR = uploadDir;

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const saved = [];
const priorUpdates = [];

stub('../database/db', {
  from: () => ({
    select: async () => ({
      data: [{ part_number: 'ENM 38941', description: 'GUTTER BLOCK', unit: 'CIJ' }],
      error: null
    })
  })
});
stub('../database/update-photos.store', {
  createPhoto: async () => {},
  findPhotoById: async () => null,
  claimPhoto: async ({ id }) => ({ id, originalName: 'scan.jpg' }),
  releasePhoto: async () => {},
  setPhotoMachine: async () => {},
  deleteAbandonedPhotos: async () => 0
});
stub('../database/machines.store', {
  async updateMachine(key, updates) { saved.push(updates.newUpdate); return { id: 7, updates: [updates.newUpdate] }; },
  listMachinesByClientId: async () => [{ serialNo: 'CN1', model: '9030', dateInstalled: '01/01/2025', updates: priorUpdates }],
  appendMachineReport: async () => null,
  correctHistoryEntry: async () => null,
  findReportByRefNo: async () => null,
  findMachineById: async () => null,
  findMachineBySerialNo: async () => null
});
stub('../database/clients.store', {
  listActiveClients: async () => [],
  findClientById: async () => null,
  filterClientsForUser: (user, clients) => clients,
  canUserSeeClient: async () => true
});
stub('../database/accounts.store', { listUserAccounts: async () => [] });

let server;
let origin;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { role: 'user', username: 'tech1', fullName: 'Tech' } }; next(); });
  app.use('/client', require('../routes/client.routes'));
  server = await new Promise(resolve => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(() => { fs.rmSync(uploadDir, { recursive: true, force: true }); resolve(); })));

function save(activityType, entryParts) {
  return fetch(`${origin}/client/acme/machines/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serialNo: 'CN1', model: '9030', dateInstalled: '01/01/2025', runningHours: 1, status: 'Active',
      activityType, photoId: 'p1',
      newUpdate: { date: '2026-11-05', activityType, ...entryParts }
    })
  });
}

test('Repair accepts parts from the list, in any letter case', async () => {
  assert.equal((await save('Repair', { partsUsed: ['enm 38941 gutter block'] })).status, 200);
});

test('Repair refuses a part that is not in the list', async () => {
  const response = await save('Repair', { partsUsed: ['ENM 38941 GUTTER BLOCK', 'MADE UP PART'] });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /MADE UP PART/);
});

test('Cannibalize refuses an unlisted part but keeps one the unit already has on record', async () => {
  assert.equal((await save('Cannibalize', { partsUpdated: ['MADE UP PART'] })).status, 400);
  priorUpdates.push({ activityType: 'Cannibalize', partsUpdated: ['OLD PART [CN9]'] });
  assert.equal((await save('Cannibalize', { partsUpdated: ['OLD PART [CN9]', 'ENM 38941 GUTTER BLOCK [CN2]'] })).status, 200);
});

test('Parts Replacement refuses an unlisted part but accepts a listed one', async () => {
  assert.equal((await save('Parts Replacement', { partsUpdated: ['MADE UP PART'] })).status, 400);
  assert.equal((await save('Parts Replacement', { partsUpdated: ['ENM 38941 GUTTER BLOCK'] })).status, 200);
});

test('a Repair cannot be saved without at least one part under Parts Used', async () => {
  for (const entryParts of [{}, { partsUsed: [] }, { partsUsed: ['  '] }]) {
    const response = await save('Repair', entryParts);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Parts Used/);
  }
});
