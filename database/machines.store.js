const db = require('./db');
const { isRunningHoursExempt } = require('../public/js/shared/running-hours');

/**
 * LASER, DOD and 5800 units have no hour meter, so their running hours are
 * pinned to 0 here as well as in the forms — a hand-rolled request, a stale
 * cached page or a future caller can't put a reading back onto one.
 */
function zeroRunningHoursIfExempt(unit, model, value) {
  return isRunningHoursExempt(unit, model) ? 0 : value;
}

/** The same rule applied to every entry of an updates[] array being written. */
function zeroUpdateRunningHours(updates, unit, model) {
  if (!Array.isArray(updates) || !isRunningHoursExempt(unit, model)) return updates;
  return updates.map(entry => (
    entry && typeof entry === 'object' && entry.runningHours !== undefined
      ? { ...entry, runningHours: 0 }
      : entry
  ));
}

function cloneMap(value) {
  return value && typeof value === 'object' ? { ...value } : {};
}

function cloneReport(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    ...report,
    technicians: Array.isArray(report.technicians)
      ? report.technicians.map(name => String(name || ''))
      : []
  };
}

function cloneUpdate(update) {
  if (!update || typeof update !== 'object') return {};
  return {
    ...update,
    partsUpdated: Array.isArray(update.partsUpdated)
      ? update.partsUpdated.map(name => String(name || ''))
      : [],
    partServiceDates: cloneMap(update.partServiceDates),
    partServiceHours: cloneMap(update.partServiceHours),
    report: cloneReport(update.report)
  };
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name || 'Unknown Client',
    location: row.location || 'Unknown',
    unit: row.unit || '',
    model: row.model || '',
    serialNo: row.serial_no || '',
    dateInstalled: row.date_installed || '',
    runningHours: Number(row.running_hours || 0),
    status: row.status || '',
    description: row.description || '',
    smrDate: row.smr_date || '',
    // Set while an admin has the unit disabled (migration 004); '' = in service.
    disabledAt: row.disabled_at || '',
    disabledBy: row.disabled_by || '',
    submittedBy: row.submitted_by || '',
    maintenanceServiceDate: row.maintenance_service_date || '',
    partServiceDates: cloneMap(row.part_service_dates),
    partServiceHours: cloneMap(row.part_service_hours),
    partServiceAdjustments: cloneMap(row.part_service_adjustments),
    initialRunningHours: Number(row.initial_running_hours || 0),
    initialStatus: row.initial_status || '',
    initialDescription: row.initial_description || '',
    initialSmrDate: row.initial_smr_date || '',
    initialMaintenanceServiceDate: row.initial_maintenance_service_date || '',
    initialPartServiceDates: cloneMap(row.initial_part_service_dates),
    initialPartServiceHours: cloneMap(row.initial_part_service_hours),
    technicians: Array.isArray(row.technicians)
      ? row.technicians.map(name => String(name || ''))
      : [],
    updates: Array.isArray(row.updates)
      ? row.updates.map(cloneUpdate)
      : [],
    reports: Array.isArray(row.reports)
      ? row.reports.map(cloneReport).filter(Boolean)
      : []
  };
}

// Serial numbers are globally unique across every client. Compare them
// trimmed + case-insensitively so "SN-100" and "sn-100" are the same unit.
function normalizeSerialNo(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Find any machine anywhere in the system that already uses this serial number.
 * Returns null when the serial is free.
 * `options.excludeId` skips a specific row (used when editing an existing machine).
 */
async function findMachineBySerialNo(serialNo, options = {}) {
  const key = normalizeSerialNo(serialNo);
  if (!key) return null;

  const { data, error } = await db
    .from('machines')
    .select('id, client_id, client_name, unit, model, serial_no, date_installed');
  if (error) throw error;

  const excludeId = options.excludeId;
  const hasExclude = excludeId !== undefined && excludeId !== null;

  const match = (data || []).find(row => {
    if (normalizeSerialNo(row.serial_no) !== key) return false;
    if (hasExclude && String(row.id) === String(excludeId)) return false;
    return true;
  });

  if (!match) return null;

  return {
    id: match.id,
    clientId: match.client_id || '',
    clientName: match.client_name || 'Unknown Client',
    unit: match.unit || '',
    model: match.model || '',
    serialNo: match.serial_no || '',
    dateInstalled: match.date_installed || ''
  };
}

// Service Report reference numbers must be unique across every report in
// the system — the install report and every activity's follow-up report —
// the exact same rule as serial numbers, just scoped to reports instead of
// machines. Compare trimmed + case-insensitively for the same reason.
function normalizeRefNo(value) {
  return String(value || '').trim().toLowerCase();
}

// "0000" is a long-standing placeholder habit — 34 existing reports already
// use it to mean "no reference number available," same intent as leaving
// the field blank. It's the one deliberate exception to the uniqueness
// rule: always treated as free, never flagged as a collision, and never
// blocks anyone from reusing it. No other value gets this treatment.
const REFNO_ALWAYS_FREE = new Set(['0000']);

/**
 * Find any report anywhere in the system that already uses this reference
 * number. Returns null when it's free — a blank refNo is always "free"
 * since ad-hoc activities (Cannibalize/Pull Out) have no report at all,
 * and so is "0000" (see REFNO_ALWAYS_FREE above).
 *
 * `exclude` skips one specific report — used when correcting a report's own
 * ref no, so re-saving the same value it already has isn't flagged as a
 * collision with itself. Shape matches correctHistoryEntry()'s `target`:
 *   { machineId, target: { type: 'install' } }
 *   { machineId, target: { type: 'update', updateIndex: N } }
 */
async function findReportByRefNo(refNo, exclude = null) {
  const key = normalizeRefNo(refNo);
  if (!key || REFNO_ALWAYS_FREE.has(key)) return null;

  const { data, error } = await db
    .from('machines')
    .select('id, client_id, client_name, serial_no, model, unit, reports');
  if (error) throw error;

  const excludeMachineId = exclude && exclude.machineId !== undefined && exclude.machineId !== null
    ? String(exclude.machineId)
    : null;
  const excludeTarget = exclude ? exclude.target : null;

  for (const row of (data || [])) {
    const reports = Array.isArray(row.reports) ? row.reports : [];
    for (const report of reports) {
      if (normalizeRefNo(report && report.refNo) !== key) continue;

      if (excludeMachineId && excludeTarget && String(row.id) === excludeMachineId) {
        const reportUpdateIndex = (report.updateIndex === null || report.updateIndex === undefined)
          ? null
          : Number(report.updateIndex);
        const isInstallReport = reportUpdateIndex === null;
        const matchesInstallTarget = excludeTarget.type === 'install' && isInstallReport;
        const matchesUpdateTarget = excludeTarget.type === 'update'
          && reportUpdateIndex === Number(excludeTarget.updateIndex);
        if (matchesInstallTarget || matchesUpdateTarget) continue;
      }

      return {
        machineId: row.id,
        clientId: row.client_id || '',
        clientName: row.client_name || 'Unknown Client',
        serialNo: row.serial_no || '',
        model: row.model || '',
        unit: row.unit || '',
        refNo: report.refNo
      };
    }
  }

  return null;
}

async function findMachineById(machineId) {
  const id = Number(machineId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { data, error } = await db
    .from('machines')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function listMachinesByClientId(clientId) {
  const key = String(clientId || '').trim().toLowerCase();
  const { data, error } = await db
    .from('machines')
    .select('*')
    .eq('client_id', key)
    .order('id', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

async function listAllMachines() {
  const { data, error } = await db
    .from('machines')
    .select('*')
    .order('id');
  if (error) throw error;
  return (data || []).map(mapRow);
}

// Search in the database rather than filtering listAllMachines(), which can be
// capped by the database's default row limit. Return summaries, then load the
// selected machine's complete history separately.
async function searchMachinesBySerialNo(serial, page = 0) {
  const pageSize = 25;
  const literal = String(serial || '').trim().replace(/[\\%_]/g, '\\$&');
  if (!literal) return { machines: [], hasMore: false };
  const start = page * pageSize;
  const search = fields => db
    .from('machines')
    .select(fields)
    .ilike('serial_no', `%${literal}%`)
    .order('serial_no')
    .order('id')
    .range(start, start + pageSize);
  const fields = 'id, client_id, client_name, location, unit, model, serial_no, date_installed, status';
  let { data, error } = await search(`${fields}, disabled_at`);
  // Older installations may not have enabled the optional Disable Unit feature.
  if (error && ['42703', 'PGRST204'].includes(error.code) && /disabled_at/.test(error.message || '')) {
    ({ data, error } = await search(fields));
  }
  if (error) throw error;
  const rows = data || [];
  return { machines: rows.slice(0, pageSize).map(mapRow), hasMore: rows.length > pageSize };
}

async function addMachine(machine) {
  const clientIdKey = String(machine.clientId || '').trim().toLowerCase();
  // Installs already file at 0, but an exempt unit stays at 0 even if a
  // caller starts sending a reading.
  const installRunningHours = zeroRunningHoursIfExempt(
    machine.unit,
    machine.model,
    Number.isFinite(Number(machine.runningHours)) ? Number(machine.runningHours) : 0
  );
  const row = {
    client_id: clientIdKey,
    client_name: machine.clientName ? String(machine.clientName) : null,
    location: machine.location ? String(machine.location) : null,
    unit: machine.unit ? String(machine.unit) : null,
    model: String(machine.model || '').trim(),
    serial_no: String(machine.serialNo || '').trim(),
    date_installed: String(machine.dateInstalled || '').trim(),
    running_hours: installRunningHours,
    status: machine.status ? String(machine.status) : null,
    description: machine.description ? String(machine.description) : '',
    smr_date: machine.smrDate ? String(machine.smrDate) : '',
    submitted_by: machine.submittedBy ? String(machine.submittedBy) : null,
    technicians: Array.isArray(machine.technicians)
      ? machine.technicians.map(name => String(name || ''))
      : [],
    maintenance_service_date: machine.maintenanceServiceDate
      ? String(machine.maintenanceServiceDate)
      : '',
    part_service_dates: cloneMap(machine.partServiceDates),
    part_service_hours: cloneMap(machine.partServiceHours),
    part_service_adjustments: cloneMap(machine.partServiceAdjustments),
    updates: zeroUpdateRunningHours(
      Array.isArray(machine.updates) ? machine.updates.map(cloneUpdate) : [],
      machine.unit,
      machine.model
    ),
    reports: Array.isArray(machine.reports)
      ? machine.reports.map(cloneReport).filter(Boolean)
      : [],
    initial_running_hours: installRunningHours,
    initial_status: machine.status ? String(machine.status) : null,
    initial_description: machine.description ? String(machine.description) : '',
    initial_smr_date: machine.smrDate ? String(machine.smrDate) : '',
    initial_maintenance_service_date: machine.maintenanceServiceDate
      ? String(machine.maintenanceServiceDate)
      : '',
    initial_part_service_dates: cloneMap(machine.partServiceDates),
    initial_part_service_hours: cloneMap(machine.partServiceHours)
  };

  // Serial numbers must be unique across the whole system, not just per client.
  const duplicate = await findMachineBySerialNo(row.serial_no);
  if (duplicate) {
    const err = new Error(
      `Serial number "${row.serial_no}" is already assigned to ${duplicate.clientName}.`
    );
    err.code = 'DUPLICATE_SERIAL';
    err.existing = duplicate;
    throw err;
  }

  // The install report's ref no is also globally unique, same rule as serials.
  const installRefNo = row.reports[0] && row.reports[0].refNo;
  if (installRefNo) {
    const duplicateRef = await findReportByRefNo(installRefNo);
    if (duplicateRef) {
      const err = new Error(
        `Ref No. "${installRefNo}" already used — ${duplicateRef.clientName} (${duplicateRef.serialNo}).`
      );
      err.code = 'DUPLICATE_REFNO';
      err.existing = duplicateRef;
      throw err;
    }
  }

  const { error } = await db.from('machines').insert(row);
  if (error) throw error;
}

function findMachineQuery(key) {
  return db
    .from('machines')
    .select('*')
    .eq('client_id', String(key.clientId || '').trim().toLowerCase())
    .eq('serial_no', String(key.serialNo || '').trim())
    .eq('model', String(key.model || '').trim())
    .eq('date_installed', String(key.dateInstalled || '').trim())
    .limit(1)
    .maybeSingle();
}

async function updateMachine(key, updates) {
  // Fetch existing row first
  const { data: existing, error: fetchError } = await findMachineQuery(key);
  if (fetchError) throw fetchError;
  if (!existing) return null;

  // Build patch from updates
  const patch = {};

  // The unit/model on the stored row decides this, never what the request
  // says it is — the caller only sends the model as part of the lookup key.
  const exemptFromRunningHours = isRunningHoursExempt(existing.unit, existing.model);

  if (exemptFromRunningHours) {
    patch.running_hours = 0;
  } else if (Number.isFinite(Number(updates.runningHours))) {
    patch.running_hours = Number(updates.runningHours);
  }
  if (updates.status !== undefined) {
    patch.status = String(updates.status);
  }
  if (updates.description !== undefined) {
    patch.description = String(updates.description || '');
  }
  if (updates.smrDate !== undefined) {
    patch.smr_date = String(updates.smrDate || '');
  }
  if (updates.maintenanceServiceDate !== undefined) {
    patch.maintenance_service_date = String(updates.maintenanceServiceDate || '');
  }
  if (updates.partServiceDates && typeof updates.partServiceDates === 'object') {
    patch.part_service_dates = cloneMap(updates.partServiceDates);
  }
  if (updates.partServiceHours && typeof updates.partServiceHours === 'object') {
    patch.part_service_hours = cloneMap(updates.partServiceHours);
  }
  if (updates.partServiceAdjustments && typeof updates.partServiceAdjustments === 'object') {
    patch.part_service_adjustments = cloneMap(updates.partServiceAdjustments);
  }

  // The new entry is appended to the stored history. Callers used to resend
  // the whole updates[] array, which pushed long-lived machines past the
  // request body limit and let a request rewrite past entries.
  let currentUpdates = Array.isArray(existing.updates) ? [...existing.updates] : [];
  const appendedIndex = currentUpdates.length;
  if (updates.newUpdate && typeof updates.newUpdate === 'object') {
    const [entry] = zeroUpdateRunningHours([cloneUpdate(updates.newUpdate)], existing.unit, existing.model);
    currentUpdates.push(entry);
    patch.updates = currentUpdates;
  }

  // Handle report
  const report = cloneReport(updates.report);
  if (report) {
    // Whatever index the page computed from its copy of the history, the
    // report belongs to the entry just appended.
    if (patch.updates) report.updateIndex = appendedIndex;

    let reports = Array.isArray(existing.reports) ? [...existing.reports] : [];

    // Ref no is globally unique across every report in the system, the
    // same rule as serial numbers. Self-exclude only when this call is
    // overwriting a report that already occupies this exact slot (same
    // updateIndex + date) — a brand-new report has nothing to exclude.
    if (report.refNo) {
      const occupiesExistingSlot = reports.some(
        existingReport =>
          Number(existingReport && existingReport.updateIndex) === Number(report.updateIndex) &&
          String((existingReport && existingReport.date) || '').trim() === String(report.date || '').trim()
      );
      const exclude = occupiesExistingSlot
        ? { machineId: existing.id, target: { type: 'update', updateIndex: Number(report.updateIndex) } }
        : null;
      const duplicateRef = await findReportByRefNo(report.refNo, exclude);
      if (duplicateRef) {
        const err = new Error(
          `Ref No. "${report.refNo}" already used — ${duplicateRef.clientName} (${duplicateRef.serialNo}).`
        );
        err.code = 'DUPLICATE_REFNO';
        err.existing = duplicateRef;
        throw err;
      }
    }

    const reportIndex = Number(report.updateIndex);
    const hasRequestedIndex =
      Number.isInteger(reportIndex) && reportIndex >= 0 && reportIndex < currentUpdates.length;
    const updateTarget = hasRequestedIndex
      ? currentUpdates[reportIndex]
      : currentUpdates[currentUpdates.length - 1];

    if (updateTarget) {
      updateTarget.submittedBy = String(
        report.submittedBy || updateTarget.submittedBy || 'Unknown User'
      );
      updateTarget.report = cloneReport(report);
      patch.updates = currentUpdates;
    }

    const existingReportIndex = reports.findIndex(
      existing =>
        Number(existing && existing.updateIndex) === Number(report.updateIndex) &&
        String((existing && existing.date) || '').trim() === String(report.date || '').trim()
    );

    if (existingReportIndex >= 0) {
      reports[existingReportIndex] = report;
    } else {
      reports.push(report);
    }
    patch.reports = reports;
  }

  if (Object.keys(patch).length === 0) return mapRow(existing);

  const { data, error } = await db
    .from('machines')
    .update(patch)
    .eq('id', existing.id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : mapRow(existing);
}

async function appendMachineReport(key, report) {
  const { data: existing, error: fetchError } = await findMachineQuery(key);
  if (fetchError) throw fetchError;
  if (!existing) return null;

  // Ref no is globally unique across every report in the system, same rule
  // as serial numbers — a brand-new report can never collide with one
  // that already exists (there's nothing to exclude; this report doesn't
  // exist yet).
  const refNoToCheck = report && report.refNo;
  if (refNoToCheck) {
    const duplicateRef = await findReportByRefNo(refNoToCheck);
    if (duplicateRef) {
      const err = new Error(
        `Ref No. "${refNoToCheck}" already used — ${duplicateRef.clientName} (${duplicateRef.serialNo}).`
      );
      err.code = 'DUPLICATE_REFNO';
      err.existing = duplicateRef;
      throw err;
    }
  }

  const reports = Array.isArray(existing.reports) ? [...existing.reports] : [];
  const updates = Array.isArray(existing.updates) ? [...existing.updates] : [];
  const clonedReport = cloneReport(report);
  reports.push(clonedReport);

  // Keep Machine History aligned with the saved report team and tie report to update row.
  if (report && report.submittedBy && updates.length > 0) {
    const requestedIndex = Number(report.updateIndex);
    const hasRequestedIndex =
      Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < updates.length;
    const updateTarget = hasRequestedIndex
      ? updates[requestedIndex]
      : updates[updates.length - 1];

    updateTarget.submittedBy = String(report.submittedBy);
    updateTarget.report = cloneReport(report);
  }

  const { data, error } = await db
    .from('machines')
    .update({ reports, updates })
    .eq('id', existing.id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

/**
 * Corrects an existing history entry (Install, PM/Parts Replacement report,
 * or an ad-hoc Cannibalize/Pull Out update) — for fixing a typo or a wrong
 * value the technician entered, not for changing what actually happened.
 * Admin-only; the caller (route) is responsible for enforcing that.
 *
 * `machineId` is the machine's DB primary key, not the client/serial/model
 * composite key the other functions use — some machines share a serial
 * number (a pre-existing data issue), so identifying by id avoids patching
 * the wrong row.
 *
 * `target` identifies which history row is being corrected:
 *   - { type: 'install' }
 *   - { type: 'update', updateIndex: N }   (works for both PM/Parts and ad-hoc)
 *
 * Locked (never patched, regardless of what the caller sends):
 *   unit, model, serialNo, date, submittedBy, activityType, updateIndex,
 *   maintenance/part service diffs.
 *
 * Ad-hoc updates carry no report entry, so report-only fields
 * (refNo, problem, action, recommendation) are silently ignored for those.
 */
async function correctHistoryEntry(machineId, target, patch = {}, editedBy = '') {
  const id = Number(machineId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Invalid machine id.');
    err.code = 'INVALID_MACHINE_ID';
    throw err;
  }
  if (!target || typeof target !== 'object') {
    const err = new Error('Invalid history target.');
    err.code = 'INVALID_TARGET';
    throw err;
  }

  const { data: existing, error: fetchError } = await db
    .from('machines')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return null;

  const reports = Array.isArray(existing.reports) ? existing.reports.map(cloneReport).filter(Boolean) : [];
  const updates = Array.isArray(existing.updates) ? existing.updates.map(cloneUpdate) : [];
  const editedAt = new Date().toISOString();
  // An admin correcting history can't reintroduce hours on an exempt unit
  // either — the entry is rewritten to 0 rather than rejected, since the
  // reading was never meaningful for this machine.
  const patchRow = {};

  // Unit, model and serial belong to the machine, not to one history entry, so
  // correcting them from any entry corrects the whole record. The route has
  // already validated them against the catalog and the serial rules.
  const has = key => Object.prototype.hasOwnProperty.call(patch, key);
  if (has('unit')) patchRow.unit = String(patch.unit || '').trim();
  if (has('model')) patchRow.model = String(patch.model || '').trim();
  if (has('serialNo')) patchRow.serial_no = String(patch.serialNo || '').trim();

  // Read after the unit/model correction: moving a unit onto (or off) an
  // hours-exempt type changes whether its readings mean anything.
  const exemptFromRunningHours = isRunningHoursExempt(
    has('unit') ? patchRow.unit : existing.unit,
    has('model') ? patchRow.model : existing.model
  );

  // A helper to apply the report-body fields to a report object in place.
  const patchReportFields = (report) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'problem')) report.problem = String(patch.problem || '');
    if (Object.prototype.hasOwnProperty.call(patch, 'action')) report.action = String(patch.action || '');
    if (Object.prototype.hasOwnProperty.call(patch, 'recommendation')) report.recommendation = String(patch.recommendation || '');
    if (Object.prototype.hasOwnProperty.call(patch, 'refNo')) report.refNo = String(patch.refNo || '');
    if (Object.prototype.hasOwnProperty.call(patch, 'technicians')) {
      report.technicians = Array.isArray(patch.technicians)
        ? patch.technicians.map(name => String(name || '').trim()).filter(Boolean)
        : [];
    }
    if (has('date')) report.date = String(patch.date || '');
    report.editedBy = String(editedBy || report.editedBy || '');
    report.editedAt = editedAt;
  };

  // Ref no is globally unique across every report in the system, the same
  // rule as serial numbers. Excludes this exact report (by machine + target)
  // so re-saving its own unchanged ref no isn't flagged as a collision.
  if (Object.prototype.hasOwnProperty.call(patch, 'refNo') && String(patch.refNo || '').trim()) {
    const duplicateRef = await findReportByRefNo(patch.refNo, { machineId: id, target });
    if (duplicateRef) {
      const err = new Error(
        `Ref No. "${patch.refNo}" already used — ${duplicateRef.clientName} (${duplicateRef.serialNo}).`
      );
      err.code = 'DUPLICATE_REFNO';
      err.existing = duplicateRef;
      throw err;
    }
  }

  // The machine's current running hours, status and SMR date are a copy of its
  // latest entry — every activity save writes both. Correcting that entry has
  // to correct the copy too, or Machine Details and the parts/maintenance clocks
  // keep reading the value that was just fixed. An older entry has been
  // superseded, so correcting it leaves the current values alone.
  const syncCurrentValues = (entry) => {
    if (exemptFromRunningHours) {
      patchRow.running_hours = 0;
    } else if (has('runningHours') && Number.isFinite(Number(entry.runningHours))) {
      patchRow.running_hours = Number(entry.runningHours);
    }
    // A blank status is a legacy entry that never had one, not a choice — the
    // forms require it — so it must not blank the machine's status.
    if (has('status') && String(entry.status || '').trim()) {
      patchRow.status = String(entry.status);
    }
    if (has('smrDate')) {
      patchRow.smr_date = String(entry.smrDate || '');
    }
  };

  if (target.type === 'install') {
    // Historical snapshot — once later updates exist they own the machine's
    // current running hours/status/SMR date. Until then the install is the
    // latest entry, so its correction carries through to them.
    if (exemptFromRunningHours) {
      patchRow.initial_running_hours = 0;
    } else if (Object.prototype.hasOwnProperty.call(patch, 'runningHours')) {
      const n = Number(patch.runningHours);
      if (Number.isFinite(n) && n >= 0) patchRow.initial_running_hours = n;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      patchRow.initial_status = String(patch.status || '');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
      patchRow.initial_description = String(patch.description || '');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'smrDate')) {
      patchRow.initial_smr_date = String(patch.smrDate || '');
    }
    if (has('date')) {
      patchRow.date_installed = String(patch.date || '');
    }
    if (updates.length === 0) {
      syncCurrentValues({
        runningHours: patchRow.initial_running_hours,
        status: patchRow.initial_status,
        smrDate: patchRow.initial_smr_date
      });
    }

    const installIdx = reports.findIndex(r => r.updateIndex === null || r.updateIndex === undefined);
    if (installIdx >= 0) {
      patchReportFields(reports[installIdx]);
      patchRow.reports = reports;
    }
  } else if (target.type === 'update') {
    const updateIndex = Number(target.updateIndex);
    if (!Number.isInteger(updateIndex) || updateIndex < 0 || updateIndex >= updates.length) {
      const err = new Error('Update entry not found at that index.');
      err.code = 'UPDATE_NOT_FOUND';
      throw err;
    }

    const targetUpdate = updates[updateIndex];
    if (exemptFromRunningHours) {
      targetUpdate.runningHours = 0;
    } else if (Object.prototype.hasOwnProperty.call(patch, 'runningHours')) {
      const n = Number(patch.runningHours);
      if (Number.isFinite(n) && n >= 0) targetUpdate.runningHours = n;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      targetUpdate.status = String(patch.status || '');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
      targetUpdate.description = String(patch.description || '');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'smrDate')) {
      targetUpdate.smrDate = String(patch.smrDate || '');
    }
    if (has('date')) {
      targetUpdate.date = String(patch.date || '');
    }
    if (updateIndex === updates.length - 1) {
      syncCurrentValues(targetUpdate);
    }

    // If the update has an attached report, keep the standalone reports[j]
    // and the mirrored updates[i].report in sync. Ad-hoc updates
    // (Cannibalize/Pull Out) have no report — report-specific fields are
    // silently ignored for those.
    // The install report has updateIndex === null (or undefined), and
    // Number(null) === 0 — filter it out explicitly so the install report
    // isn't misread as "linked to updates[0]".
    const linkedReportIdx = reports.findIndex(r => {
      if (r.updateIndex === null || r.updateIndex === undefined) return false;
      return Number(r.updateIndex) === updateIndex;
    });
    if (linkedReportIdx >= 0) {
      patchReportFields(reports[linkedReportIdx]);
      targetUpdate.report = cloneReport(reports[linkedReportIdx]);
      patchRow.reports = reports;
    }

    updates[updateIndex] = targetUpdate;
    patchRow.updates = updates;
  } else {
    const err = new Error('Unknown history target type.');
    err.code = 'INVALID_TARGET';
    throw err;
  }

  if (Object.keys(patchRow).length === 0) return mapRow(existing);

  const { data, error } = await db
    .from('machines')
    .update(patchRow)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data) : null;
}

/**
 * Move one machine row to another client. Client identity lives only in
 * client_id / client_name / location, so those three fields are the whole
 * move — updates and reports stay on the row and travel with the unit.
 * `location` comes from the destination client, the same way addMachine
 * callers set it.
 *
 * The update only matches while the row still sits under `fromClientId`, so
 * a stale page or a double submit can't move a unit someone already moved.
 * Returns the moved row, or null when the row is gone or no longer under
 * `fromClientId`.
 */
async function transferMachineToClient(machineId, fromClientId, toClient) {
  const { data, error } = await db
    .from('machines')
    .update({
      client_id: String(toClient.id || '').trim().toLowerCase(),
      client_name: toClient.name,
      location: toClient.location || null
    })
    .eq('id', machineId)
    .eq('client_id', String(fromClientId || '').trim().toLowerCase())
    .select('*');
  if (error) throw error;
  return data && data.length ? mapRow(data[0]) : null;
}

/**
 * Disable or re-enable one machine row. A disabled unit keeps its serial,
 * history and reports; it just stops counting as installed or in use.
 *
 * Each direction only matches a row that is still in the opposite state, so a
 * double click or a stale page can't re-stamp the date of a unit that is already
 * disabled. Returns the updated row, or null when the row is gone or already in
 * the requested state.
 *
 * Throws an error with code MACHINE_DISABLE_UNAVAILABLE when the disabled_at
 * column doesn't exist yet (migration 004 not run).
 */
async function setMachineDisabled(machineId, disabled, by = '') {
  const patch = disabled
    ? { disabled_at: new Date().toISOString(), disabled_by: String(by || '') }
    : { disabled_at: null, disabled_by: null };

  let query = db.from('machines').update(patch).eq('id', machineId);
  query = disabled ? query.is('disabled_at', null) : query.not('disabled_at', 'is', null);

  const { data, error } = await query.select('*');
  if (error) {
    // 42703 = "undefined column" (database/db.js maps MySQL errors to Postgres codes).
    if (error.code === '42703' || error.code === 'PGRST204' || /disabled_(at|by)/.test(error.message || '')) {
      const unavailable = new Error('Machine disable columns are missing — run migration 004.');
      unavailable.code = 'MACHINE_DISABLE_UNAVAILABLE';
      throw unavailable;
    }
    throw error;
  }
  return data && data.length ? mapRow(data[0]) : null;
}

module.exports = {
  searchMachinesBySerialNo,
  listAllMachines,
  findMachineById,
  transferMachineToClient,
  setMachineDisabled,
  listMachinesByClientId,
  findMachineBySerialNo,
  findReportByRefNo,
  addMachine,
  updateMachine,
  appendMachineReport,
  correctHistoryEntry
};
