const crypto = require('crypto');
const express = require('express');
const {
  MAX_PHOTO_BYTES,
  detectImageType,
  relativePathFor,
  absolutePathFor,
  writePhotoFile,
  removePhotoFile,
  cleanOriginalName
} = require('../lib/photo-storage');
const { createPhoto, findPhotoById, claimPhoto, releasePhoto, setPhotoMachine, deleteAbandonedPhotos } = require('../database/update-photos.store');
const { listActiveClients, findClientById, filterClientsForUser, canUserSeeClient } = require('../database/clients.store');
const { listMachinesByClientId, updateMachine, appendMachineReport, correctHistoryEntry, findReportByRefNo, findMachineById, findMachineBySerialNo } = require('../database/machines.store');
const { listUserAccounts } = require('../database/accounts.store');
const { requireTechnicianOrAdmin, requireAdmin, isTechnician } = require('../middleware/auth');
const { isFutureDate, serialLengthError, futureDateError, parseEntryDate } = require('../lib/record-validation');
const { getUnitCatalog, findUnitName } = require('../lib/unit-catalog');
const { PARTS_CATALOG } = require('./asset.routes');
const { completeSchedulesForLog } = require('../database/schedules.store');

const router = express.Router();

// A sales user may only open clients assigned to them. Runs for every route
// with a :clientId (pages, machine lists and report posts alike); other roles
// pass straight through and unauthenticated requests are left to the auth guards.
router.param('clientId', async (req, res, next, clientId) => {
  try {
    if (await canUserSeeClient(req.session && req.session.user, clientId)) return next();
    if (req.method === 'GET' && !req.path.endsWith('/machines')) {
      return res.redirect('/user_account');
    }
    return res.status(403).json({ ok: false, error: 'This client is not assigned to you.' });
  } catch (error) {
    return next(error);
  }
});

// { UNIT: [MODEL, ...] } — the same unit/model list the Add Printer form
// offers, including units and models added from the admin Units & Models tab.
async function loadUnitModelOptions() {
  const catalog = await getUnitCatalog(PARTS_CATALOG);
  return Object.keys(catalog).reduce((acc, unit) => {
    acc[unit] = Object.keys(catalog[unit] || {});
    return acc;
  }, {});
}

/**
 * The one unit a technician opened from the serial search (`?unit=<machine id>`),
 * or null when it is missing, unknown, or belongs to a different client.
 * Technicians never get a client's full unit list, so every client page and
 * machine-list request from them must name its unit.
 */
async function findTechnicianUnit(req, clientId) {
  const unitId = Number(req.query.unit);
  if (!Number.isSafeInteger(unitId) || unitId <= 0) return null;
  const machine = await findMachineById(unitId);
  if (!machine) return null;
  const ownerKey = String(machine.clientId || '').trim().toLowerCase();
  return ownerKey && ownerKey === String(clientId || '').trim().toLowerCase() ? machine : null;
}

function identityError(message) {
  const err = new Error(message);
  err.code = 'INVALID_IDENTITY';
  return err;
}

/**
 * Validates the unit, model, serial and date an admin corrected, and returns
 * only the ones that actually changed, cleaned up for storage.
 *
 * A field left as it was is never re-validated: records predating the Add
 * Printer rules (9-character ANSER serials, legacy models no longer in the
 * catalog) must stay correctable for everything else.
 */
async function buildIdentityPatch(existing, patch) {
  const has = key => Object.prototype.hasOwnProperty.call(patch, key);
  const result = {};

  const unitChanged = has('unit') && String(patch.unit || '').trim().toUpperCase() !== String(existing.unit || '').trim().toUpperCase();
  const modelChanged = has('model') && String(patch.model || '').trim().toUpperCase() !== String(existing.model || '').trim().toUpperCase();
  if (unitChanged || modelChanged) {
    // Same rule as Add Printer: the unit must exist and the model must be one
    // of that unit's models.
    const catalog = await getUnitCatalog(PARTS_CATALOG);
    const unit = findUnitName(catalog, has('unit') ? patch.unit : existing.unit);
    if (!unit) throw identityError('Select a unit from the list.');
    const wanted = String(has('model') ? patch.model : existing.model || '').trim().toUpperCase();
    const model = Object.keys(catalog[unit] || {}).find(name => name.toUpperCase() === wanted);
    if (!model) throw identityError(`Select a model from the list for ${unit}.`);
    result.unit = unit;
    result.model = model;
  }

  const serialNo = has('serialNo') ? String(patch.serialNo || '').trim() : '';
  if (has('serialNo') && serialNo.toLowerCase() !== String(existing.serialNo || '').trim().toLowerCase()) {
    const lengthError = serialLengthError(serialNo);
    if (lengthError) throw identityError(lengthError);
    const duplicate = await findMachineBySerialNo(serialNo, { excludeId: existing.id });
    if (duplicate) {
      throw identityError(
        `This serial number is already assigned to another client and cannot be used again. "${serialNo}" belongs to ${duplicate.clientName}.`
      );
    }
    result.serialNo = serialNo;
  }

  if (has('date') && String(patch.date || '').trim()) {
    const parsed = parseEntryDate(patch.date);
    if (!parsed) throw identityError('Enter a valid date.');
    const dateError = futureDateError(patch.date, 'Date');
    if (dateError) throw identityError(dateError);
    // Stored dd/mm/yyyy, the same as Add Printer and every activity form.
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    result.date = `${day}/${month}/${parsed.getFullYear()}`;
  }

  return result;
}



const db = require('../database/db');

// ── Service-report images ──
//
// One image per update: the technician picks it in the activity modal, the
// page uploads it here straight away, and the update save then names it by
// id. The file goes to disk (lib/photo-storage.js); update_photos holds the row.

const readPhotoBody = express.raw({ type: () => true, limit: MAX_PHOTO_BYTES });

router.post('/:clientId/photos', requireTechnicianOrAdmin, (req, res, next) => {
  readPhotoBody(req, res, err => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: 'Image is larger than 5 MB.' });
    }
    return next(err);
  });
}, async (req, res) => {
  const clientId = String(req.params.clientId || '').trim();
  const user = req.session.user || {};
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  if (!body.length) {
    return res.status(400).json({ ok: false, error: 'No image received.' });
  }
  if (body.length > MAX_PHOTO_BYTES) {
    return res.status(413).json({ ok: false, error: 'Image is larger than 5 MB.' });
  }
  const mime = detectImageType(body);
  if (!mime) {
    return res.status(400).json({ ok: false, error: 'Only JPG, PNG or WebP images can be attached.' });
  }

  const id = crypto.randomUUID();
  const filePath = relativePathFor(id, mime);
  const originalName = cleanOriginalName(req.get('X-File-Name'));

  try {
    await writePhotoFile(filePath, body);
    try {
      await createPhoto({
        id,
        clientId,
        filePath,
        originalName,
        mime,
        sizeBytes: body.length,
        uploadedBy: user.username
      });
    } catch (err) {
      await removePhotoFile(filePath).catch(() => {});
      throw err;
    }
  } catch (err) {
    if (err && err.code === 'PHOTOS_UNAVAILABLE') {
      return res.status(503).json({ ok: false, error: err.message });
    }
    console.error('Failed to store photo:', err);
    return res.status(500).json({ ok: false, error: 'Failed to upload the image. Please try again.' });
  }

  // Housekeeping for forms abandoned after an upload; never holds up this one.
  deleteAbandonedPhotos().catch(err => console.error('Failed to clean up abandoned photos:', err));

  return res.json({ ok: true, photo: { id, name: originalName, size: body.length } });
});

// Anyone who can see the record can see its image: admins and technicians
// always, sales only for their own clients. An image not yet saved with an
// update is visible only to whoever uploaded it.
router.get('/photos/:photoId', requireTechnicianOrAdmin, async (req, res) => {
  const user = req.session.user || {};
  let photo = null;
  try {
    photo = await findPhotoById(req.params.photoId);
  } catch (err) {
    if (!err || err.code !== 'PHOTOS_UNAVAILABLE') console.error('Failed to load photo:', err);
  }

  const me = String(user.username || '').trim().toLowerCase();
  const visible = photo
    && (photo.attachedAt || photo.uploadedBy === me)
    && await canUserSeeClient(user, photo.clientId);
  if (!visible) return res.status(404).send('Image not found.');

  let fullPath;
  try {
    fullPath = absolutePathFor(photo.filePath);
  } catch (err) {
    return res.status(404).send('Image not found.');
  }

  // The bytes behind an id never change, so the browser may keep them.
  res.set({
    'Content-Type': photo.mime,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(photo.originalName || 'image')}`
  });
  return res.sendFile(fullPath, err => {
    if (err && !res.headersSent) res.status(404).send('Image not found.');
  });
});

// A part as the picker writes it: "<number> <description>", with "[serial]"
// appended on a cannibalized part. Compared case-insensitively.
function stripPartSerial(name) {
  const text = String(name || '').trim();
  const match = text.match(/(.*)\s+\[(.*?)\]$/);
  return (match ? match[1] : text).trim().toLowerCase();
}

async function loadCatalogPartNames() {
  const { data, error } = await db.from('parts_catalog').select('*');
  if (error) throw error;
  return new Set((data || []).map(row => `${row.part_number || ''} ${row.description || ''}`.trim().toLowerCase()));
}

// API endpoint: parts catalog — fetched client-side to bypass any server caching
router.get('/api/parts-catalog', requireTechnicianOrAdmin, async (req, res) => {
  try {
    const { data, error } = await db.from('parts_catalog').select('*');
    if (error) throw error;
    const partsCatalog = {};
    if (data) {
      data.forEach(row => {
        const unit = String(row.unit || '').toUpperCase().trim();
        const modelSeries = String(row.model_series || 'DEFAULT').toUpperCase().trim();
        if (!partsCatalog[unit]) partsCatalog[unit] = {};
        if (!partsCatalog[unit][modelSeries]) partsCatalog[unit][modelSeries] = [];
        // Name only: parts carry no due date or hour limit — preventive
        // maintenance is the only clock, so the table's expiry_* columns are
        // deliberately not sent.
        partsCatalog[unit][modelSeries].push({
          name: `${row.part_number} ${row.description}`
        });
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, partsCatalog });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// Live check used by every Service Report Reference No. field — same
// algorithm as the serial-number check, just scoped to reports instead of
// machines. `excludeMachineId`/`excludeTargetType`/`excludeUpdateIndex` let
// the admin report-editor re-save a report's own unchanged ref no without
// it flagging as a collision with itself.
router.get('/api/check-refno', requireTechnicianOrAdmin, async (req, res) => {
  const refNo = String(req.query.refNo || '').trim();
  if (!refNo) return res.json({ ok: true, available: true });

  const excludeMachineId = req.query.excludeMachineId ? Number(req.query.excludeMachineId) : null;
  const excludeTargetType = String(req.query.excludeTargetType || '');
  let exclude = null;
  if (excludeMachineId && excludeTargetType === 'install') {
    exclude = { machineId: excludeMachineId, target: { type: 'install' } };
  } else if (excludeMachineId && excludeTargetType === 'update' && req.query.excludeUpdateIndex !== undefined) {
    exclude = { machineId: excludeMachineId, target: { type: 'update', updateIndex: Number(req.query.excludeUpdateIndex) } };
  }

  const duplicate = await findReportByRefNo(refNo, exclude);
  if (!duplicate) return res.json({ ok: true, available: true });

  // A sales user learns the ref no is taken, but not where, unless the report
  // belongs to one of their own clients.
  const showOwner = await canUserSeeClient(req.session.user, duplicate.clientId);
  return res.json({
    ok: true,
    available: false,
    clientName: showOwner ? duplicate.clientName : '',
    serialNo: showOwner ? duplicate.serialNo : '',
    message: 'Already used'
  });
});

router.get('/:clientId/machines', requireTechnicianOrAdmin, async (req, res) => {
  try {
    const clientId = String(req.params.clientId || '').trim();
    const client = await findClientById(clientId);

    if (!client) {
      return res.status(404).json({ ok: false, error: 'Client not found.' });
    }

    if (isTechnician(req.session.user)) {
      const unit = await findTechnicianUnit(req, client.id);
      if (!unit) {
        return res.status(403).json({ ok: false, error: 'Search for the unit by serial number to open it.' });
      }
      return res.json({ ok: true, machineRecords: [unit] });
    }

    const machineRecords = await listMachinesByClientId(client.id);
    return res.json({ ok: true, machineRecords });
  } catch (error) {
    console.error('Failed to load client machines:', error);
    return res.status(500).json({ ok: false, error: 'Failed to load machine records.' });
  }
});

router.get('/:clientId', requireTechnicianOrAdmin, async (req, res) => {
  try {
    const clientId = req.params.clientId;
    const technician = isTechnician(req.session.user);
    let activeClients;
    let machineRecords;
    let unitId = null;
    if (technician) {
      // Only the unit picked from the serial search, and only its own client —
      // which may be inactive, since the search covers every unit.
      const unit = await findTechnicianUnit(req, clientId);
      if (!unit) return res.redirect('/user_account');
      const client = await findClientById(clientId);
      if (!client) return res.redirect('/user_account');
      activeClients = [client];
      machineRecords = [unit];
      unitId = unit.id;
    } else {
      activeClients = filterClientsForUser(req.session.user, await listActiveClients());
      const client = await findClientById(clientId);
      machineRecords = client ? await listMachinesByClientId(client.id) : [];
    }
    const userAccounts = await listUserAccounts();

    const { data: partsData, error: partsError } = await db.from('parts_catalog').select('*');
    if (partsError) console.error('Failed to load parts catalog:', partsError);
    
    const partsCatalog = {};
    if (partsData) {
        partsData.forEach(row => {
            const unit = String(row.unit || '').toUpperCase().trim();
            const modelSeries = String(row.model_series || 'DEFAULT').toUpperCase().trim();
            if (!partsCatalog[unit]) {
                partsCatalog[unit] = {};
            }
            if (!partsCatalog[unit][modelSeries]) {
                partsCatalog[unit][modelSeries] = [];
            }
            // Name only — see /api/parts-catalog above.
            partsCatalog[unit][modelSeries].push({
                name: `${row.part_number} ${row.description}`
            });
        });
    }

    const unitModelOptions = req.session?.user?.role === 'admin' ? await loadUnitModelOptions() : {};

    const currentFullName = String(req.session?.user?.fullName || '').trim().toLowerCase();
    const teamMembers = userAccounts
      .filter(account => account.status === 'active')
      .map(account => account.fullName)
      .filter(Boolean)
      .filter(name => String(name).trim().toLowerCase() !== currentFullName)
      .filter((name, index, arr) => arr.indexOf(name) === index)
      .sort((a, b) => a.localeCompare(b));

    res.render('client', {
      currentUser: req.session.user,
      clientId,
      clients: activeClients,
      machineRecords,
      teamMembers,
      partsCatalog,
      unitModelOptions,
      unitId
    });
  } catch (error) {
    console.error('Failed to render client page:', error);
    res.status(500).render('client', {
      currentUser: req.session.user,
      clientId: req.params.clientId || '',
      clients: [],
      machineRecords: [],
      teamMembers: []
    });
  }
});

// A log is the proof of work for today's schedule at this client — for the
// technician submitting it and for each technician picked under Other
// Technicians. The log is already saved, so a failure here must not fail it.
async function completeSchedulesFromLog(user, clientId, otherTechnicianNames) {
  try {
    const usernames = [];
    if (isTechnician(user)) usernames.push(user.username);
    const names = new Set(otherTechnicianNames.map(name => String(name || '').trim().toLowerCase()).filter(Boolean));
    if (names.size) {
      const accounts = await listUserAccounts();
      accounts.forEach(account => {
        if (account.status === 'active' && names.has(String(account.fullName || '').trim().toLowerCase())) {
          usernames.push(account.username);
        }
      });
    }
    await completeSchedulesForLog(usernames, clientId);
  } catch (err) {
    console.error('[schedules] could not mark schedules done:', err.message || err);
  }
}

router.post('/:clientId/machines/update', requireTechnicianOrAdmin, async (req, res) => {
  const clientId = String(req.params.clientId || '').trim();
  const {
    serialNo,
    model,
    dateInstalled,
    runningHours,
    status,
    description,
    smrDate,
    activityType,
    maintenanceServiceDate,
    partServiceDates,
    partServiceHours,
    partServiceAdjustments,
    newUpdate: requestedUpdate,
    updates,
    photoId
  } = req.body || {};
    const { report, updateIndex } = req.body || {};

  if (!serialNo || !model || !dateInstalled) {
    return res.status(400).json({ ok: false, error: 'Missing machine identity fields.' });
  }

  const parsedRunningHours = Number(runningHours);
  if (!Number.isFinite(parsedRunningHours) || parsedRunningHours < 0) {
    return res.status(400).json({ ok: false, error: 'Invalid runningHours value.' });
  }

  if (!status || typeof status !== 'string') {
    return res.status(400).json({ ok: false, error: 'Status is required.' });
  }

  // The page sends only the entry it is adding; the store appends it to the
  // saved history. A page loaded before that change still posts the whole
  // updates[] array — only its last entry is new, so take that and ignore the
  // rest rather than let the request overwrite history.
  const legacyUpdates = Array.isArray(updates) ? updates : [];
  const newUpdate = requestedUpdate && typeof requestedUpdate === 'object' && !Array.isArray(requestedUpdate)
    ? requestedUpdate
    : (legacyUpdates.length ? legacyUpdates[legacyUpdates.length - 1] : null);

  // The UI stamps these with today, so a future one means a tampered or stale
  // request. serialNo/model/dateInstalled above are lookup keys for a record
  // that already exists, so they are deliberately not re-validated here.
  if (isFutureDate(report && report.date)) {
    return res.status(400).json({ ok: false, error: 'Report date cannot be in the future.' });
  }
  if (isFutureDate(newUpdate && newUpdate.date)) {
    return res.status(400).json({ ok: false, error: 'Service update date cannot be in the future.' });
  }
  if (isFutureDate(smrDate) || isFutureDate(newUpdate && newUpdate.smrDate)) {
    return res.status(400).json({ ok: false, error: 'SMR date cannot be in the future.' });
  }

  const VALID_ACTIVITY_TYPES = new Set(['Preventive Maintenance', 'Parts Replacement', 'Repair', 'Inspection', 'Pull Out', 'Cannibalize', 'Parts Return']);
  const safeActivityType = activityType && VALID_ACTIVITY_TYPES.has(String(activityType))
    ? String(activityType)
    : 'Preventive Maintenance';

    const safeReport = report && typeof report === 'object'
      ? {
          date: String(report.date || ''),
          submittedBy: String(report.submittedBy || ''),
          updateIndex: Number.isInteger(Number(updateIndex)) && Number(updateIndex) >= 0 ? Number(updateIndex) : null,
          technicians: Array.isArray(report.technicians)
            ? report.technicians.map(name => String(name || '').trim()).filter(Boolean)
            : [],
          problem: String(report.problem || ''),
          action: String(report.action || ''),
          recommendation: String(report.recommendation || ''),
          refNo: String(report.refNo || '')
        }
      : null;

  const isNewEntry = Boolean(newUpdate && typeof newUpdate === 'object');
  const user = req.session.user || {};

  // Parts are chosen from the admin-managed Parts list and never typed in.
  // Repair "Parts Used" must all be in it; Cannibalize / Parts Return may also
  // keep a part this unit already has on record (older entries predate the list).
  // Parts Replacement follows the same rule: it can only mark listed parts, or
  // ones the unit already tracks, as replaced.
  const partsField = safeActivityType === 'Repair' ? 'partsUsed' : 'partsUpdated';
  const requestedParts = isNewEntry && Array.isArray(newUpdate[partsField]) ? newUpdate[partsField] : [];
  // Parts Used is required on a new Repair: every repair names the parts it used.
  if (isNewEntry && safeActivityType === 'Repair' && !requestedParts.some(name => String(name || '').trim())) {
    return res.status(400).json({ ok: false, error: 'Pick at least one part under Parts Used before saving the repair.' });
  }
  if (requestedParts.length && ['Repair', 'Cannibalize', 'Parts Return', 'Parts Replacement'].includes(safeActivityType)) {
    const requested = requestedParts;
    try {
      const allowed = await loadCatalogPartNames();
      if (safeActivityType !== 'Repair') {
        const unit = (await listMachinesByClientId(clientId)).find(m =>
          String(m.serialNo) === String(serialNo) && String(m.model) === String(model) && String(m.dateInstalled) === String(dateInstalled));
        ((unit && unit.updates) || []).forEach(u => {
          (Array.isArray(u && u.partsUpdated) ? u.partsUpdated : []).forEach(name => allowed.add(stripPartSerial(name)));
        });
        const tracked = unit && unit.partServiceDates && typeof unit.partServiceDates === 'object' ? unit.partServiceDates : {};
        Object.keys(tracked).forEach(name => allowed.add(stripPartSerial(name)));
      }
      const rejected = requested.find(name => !allowed.has(stripPartSerial(name)));
      if (rejected !== undefined) {
        return res.status(400).json({ ok: false, error: `"${String(rejected)}" is not in the Parts list. Ask an admin to add it.` });
      }
    } catch (err) {
      console.error('Failed to check parts against the catalog:', err);
      return res.status(500).json({ ok: false, error: 'Failed to save. Please try again.' });
    }
  }

  // Every new history entry carries one image of its paper service report,
  // uploaded beforehand through POST /:clientId/photos. Claimed before the
  // save so no other update can take it, and given back if the save fails.
  let photo = null;
  if (isNewEntry) {
    const requestedPhotoId = String(photoId || '').trim();
    if (!requestedPhotoId) {
      return res.status(400).json({ ok: false, error: 'Attach an image of the service report before saving.' });
    }
    try {
      photo = await claimPhoto({ id: requestedPhotoId, clientId, uploadedBy: user.username });
    } catch (err) {
      if (err && err.code === 'PHOTOS_UNAVAILABLE') {
        return res.status(503).json({ ok: false, error: err.message });
      }
      throw err;
    }
    if (!photo) {
      return res.status(400).json({ ok: false, error: 'The attached image is no longer available. Please attach it again.' });
    }
  }

  // Whatever the page put there, the entry's image is the one just claimed.
  const entryToSave = isNewEntry
    ? { ...newUpdate, photo: photo ? { id: photo.id, name: photo.originalName } : null }
    : null;

  let machine = null;
  try {
    machine = await updateMachine(
      { clientId, serialNo, model, dateInstalled },
      {
        runningHours: parsedRunningHours,
        status: String(status),
        // Notes were dropped from the activity forms, so requests no longer
        // carry one. The store patches `description` whenever the key is
        // present, so sending it unconditionally would blank the service notes
        // recorded against older machines — forward it only if a caller sends
        // one.
        ...(description !== undefined ? { description: String(description) } : {}),
        smrDate: String(smrDate || ''),
        activityType: safeActivityType,
        maintenanceServiceDate: String(maintenanceServiceDate || ''),
        partServiceDates: partServiceDates && typeof partServiceDates === 'object' ? partServiceDates : {},
        partServiceHours: partServiceHours && typeof partServiceHours === 'object' ? partServiceHours : {},
        partServiceAdjustments: partServiceAdjustments && typeof partServiceAdjustments === 'object' ? partServiceAdjustments : undefined,
        newUpdate: entryToSave,
        report: safeReport
      }
    );
  } catch (err) {
    if (photo) await releasePhoto(photo.id).catch(releaseErr => console.error('Failed to release photo:', releaseErr));
    if (err && err.code === 'DUPLICATE_REFNO') {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('Failed to save machine update:', err);
    return res.status(500).json({ ok: false, error: 'Failed to save. Please try again.' });
  }

  if (!machine) {
    if (photo) await releasePhoto(photo.id).catch(releaseErr => console.error('Failed to release photo:', releaseErr));
    return res.status(404).json({ ok: false, error: 'Machine record not found.' });
  }

  // Only bookkeeping for a later admin replace; the update already names its image.
  if (photo) {
    setPhotoMachine(photo.id, machine.id).catch(err => console.error('Failed to link photo to machine:', err));
  }

  // A technician's log closes the schedules it covers. The update is already
  // saved, so a failure here is logged rather than reported as a failed save.
  try {
    await completeSchedulesFromLog(req.session.user, clientId, [
      ...(safeReport ? safeReport.technicians : []),
      ...(newUpdate && Array.isArray(newUpdate.technicians) ? newUpdate.technicians : [])
    ]);
  } catch (err) {
    console.error('Failed to mark schedules done from the log:', err);
  }

  return res.json({ ok: true, machine });
});

router.post('/:clientId/machines/report', requireTechnicianOrAdmin, async (req, res) => {
  const clientId = String(req.params.clientId || '').trim();
  const { serialNo, model, dateInstalled, report, updateIndex } = req.body || {};

  if (!serialNo || !model || !dateInstalled) {
    return res.status(400).json({ ok: false, error: 'Missing machine identity fields.' });
  }

  if (!report || typeof report !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing report payload.' });
  }

  if (isFutureDate(report.date)) {
    return res.status(400).json({ ok: false, error: 'Report date cannot be in the future.' });
  }

  const parsedUpdateIndex = Number(updateIndex);

  const safeReport = {
    date: String(report.date || ''),
    submittedBy: String(report.submittedBy || ''),
    updateIndex: Number.isInteger(parsedUpdateIndex) && parsedUpdateIndex >= 0 ? parsedUpdateIndex : null,
    technicians: Array.isArray(report.technicians)
      ? report.technicians.map(name => String(name || '').trim()).filter(Boolean)
      : [],
    problem: String(report.problem || ''),
    action: String(report.action || ''),
    recommendation: String(report.recommendation || ''),
    refNo: String(report.refNo || '')
  };

  try {
    const machine = await appendMachineReport(
      { clientId, serialNo, model, dateInstalled },
      safeReport
    );

    if (!machine) {
      return res.status(404).json({ ok: false, error: 'Machine record not found.' });
    }

    await completeSchedulesFromLog(req.session.user, clientId, safeReport.technicians);

    return res.json({ ok: true, machine });
  } catch (err) {
    if (err && err.code === 'DUPLICATE_REFNO') {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('Failed to save machine report:', err);
    return res.status(500).json({ ok: false, error: 'Failed to save. Please try again.' });
  }
});

// Corrects a history entry — the install snapshot, a PM/Parts report,
// or an ad-hoc Cannibalize/Pull Out update. Admin-only.
// Locked fields (unit/model/serial/date/submittedBy/activityType) are
// stripped in the store, so it's harmless if a client accidentally sends them.
router.post('/:clientId/machines/report/edit', requireAdmin, async (req, res) => {
  const { machineId, target, patch } = req.body || {};

  if (!Number.isInteger(Number(machineId)) || Number(machineId) <= 0) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid machineId.' });
  }
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return res.status(400).json({ ok: false, error: 'Missing target descriptor.' });
  }
  if (target.type !== 'install' && target.type !== 'update') {
    return res.status(400).json({ ok: false, error: 'Unknown target type.' });
  }
  if (target.type === 'update' && (!Number.isInteger(Number(target.updateIndex)) || Number(target.updateIndex) < 0)) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid updateIndex.' });
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return res.status(400).json({ ok: false, error: 'Missing patch payload.' });
  }

  const editedBy = (req.session.user && (req.session.user.fullName || req.session.user.username)) || 'Unknown Admin';

  const safeTarget = target.type === 'install'
    ? { type: 'install' }
    : { type: 'update', updateIndex: Number(target.updateIndex) };

  try {
    // Unit, model, serial and date are validated here and passed on only when
    // they changed; anything else under those names is dropped.
    const { unit, model, serialNo, date, ...restPatch } = patch;
    const existing = await findMachineById(machineId);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Machine record not found.' });
    }
    const identityPatch = await buildIdentityPatch(existing, patch);

    const machine = await correctHistoryEntry(machineId, safeTarget, { ...restPatch, ...identityPatch }, editedBy);
    if (!machine) {
      return res.status(404).json({ ok: false, error: 'Machine record not found.' });
    }
    return res.json({ ok: true, machine });
  } catch (err) {
    if (err && ['INVALID_MACHINE_ID', 'INVALID_TARGET', 'UPDATE_NOT_FOUND', 'DUPLICATE_REFNO', 'INVALID_IDENTITY'].includes(err.code)) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('Failed to correct history entry:', err);
    return res.status(500).json({ ok: false, error: 'Failed to save. Please try again.' });
  }
});

module.exports = router;