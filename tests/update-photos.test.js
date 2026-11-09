const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// Images go to a throwaway folder, never the real upload folder.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-test-'));
process.env.UPLOAD_DIR = uploadDir;

const storage = require('../lib/photo-storage');

// ── Stand-ins for the stores the routes use; no database is touched ──

const photos = new Map();
const savedUpdates = [];
let updateMachineFails = false;

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub('../database/update-photos.store', {
  async createPhoto(row) {
    photos.set(row.id, { ...row, attachedAt: null, machineId: null, uploadedBy: row.uploadedBy.toLowerCase() });
  },
  async findPhotoById(id) {
    const row = photos.get(id);
    return row ? { ...row } : null;
  },
  async claimPhoto({ id, clientId, uploadedBy }) {
    const row = photos.get(id);
    if (!row || row.attachedAt || row.clientId !== clientId || row.uploadedBy !== String(uploadedBy).toLowerCase()) return null;
    row.attachedAt = new Date().toISOString();
    return { ...row };
  },
  async releasePhoto(id) {
    const row = photos.get(id);
    if (row) row.attachedAt = null;
  },
  async setPhotoMachine(id, machineId) {
    const row = photos.get(id);
    if (row) row.machineId = machineId;
  },
  async deleteAbandonedPhotos() { return 0; }
});

stub('../database/machines.store', {
  async updateMachine(key, updates) {
    if (updateMachineFails) throw new Error('database down');
    savedUpdates.push(updates);
    return { id: 7, clientId: key.clientId, serialNo: key.serialNo, updates: [updates.newUpdate] };
  },
  listMachinesByClientId: async () => [],
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
  // Sales see only "acme"; everyone else sees every client.
  canUserSeeClient: async (user, clientId) => !user || user.role !== 'sales' || clientId === 'acme'
});

stub('../database/accounts.store', { listUserAccounts: async () => [] });

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]);

let server;
let origin;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    const username = req.headers['x-test-user'] || 'tech1';
    req.session = role ? { user: { role, username, fullName: 'Test User' } } : {};
    next();
  });
  app.use('/client', require('../routes/client.routes'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  resolve();
})));

beforeEach(() => {
  savedUpdates.length = 0;
  updateMachineFails = false;
});

function upload(clientId, body, { role = 'user', user = 'tech1', name = 'scan.jpg', type = 'image/jpeg' } = {}) {
  return fetch(`${origin}/client/${clientId}/photos`, {
    method: 'POST',
    headers: {
      'Content-Type': type,
      'X-File-Name': encodeURIComponent(name),
      Accept: 'application/json',
      'x-test-role': role,
      'x-test-user': user
    },
    body
  });
}

function saveUpdate(clientId, extra = {}, { role = 'user', user = 'tech1' } = {}) {
  return fetch(`${origin}/client/${clientId}/machines/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-test-role': role, 'x-test-user': user },
    body: JSON.stringify({
      serialNo: 'CN24131815',
      model: '9750',
      dateInstalled: '01/01/2025',
      runningHours: 100,
      status: 'Active',
      activityType: 'Inspection',
      newUpdate: { date: '2026-11-05', activityType: 'Inspection', photo: { id: 'forged', name: 'forged.jpg' } },
      report: { date: '2026-11-05', refNo: 'SR-1', technicians: [] },
      ...extra
    })
  });
}

async function uploadedPhotoId(clientId = 'acme', options) {
  const response = await upload(clientId, JPEG, options);
  assert.equal(response.status, 200);
  const payload = await response.json();
  return payload.photo.id;
}

test('detects images by their bytes, not their name', () => {
  assert.equal(storage.detectImageType(JPEG), 'image/jpeg');
  assert.equal(storage.detectImageType(PNG), 'image/png');
  assert.equal(storage.detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(storage.detectImageType(Buffer.from('%PDF-1.7 not an image')), null);
});

test('stored file names lose folders and control characters', () => {
  assert.equal(storage.cleanOriginalName(encodeURIComponent('..\\..\\evil/scan 1.jpg')), 'scan 1.jpg');
  assert.equal(storage.cleanOriginalName(''), 'image');
  assert.throws(() => storage.absolutePathFor('../outside.jpg'));
});

test('uploading an image stores the file and returns its id and name', async () => {
  const response = await upload('acme', JPEG, { name: 'CamScanner 11-05.jpg' });
  assert.equal(response.status, 200);
  const { photo } = await response.json();
  assert.equal(photo.name, 'CamScanner 11-05.jpg');
  const row = photos.get(photo.id);
  assert.equal(row.clientId, 'acme');
  assert.equal(row.mime, 'image/jpeg');
  assert.deepEqual(fs.readFileSync(path.join(uploadDir, row.filePath)), JPEG);
});

test('a PDF or other non-image is refused even when it claims to be a JPEG', async () => {
  const response = await upload('acme', Buffer.from('%PDF-1.7 a scanned report'), { name: 'scan.jpg' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /JPG, PNG or WebP/);
});

test('an image over 5 MB is refused', async () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(storage.MAX_PHOTO_BYTES)]);
  const response = await upload('acme', big);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /5 MB/);
});

test('sales cannot upload for a client that is not theirs', async () => {
  const response = await upload('globex', JPEG, { role: 'sales', user: 'sales1' });
  assert.equal(response.status, 403);
});

test('an update without an image is refused', async () => {
  const response = await saveUpdate('acme', { photoId: undefined });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Attach an image/);
  assert.equal(savedUpdates.length, 0);
});

test('an update saves with the claimed image, never one the page made up', async () => {
  const photoId = await uploadedPhotoId();
  const response = await saveUpdate('acme', { photoId });
  assert.equal(response.status, 200);
  assert.deepEqual(savedUpdates[0].newUpdate.photo, { id: photoId, name: 'scan.jpg' });
  assert.ok(photos.get(photoId).attachedAt);
  assert.equal(photos.get(photoId).machineId, 7);
});

test('one image cannot be used by two updates', async () => {
  const photoId = await uploadedPhotoId();
  assert.equal((await saveUpdate('acme', { photoId })).status, 200);
  const second = await saveUpdate('acme', { photoId });
  assert.equal(second.status, 400);
  assert.match((await second.json()).error, /no longer available/);
});

test("another technician's image, or one uploaded for another client, is refused", async () => {
  const photoId = await uploadedPhotoId('acme', { user: 'tech2' });
  assert.equal((await saveUpdate('acme', { photoId })).status, 400);
  assert.equal((await saveUpdate('globex', { photoId }, { user: 'tech2' })).status, 400);
});

test('the image is freed again when the update fails to save', async () => {
  const photoId = await uploadedPhotoId();
  updateMachineFails = true;
  assert.equal((await saveUpdate('acme', { photoId })).status, 500);
  assert.equal(photos.get(photoId).attachedAt, null);
  updateMachineFails = false;
  assert.equal((await saveUpdate('acme', { photoId })).status, 200);
});

test('a saved image is visible to admin and technicians, and to sales only for their clients', async () => {
  const acmePhoto = await uploadedPhotoId('acme');
  await saveUpdate('acme', { photoId: acmePhoto });
  const globexPhoto = await uploadedPhotoId('globex');
  await saveUpdate('globex', { photoId: globexPhoto });

  const view = (id, role, user) => fetch(`${origin}/client/photos/${id}`, { headers: { 'x-test-role': role, 'x-test-user': user } });

  const asAdmin = await view(acmePhoto, 'admin', 'boss');
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await asAdmin.arrayBuffer()), JPEG);

  assert.equal((await view(acmePhoto, 'user', 'tech9')).status, 200);
  assert.equal((await view(acmePhoto, 'sales', 'sales1')).status, 200);
  assert.equal((await view(globexPhoto, 'sales', 'sales1')).status, 404);
  assert.equal((await view('no-such-id', 'admin', 'boss')).status, 404);
});

test('an image not yet saved with an update is visible only to its uploader', async () => {
  const photoId = await uploadedPhotoId('acme', { user: 'tech3' });
  const view = user => fetch(`${origin}/client/photos/${photoId}`, { headers: { 'x-test-role': 'user', 'x-test-user': user } });
  assert.equal((await view('tech3')).status, 200);
  assert.equal((await view('tech4')).status, 404);
});
