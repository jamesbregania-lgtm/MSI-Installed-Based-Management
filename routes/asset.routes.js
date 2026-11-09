const express = require('express');
const {
  listActiveClients,
  findClientById,
  findActiveClientByName,
  filterClientsForUser,
  canUserSeeClient
} = require('../database/clients.store');
const { addMachine, findMachineBySerialNo } = require('../database/machines.store');
const { requireTechnicianOrAdmin } = require('../middleware/auth');
const { serialLengthError, futureDateError } = require('../lib/record-validation');
const { getUnitCatalog } = require('../lib/unit-catalog');

const router = express.Router();

function normalizeTechnicianName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

// Built-in parts catalog. Units/models added from the admin "Units & Models"
// tab are merged on top per request (lib/unit-catalog.js), so use
// getUnitCatalog(PARTS_CATALOG) rather than this constant directly.
const PARTS_CATALOG = {
  CIJ: {
    '9450': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'PREVENTIVE MAINTENANCE', expiryHours: 8000 }
    ],
    '9410': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'PREVENTIVE MAINTENANCE', expiryHours: 8000 }
    ],
    '9450S': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'PREVENTIVE MAINTENANCE', expiryHours: 8000 }
    ],
    '9450E': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'PREVENTIVE MAINTENANCE', expiryHours: 8000 }
    ],
    '9330': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'PREVENTIVE MAINTENANCE', expiryHours: 8000 }
    ],
    '9750': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'PREVENTIVE MAINTENANCE', expiryHours: 8000 }
    ],
    '9750+': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'PREVENTIVE MAINTENANCE', expiryHours: 8000 }
    ],
    '9450M': [],
    '9750 G': [],
    '9750 XP': [],
    '9750E': [],
    '9750M': []
  },
  TTO: {
    '8018': [],
    'X30': [],
    'X40': [],
    'X45': [],
    'X60': [],
    'X65': []
  },
  'P&A': {
    'E-TOUCH': [],
    'BLOW': [],
    'FLEX SE SHORT LEFT HAND': [],
    'FLEX SE SHORT RIGHT HAND': [],
    'FLEX SE LONG LEFT HAND': [],
    'FLEX SE LONG RIGHT HAND': [],
    '2200': [],
    '2200 BLOW': [],
    '2200 E-TOUCH': [],
    '2200 E-TOUCH 525': [],
    '2200 TAMP SHORT': [],
    'FLEX SE': [],
    'FLEX SE SHORT': [],
    'FLEX SE MEDIUM': []
  },
  // 5800 is an LCIJ model, not a DOD one — it lives under LCIJ below and must
  // not be offered here.
  DOD: {
    '4020': [],
    '4500': [],
    '4700': []
  },
  LASER: {
    'C150': [],
    'C150L': [],
    'C150S': [],
    'C350': [],
    'C350L': [],
    'C350S': [],
    'SL350L': [],
    'SLC350': []
  },
  SUNINE: {
    'K663 (CO2)': []
  },
  ANSER: {
    'X1': [],
    'A1 ANSER': []
  },
  'Fume Extractor': {
    'A300': []
  },
  LCIJ: {
    '5800': []
  },
  PALLET: {
    '2200': []
  }
};

router.get('/new-machine', requireTechnicianOrAdmin, async (req, res) => {
  const activeClients = filterClientsForUser(req.session.user, await listActiveClients())
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedClientId = req.query.clientId || '';
  const partsCatalog = await getUnitCatalog(PARTS_CATALOG);

  res.render('user_asset_form', {
    currentUser: req.session.user,
    clients: activeClients,
    selectedClientId,
    success: null,
    error: null,
    savedAsset: null,
    partsCatalog
  });
});

// Live serial-number availability check used by the new-machine form, and by
// the admin's Edit Service Report, which passes excludeId so the machine being
// corrected isn't reported as a duplicate of itself.
router.get('/check-serial', requireTechnicianOrAdmin, async (req, res) => {
  const serialNo = String(req.query.serialNo || '').trim();
  const excludeId = String(req.query.excludeId || '').trim() || undefined;
  if (!serialNo) return res.json({ ok: true, available: true });

  const lengthError = serialLengthError(serialNo);
  if (lengthError) {
    return res.json({ ok: true, available: false, invalidLength: true, message: lengthError });
  }

  const duplicate = await findMachineBySerialNo(serialNo, { excludeId });
  if (!duplicate) return res.json({ ok: true, available: true });

  // A sales user learns the serial is taken, but not by whom, unless the unit
  // belongs to one of their own clients.
  const showOwner = await canUserSeeClient(req.session.user, duplicate.clientId);
  return res.json({
    ok: true,
    available: false,
    clientName: showOwner ? duplicate.clientName : '',
    message: 'This serial number is already assigned to another client and cannot be used again.'
  });
});

router.post('/new-machine', requireTechnicianOrAdmin, async (req, res) => {
  const activeClients = filterClientsForUser(req.session.user, await listActiveClients());
  let { clientId, unit, model, serialNo, dateInstalled } = req.body;
  const partsCatalog = await getUnitCatalog(PARTS_CATALOG);

  // Installing a unit isn't a service event — there's nothing to report yet,
  // so these fields are fixed rather than typed in.
  const runningHours = 0;
  const status = 'Active';
  const description = 'N/A';
  const problem = 'N/A';
  const action = 'N/A';
  const recommendation = 'N/A';

  clientId = String(clientId || '').trim().toLowerCase();

  // Normalize model to uppercase for consistency
  if (model) {
    model = model.toUpperCase().trim();
  }

  // Enforce available model list for the selected unit.
  const unitKey = Object.keys(partsCatalog).find(
    key => key.toUpperCase() === String(unit || '').toUpperCase().trim()
  );
  const allowedModels = unitKey
    ? Object.keys(partsCatalog[unitKey] || {})
    : [];

  if (!allowedModels.length) {
    return res.render('user_asset_form', {
      currentUser: req.session.user,
      clients: activeClients,
      selectedClientId: clientId || '',
      success: null,
      error: 'No available models for the selected unit.',
      savedAsset: null,
      partsCatalog
    });
  }

  const isModelAllowed = allowedModels.some(m => m.toUpperCase() === model);
  if (!isModelAllowed) {
    return res.render('user_asset_form', {
      currentUser: req.session.user,
      clients: activeClients,
      selectedClientId: clientId || '',
      success: null,
      error: 'Invalid model for the selected unit.',
      savedAsset: { clientId, unit, model, serialNo, dateInstalled },
      partsCatalog
    });
  }

  // Fallback: if clientId is empty but clientName was submitted, match by name.
  if (!clientId && req.body.clientName) {
    const matched = await findActiveClientByName(req.body.clientName);
    if (matched) clientId = matched.id;
  }

  // Validate all required fields including unit
  if (!clientId || !unit || !model || !serialNo || !dateInstalled) {
    return res.render('user_asset_form', {
      currentUser: req.session.user,
      clients: activeClients,
      selectedClientId: clientId || '',
      success: null,
      error: 'Please fill in all required fields (Client, Unit, Model, Serial No, Date Installed).',
      savedAsset: null,
      partsCatalog
    });
  }

  // A sales user may only add units to the clients assigned to them.
  if (!(await canUserSeeClient(req.session.user, clientId))) {
    return res.render('user_asset_form', {
      currentUser: req.session.user,
      clients: activeClients,
      selectedClientId: '',
      success: null,
      error: 'That client is not assigned to you.',
      savedAsset: null,
      partsCatalog
    });
  }

  // Entry rules for brand-new records. Checked before the duplicate lookup so a
  // malformed serial fails without a database round-trip. Existing records are
  // untouched: the client routes resubmit serial/install date only as lookup
  // keys, and never run these checks.
  const entryError = serialLengthError(serialNo) || futureDateError(dateInstalled, 'Date installed');
  if (entryError) {
    return res.render('user_asset_form', {
      currentUser: req.session.user,
      clients: activeClients,
      selectedClientId: clientId || '',
      success: null,
      error: entryError,
      savedAsset: { clientId, unit, model, serialNo, dateInstalled },
      partsCatalog
    });
  }

  const client = await findClientById(clientId);

  // Serial numbers are globally unique — one serial can exist only once in the
  // entire system, no matter which client is selected.
  const duplicateSerial = await findMachineBySerialNo(serialNo);
  if (duplicateSerial) {
    const sameClient = duplicateSerial.clientId === clientId;
    const serialLabel = String(serialNo || '').trim();
    const ownerName = await canUserSeeClient(req.session.user, duplicateSerial.clientId)
      ? duplicateSerial.clientName
      : 'another client';
    return res.render('user_asset_form', {
      currentUser: req.session.user,
      clients: activeClients,
      selectedClientId: clientId || '',
      success: null,
      error: sameClient
        ? `Serial number "${serialLabel}" is already registered under ${ownerName} and cannot be used again.`
        : `This serial number is already assigned to another client and cannot be used again. "${serialLabel}" belongs to ${ownerName}.`,
      savedAsset: { clientId, unit, model, serialNo, dateInstalled },
      partsCatalog
    });
  }

  // Convert date format into dd/mm/yyyy for consistent display/storage
  let installedDate = dateInstalled || '';
  const ymdMatch = installedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    installedDate = `${ymdMatch[3]}/${ymdMatch[2]}/${ymdMatch[1]}`;
  }

  const dmyMatch = installedDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const day = String(dmyMatch[1]).padStart(2, '0');
    const month = String(dmyMatch[2]).padStart(2, '0');
    const year = dmyMatch[3];
    installedDate = `${day}/${month}/${year}`;
  }

  const asset = {
    clientId,
    clientName: client ? client.name : 'Unknown Client',
    location: client ? client.location : 'Unknown',
    unit,
    model,
    serialNo,
    dateInstalled: installedDate,
    runningHours,
    status,
    description,
    submittedBy: req.session.user
      ? req.session.user.fullName || req.session.user.username || 'Unknown User'
      : 'Unknown User'
  };

  const submittedBy = normalizeTechnicianName(asset.submittedBy) || 'Unknown User';
  const technicians = [submittedBy];

  asset.reports = [
    {
      date: installedDate,
      submittedBy,
      updateIndex: null,
      technicians: [],
      problem,
      action,
      recommendation,
      // "0000" is the one ref no value exempt from the global-uniqueness
      // rule (see REFNO_ALWAYS_FREE in machines.store.js) — safe to
      // auto-fill here since it can never collide.
      refNo: '0000'
    }
  ];
  asset.technicians = technicians;

  try {
    await addMachine(asset);
  } catch (err) {
    // Safety net: the store re-checks uniqueness, so a serial claimed
    // between our check above and the insert still fails cleanly instead
    // of 500-ing.
    if (err && err.code === 'DUPLICATE_SERIAL') {
      return res.render('user_asset_form', {
        currentUser: req.session.user,
        clients: activeClients,
        selectedClientId: clientId || '',
        success: null,
        error: 'This serial number is already assigned to another client and cannot be used again.',
        savedAsset: { clientId, unit, model, serialNo, dateInstalled },
        partsCatalog
      });
    }
    throw err;
  }

  res.render('user_asset_form', {
    currentUser: req.session.user,
    clients: activeClients,
    selectedClientId: clientId,
    success: 'Printer asset request submitted successfully.',
    error: null,
    savedAsset: asset,
    partsCatalog
  });
});

module.exports = router;
// The built-in catalog, for the client page's Edit Service Report pickers.
module.exports.PARTS_CATALOG = PARTS_CATALOG;