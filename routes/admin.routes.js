const express = require('express');
const { buildRepairPartsUsage } = require('../lib/repair-parts-usage');
const crypto = require('crypto');
const {
  listStaffAccounts,
  listAdminAccountNames,
  findAccountByEmail,
  findAccountByUsername,
  updateUserAccount,
  setUserStatus
} = require('../database/accounts.store');
const { createInvite } = require('../database/invites.store');
const { createPasswordReset } = require('../database/password-resets.store');
const {
  listClients,
  findClientById,
  createClient,
  updateClient,
  setClientStatus,
  filterClientsForUser,
  assignClientSales,
  isSalesAssignmentAvailable
} = require('../database/clients.store');
const { listAllMachines, transferMachineToClient, setMachineDisabled, searchMachinesBySerialNo, findMachineById } = require('../database/machines.store');
const { insertUnitModel, findUnitModelById, deleteUnitModel, listUnitModels } = require('../database/unit-models.store');
const { listParts, findPartById, insertPart, updatePart, deletePart, partKey } = require('../database/parts.store');
const {
  listSchedules,
  insertSchedule,
  findScheduleById,
  updateSchedule,
  setScheduleStatus,
  scheduleToday,
  deleteSchedule
} = require('../database/schedules.store');
const {
  normalizeUnitKey,
  normalizeModelKey,
  cleanName,
  mergeCatalog,
  getUnitCatalog,
  findUnitName,
  findModelConflict
} = require('../lib/unit-catalog');
const { requireAdmin, requireAdminOrSales } = require('../middleware/auth');
const { sendGmailAppLink } = require('../lib/gmail-send');
const { isPushConfigured, notifyUser, scheduleNotification } = require('../lib/push-notify');

const router = express.Router();

const nameRegex = /^[A-Za-z\s.-]+$/;
const emailRegex = /^(?=.{1,254}$)(?=.{1,64}@)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const inviteRoles = new Set(['employee', 'admin', 'sales']);
const inviteBranches = new Set(['Silang', 'Davao', 'Cebu', 'Manila']);
const inviteDepartments = new Set(['TECHNICAL DEPARTMENT', 'SALES DEPARTMENT']);

function properCase(value = '') {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function slugify(value = '') {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isLocalBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const hostMatch = normalized.match(/^(?:https?:\/\/)?([^/:?#]+)/i);
  const host = hostMatch ? hostMatch[1] : normalized;

  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)
  );
}

function buildAppBaseUrl(req) {
  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl && !isLocalBaseUrl(baseUrl)) {
    return baseUrl.replace(/\/$/, '');
  }

  return `${req.protocol}://${req.get('host')}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseActivityDate(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const parsed = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const slashDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDate) {
    const parsed = new Date(Number(slashDate[3]), Number(slashDate[2]) - 1, Number(slashDate[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDayLabel(dateValue) {
  return dateValue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'active') {
    return 'Active';
  }
  if (value === 'maintenance') {
    return 'Maintenance';
  }
  if (value === 'faulty') {
    return 'Faulty';
  }
  if (value === 'inactive') {
    return 'Inactive';
  }
  return 'Unspecified';
}

function normalizeContributorName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function splitContributorNames(value) {
  return String(value || '')
    .split(',')
    .map(normalizeContributorName)
    .filter(Boolean);
}

function getReportContributors(report) {
  const submitted = splitContributorNames(report && report.submittedBy);
  const technicians = Array.isArray(report && report.technicians)
    ? report.technicians.flatMap(name => splitContributorNames(name))
    : [];

  const contributors = [...submitted, ...technicians]
    .filter(Boolean)
    .filter((name, index, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === index)
    .filter(name => name.toLowerCase() !== 'system seed');

  return contributors;
}

function getMachineContributors(machine) {
  const technicians = Array.isArray(machine && machine.technicians)
    ? machine.technicians.flatMap(name => splitContributorNames(name))
    : [];
  const submitted = splitContributorNames(machine && machine.submittedBy);

  return [...technicians, ...submitted]
    .filter(Boolean)
    .filter((name, index, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === index)
    .filter(name => name.toLowerCase() !== 'system seed');
}

/**
 * The date an activity actually happened, which is the SMR date whenever one
 * was recorded — not the date the record was keyed in. The two routinely
 * differ by more than a year: a backlog encoded in Sept 2026 carries SMR dates
 * from 2025, and reading the encoded date made every one of those look like
 * Sept 2026 work.
 *
 * Falls back to the encoded date, because only about a fifth of rows carry an
 * SMR date so far. Dropping the rest would empty the dashboard rather than
 * correct it; coverage grows as technicians fill the field in.
 */
function effectiveActivityDate(smrDate, encodedDate) {
  return String(smrDate || '').trim() || encodedDate;
}

/**
 * True when an SMR date was actually recorded and can be read. Technician
 * History lists only these, because its dates must be when the work happened —
 * the encoded-date fallback in effectiveActivityDate would date a backlog by
 * the day it was typed in.
 */
function hasRecordedSmrDate(smrDate) {
  return Boolean(parseActivityDate(smrDate));
}

/**
 * Per-technician work history for the Technician History tab: only rows with a
 * recorded SMR date. Technician cards are ordered by record count descending,
 * so the highest count starts at the upper left and continues left-to-right.
 * Built from the uncapped activity rows so a technician's older work isn't cut
 * off by MONITOR_ACTIVITY_ROW_CAP. A row naming several technicians appears in
 * each of their histories.
 */
function buildTechnicianHistory(activityRows = []) {
  const rows = [];
  const technicians = new Map();

  activityRows
    .filter(row => row.hasSmrDate && row.dateSort)
    .forEach(row => {
      const names = (Array.isArray(row.technicians) ? row.technicians : [])
        .map(normalizeContributorName)
        .filter(Boolean);
      if (!names.length) return;

      const rowIndex = rows.length;
      rows.push({
        date: row.dateLabel,
        dateSort: row.dateSort,
        technicians: names,
        client: row.clientName,
        serialNo: row.serialNo,
        unit: row.unitName,
        model: row.modelName,
        activity: row.activityLabel,
        parts: row.partsCsv || '',
        problem: row.problem,
        action: row.action,
        notes: row.sourceLabel === 'Update' ? row.description : ''
      });

      names.forEach(name => {
        const key = name.toLowerCase();
        if (!technicians.has(key)) {
          technicians.set(key, { name, count: 0, latestSort: 0, latestDate: '', rowIndexes: [] });
        }
        const entry = technicians.get(key);
        entry.count += 1;
        entry.rowIndexes.push(rowIndex);
        if (row.dateSort > entry.latestSort) {
          entry.latestSort = row.dateSort;
          entry.latestDate = row.dateLabel;
        }
      });
    });

  return {
    rows,
    technicians: Array.from(technicians.values())
      .sort((a, b) => b.count - a.count
        || b.latestSort - a.latestSort
        || a.name.localeCompare(b.name))
  };
}

/**
 * True when a report is the machine's installation record rather than one
 * attached to a service update.
 *
 * The null check has to come first: installation reports are stored with
 * `updateIndex: null`, and `Number(null)` is 0 — indistinguishable from a
 * report genuinely attached to updates[0]. Converting first classified every
 * installation report as service work, so the dashboard saw none and built a
 * placeholder from the machine row instead. database/machines.store.js guards
 * the same trap in correctHistoryEntry.
 */
function isInstallationReport(report) {
  const rawIndex = report && report.updateIndex;
  if (rawIndex === null || rawIndex === undefined || rawIndex === '') {
    return true;
  }
  const index = Number(rawIndex);
  return !(Number.isInteger(index) && index >= 0);
}

function formatMonitorDate(value) {
  const parsed = parseActivityDate(value);
  if (!parsed) {
    return {
      label: '—',
      sortValue: 0
    };
  }

  return {
    label: parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }),
    sortValue: parsed.getTime()
  };
}

function makeActivityLabel(activityKind) {
  if (activityKind === 'installed') {
    return 'Unit Installed';
  }
  if (activityKind === 'pull_out') {
    return 'Pull Out';
  }
  if (activityKind === 'cannibalize') {
    return 'Cannibalize';
  }
  if (activityKind === 'repair') {
    return 'Repair';
  }
  if (activityKind === 'inspection') {
    return 'Inspection';
  }
  if (activityKind === 'maintenance_parts') {
    return 'Maintenance + Parts';
  }
  if (activityKind === 'parts') {
    return 'Parts Change';
  }
  if (activityKind === 'maintenance') {
    return 'Maintenance';
  }
  return 'Update';
}

function normalizeUpdateActivityKind(update, { hasMaintenance, hasParts }) {
  const raw = String(update && update.activityType || '').trim().toLowerCase();

  if (raw === 'pull out') {
    return 'pull_out';
  }
  if (raw === 'cannibalize') {
    return 'cannibalize';
  }
  if (raw === 'repair') {
    return 'repair';
  }
  if (raw === 'inspection') {
    return 'inspection';
  }
  if (raw === 'parts replacement') {
    return 'parts';
  }
  if (raw === 'preventive maintenance') {
    return hasParts ? 'maintenance_parts' : 'maintenance';
  }

  if (hasMaintenance && hasParts) {
    return 'maintenance_parts';
  }
  if (hasMaintenance) {
    return 'maintenance';
  }
  if (hasParts) {
    return 'parts';
  }
  return 'maintenance';
}

function summarizePartList(parts = [], limit = 3) {
  const values = Array.from(new Set(
    (Array.isArray(parts) ? parts : [])
      .map(part => normalizeContributorName(part))
      .filter(Boolean)
  ));

  if (!values.length) {
    return {
      label: 'No parts updated',
      csv: ''
    };
  }

  if (values.length <= limit) {
    return {
      label: values.join(', '),
      csv: values.join(', ')
    };
  }

  return {
    label: `${values.slice(0, limit).join(', ')} +${values.length - limit} more`,
    csv: values.join(', ')
  };
}

function getMonitorActivityRowCap() {
  const raw = process.env.MONITOR_ACTIVITY_ROW_CAP;
  if (raw === undefined || raw === '') {
    return 4000;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return Infinity;
  }
  return Math.floor(n);
}

function buildMonitorActivityRows(machines = []) {
  const activityRows = [];
  const technicianOptions = new Set();
  const clientOptions = new Set();
  const unitOptions = new Set();
  const modelOptions = new Set();
  const unitModelOptions = new Map();

  for (const machine of machines) {
    const machineContributorsOnce = getMachineContributors(machine);
    const machineClientId = String(machine.clientId || '').trim().toLowerCase();
    const clientName = String(machine.clientName || machineClientId || 'Unknown Client').trim() || 'Unknown Client';
    const modelName = String(machine.model || '').trim() || 'Unknown Model';
    const unitName = String(machine.unit || '').trim() || 'Unknown Unit';
    const serialNo = String(machine.serialNo || '').trim() || '—';
    const machineStatus = normalizeStatus(machine.status);
    const reports = Array.isArray(machine.reports) ? machine.reports : [];
    const updates = Array.isArray(machine.updates) ? machine.updates : [];

    clientOptions.add(clientName);
    unitOptions.add(unitName);
    modelOptions.add(modelName);
    if (!unitModelOptions.has(unitName)) {
      unitModelOptions.set(unitName, new Set());
    }
    unitModelOptions.get(unitName).add(modelName);

    const installationReports = reports.filter(isInstallationReport);

    const installationRecords = installationReports.length
      ? installationReports.map((report, reportIndex) => ({ report, reportIndex }))
      : [{
        report: {
          date: machine.dateInstalled,
          submittedBy: machine.submittedBy,
          technicians: machineContributorsOnce,
          problem: `Initial installation record for ${unitName} ${modelName}.`,
          action: String(machine.description || '').trim() || 'Installation details recorded.',
          recommendation: 'Verify installation details against the physical unit.'
        },
        reportIndex: -1
      }];

    installationRecords.forEach(({ report, reportIndex }) => {

      // initialSmrDate, not smrDate: the machine's current SMR date is
      // overwritten by every service update, so reading it here dated a 2024
      // installation as today the moment someone logged work on that unit.
      const dateInfo = formatMonitorDate(
        effectiveActivityDate(machine.initialSmrDate, report && report.date)
      );
      const hasSmrDate = hasRecordedSmrDate(machine.initialSmrDate);
      const technicians = getReportContributors(report);
      const technicianNames = technicians.length
        ? technicians
        : (machineContributorsOnce.length
          ? machineContributorsOnce
          : [normalizeContributorName(report && report.submittedBy) || 'Unknown Technician']);
      const technicianLabel = technicianNames.join(', ');
      const primaryTechnician = technicianNames[0] || 'Unknown Technician';
      const description = String(machine.description || '').trim() || 'Unit installation record';
      const problem = String(report && report.problem || '').trim();
      const action = String(report && report.action || '').trim();
      const recommendation = String(report && report.recommendation || '').trim();
      const details = [report && report.problem, report && report.action, report && report.recommendation]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(' • ');

      technicianNames.forEach(name => technicianOptions.add(name));
      activityRows.push({
        id: `${machineClientId || 'client'}-${serialNo}-${dateInfo.sortValue}-r${reportIndex}`,
        dateLabel: dateInfo.label,
        dateSort: dateInfo.sortValue,
        // Orders same-dated rows for one unit: an installation always precedes
        // the service done to it, so a unit installed and repaired on the same
        // date reads as Repair rather than whichever name sorted first.
        sequence: 0,
        technician: technicianLabel || primaryTechnician,
        technicianSort: primaryTechnician,
        technicians: technicianNames,
        submittedBy: primaryTechnician,
        techniciansText: technicianNames.join(', '),
        clientName,
        clientId: machineClientId,
        clientLocation: String(machine.location || '').trim(),
        unitName,
        modelName,
        serialNo,
        runningHours: Number(machine.runningHours) || 0,
        activityKind: 'installed',
        activityTags: ['installed'],
        activityLabel: makeActivityLabel('installed'),
        sourceLabel: 'Installation',
        hasSmrDate,
        partsLabel: 'No parts updated',
        partsCsv: '',
        submittedBy: primaryTechnician,
        description,
        problem,
        action,
        recommendation,
        maintenanceSummary: '',
        details: details || 'Unit installation record',
        machineStatus,
        // What the technician chose when logging the installation.
        outcomeStatus: normalizeStatus(machine.initialStatus || machine.status)
      });
    });

    updates.forEach((update, updateIndex) => {
      const dateInfo = formatMonitorDate(
        effectiveActivityDate(update && update.smrDate, update && update.date)
      );
      const hasSmrDate = hasRecordedSmrDate(update && update.smrDate);
      const partsSummary = summarizePartList(update && update.partsUpdated);
      const hasMaintenance = Boolean(update && update.maintenanceUpdated);
      const hasParts = Array.isArray(update && update.partsUpdated) && update.partsUpdated.length > 0;
      const activityKind = normalizeUpdateActivityKind(update, { hasMaintenance, hasParts });

      const updateReportContributors = update && update.report ? getReportContributors(update.report) : [];
      const technicianNames = updateReportContributors.length
        ? updateReportContributors
        : [normalizeContributorName(update && update.submittedBy) || 'Unknown Technician'];
      const technicianLabel = technicianNames.join(', ');
      const primaryTechnician = technicianNames[0] || 'Unknown Technician';

      const details = [
        update && update.description,
        update && update.maintenanceServiceDate ? `Maintenance date ${update.maintenanceServiceDate}` : '',
        update && update.report && update.report.problem ? update.report.problem : ''
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(' • ');

      const emitRows = [];
      if (activityKind === 'pull_out') {
        emitRows.push({
          activityKind: 'pull_out',
          activityTags: ['pull_out'],
          activityLabel: makeActivityLabel('pull_out'),
          partsLabel: 'Entire unit pulled out',
          partsCsv: ''
        });
      } else if (activityKind === 'cannibalize') {
        emitRows.push({
          activityKind: 'cannibalize',
          activityTags: ['cannibalize'],
          activityLabel: makeActivityLabel('cannibalize'),
          partsLabel: hasParts ? partsSummary.label : 'No parts selected',
          partsCsv: hasParts ? partsSummary.csv : ''
        });
      } else if (activityKind === 'repair') {
        // Parts Used on a Repair are picked from the admin Parts list.
        const repairParts = Array.isArray(update && update.partsUsed) ? update.partsUsed : [];
        const repairSummary = summarizePartList(repairParts);
        emitRows.push({
          activityKind: 'repair',
          activityTags: ['repair'],
          activityLabel: makeActivityLabel('repair'),
          partsLabel: repairParts.length ? repairSummary.label : 'Repair — no parts used',
          partsCsv: repairParts.length ? repairSummary.csv : '',
          repairParts
        });
      } else if (activityKind === 'inspection') {
        emitRows.push({
          activityKind: 'inspection',
          activityTags: ['inspection'],
          activityLabel: makeActivityLabel('inspection'),
          partsLabel: 'Inspection — no parts checker',
          partsCsv: ''
        });
      } else if (activityKind === 'maintenance_parts') {
        emitRows.push({
          activityKind: 'maintenance_parts',
          activityTags: ['maintenance', 'parts'],
          activityLabel: makeActivityLabel('maintenance_parts'),
          partsLabel: partsSummary.label,
          partsCsv: partsSummary.csv
        });
      } else if (activityKind === 'maintenance') {
        emitRows.push({
          activityKind: 'maintenance',
          activityTags: ['maintenance'],
          activityLabel: makeActivityLabel('maintenance'),
          partsLabel: 'Maintenance service',
          partsCsv: ''
        });
      } else if (activityKind === 'parts') {
        emitRows.push({
          activityKind: 'parts',
          activityTags: ['parts'],
          activityLabel: makeActivityLabel('parts'),
          partsLabel: partsSummary.label,
          partsCsv: partsSummary.csv
        });
      } else {
        emitRows.push({
          activityKind: 'maintenance',
          activityTags: ['maintenance'],
          activityLabel: makeActivityLabel('maintenance'),
          partsLabel: 'Maintenance service',
          partsCsv: ''
        });
      }

      technicianNames.forEach(name => technicianOptions.add(name));
      const description = String(update && update.description || '').trim() || 'Service update';
      const problem = String(update && update.report && update.report.problem || '').trim();
      const action = String(update && update.report && update.report.action || '').trim();
      const recommendation = String(update && update.report && update.report.recommendation || '').trim();
      const maintenanceSummary = [
        update && update.maintenanceServiceDate ? `Maintenance date ${update.maintenanceServiceDate}` : '',
        partsSummary.csv ? `Parts changed: ${partsSummary.csv}` : ''
      ].filter(Boolean).join(' • ');
      emitRows.forEach((activity, activityIndex) => {
        activityRows.push({
          id: `${machineClientId || 'client'}-${serialNo}-${dateInfo.sortValue}-u${updateIndex}-a${activityIndex}`,
          dateLabel: dateInfo.label,
          dateSort: dateInfo.sortValue,
          sequence: updateIndex + 1,
          technician: technicianLabel || primaryTechnician,
          technicianSort: primaryTechnician,
          technicians: technicianNames,
          clientName,
          clientId: machineClientId,
          clientLocation: String(machine.location || '').trim(),
          unitName,
          modelName,
          serialNo,
          runningHours: (update && update.runningHours !== undefined && update.runningHours !== null && String(update.runningHours).trim() !== '') ? Number(update.runningHours) : '',
          activityKind: activity.activityKind,
          activityTags: activity.activityTags,
          activityLabel: activity.activityLabel,
          sourceLabel: 'Update',
          hasSmrDate,
          partsLabel: activity.partsLabel,
          partsCsv: activity.partsCsv,
          submittedBy: primaryTechnician,
          techniciansText: technicianNames.join(', '),
          description,
          problem,
          action,
          recommendation,
          maintenanceSummary,
          // Only Repair rows have these: the parts listed under Parts Used.
          repairParts: activity.repairParts || [],
          details: details || 'Service update',
          // show update status only when explicitly provided; otherwise leave blank so UI shows '-'
          machineStatus: (update && update.status) ? normalizeStatus(update.status) : '',
          outcomeStatus: (update && update.status) ? normalizeStatus(update.status) : ''
        });
      });
    });
  }

  activityRows.sort((a, b) => {
    return b.dateSort - a.dateSort
      || (b.sequence || 0) - (a.sequence || 0)
      || a.clientName.localeCompare(b.clientName)
      || a.technician.localeCompare(b.technician);
  });

  return {
    activityRows,
    technicianOptions: Array.from(technicianOptions).sort((a, b) => a.localeCompare(b)),
    clientOptions: Array.from(clientOptions).sort((a, b) => a.localeCompare(b)),
    unitOptions: Array.from(unitOptions).sort((a, b) => a.localeCompare(b)),
    modelOptions: Array.from(modelOptions).sort((a, b) => a.localeCompare(b)),
    unitModelOptions: Array.from(unitModelOptions.entries()).reduce((acc, [unit, models]) => {
      acc[unit] = Array.from(models).sort((a, b) => a.localeCompare(b));
      return acc;
    }, {})
  };
}

/**
 * True when a machine's installation falls inside the selected range. Both the
 * "Units Installed" KPI and the Install base profile go through this, so the
 * card can never claim a fleet mix for a period that installed nothing.
 *
 * With no range (All Time) every machine counts, so the cards agree with the
 * fleet total instead of silently dropping machines with an unparseable
 * installation date.
 */
function dateValueInRange(value, range) {
  if (!range || !range.start || !range.end) return true;
  const when = value instanceof Date ? value : parseActivityDate(value);
  return Boolean(when && when >= range.start && when <= range.end);
}

function machineInstalledInRange(machine, range) {
  return dateValueInRange(machine && machine.dateInstalled, range);
}

/**
 * A disabled unit stays on file with its serial, history and reports, but it is
 * no longer installed or in use. Every unit count on the dashboard (Units
 * Installed, the pending/faulty/completion figures, the install base profile,
 * Client Unit Progress) leaves it out; the Units Disabled card counts it.
 *
 * Its past work is still real work, so the activity log, technician history and
 * technician tallies keep reading it.
 */
function isMachineDisabled(machine) {
  return Boolean(machine && machine.disabledAt);
}

/**
 * Counts how many units were actually *installed* inside the selected range,
 * grouped by client — "3 units went in at Alaska today". Distinct from
 * `totalUnits`, which counts every machine that saw any activity in the range
 * no matter when it was installed.
 *
 * Grouped by client ID and labelled with the client's current name. A machine
 * keeps the client name it was installed under, so after a rename grouping by
 * that copy split one client into several cards ("Coke" beside "Coca-Cola
 * Cebu"). The machine's own name is only the fallback for an unknown client ID.
 */
function buildUnitsInstalledByClient(machines = [], range = null, clients = []) {
  const currentNames = new Map();
  for (const client of clients) {
    const id = String(client.id || '').trim().toLowerCase();
    if (id) currentNames.set(id, String(client.name || '').trim());
  }

  const groups = new Map();
  for (const machine of machines) {
    if (isMachineDisabled(machine)) continue;
    if (!machineInstalledInRange(machine, range)) continue;
    const clientId = String((machine && machine.clientId) || '').trim().toLowerCase();
    const savedName = String((machine && machine.clientName) || '').trim();
    const clientName = currentNames.get(clientId) || savedName || clientId || 'Unknown Client';
    const key = clientId || `name:${clientName.toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { clientName, count: 1 });
  }

  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count || a.clientName.localeCompare(b.clientName));
}

/**
 * True when an activity row's own event date falls inside the selected period.
 * Every range-aware figure on the dashboard goes through this, so "Today" means
 * the same thing everywhere: what was actually logged today, not the whole
 * history of a machine that happened to be touched today.
 */
function activityRowInRange(row, range) {
  if (!range || !range.start || !range.end) return true;
  const when = Number(row && row.dateSort);
  if (!when) return false;
  return when >= range.start.getTime() && when <= range.end.getTime();
}

/**
 * Per-technician tally of the reports logged inside the selected range — the
 * same rows the Technician Activity Log lists. Every kind of record counts as
 * one report: installation, maintenance, parts change, repair, cannibalize and
 * pull out alike. A row with several technicians on it counts once for each of
 * them, matching how the rest of the dashboard attributes shared jobs.
 */
// The Tech Reports Log ranks technicians, so accounts that only key records in
// or administer the system stay off it. The two encoder accounts are fixed; the
// admin accounts are read from the accounts table, so a new admin drops off the
// log without a code change. Cached briefly: buildMonitoring() is synchronous.
const NON_TECHNICIAN_NAMES = new Set(['data encoder', 'data encoder two', 'msi system administrator']);
const ADMIN_NAMES_TTL_MS = 60 * 1000;
let adminNamesCache = { names: new Set(), loadedAt: 0 };

async function refreshAdminNames() {
  if (Date.now() - adminNamesCache.loadedAt < ADMIN_NAMES_TTL_MS) return;
  try {
    const names = await listAdminAccountNames();
    adminNamesCache = {
      names: new Set(names.map(name => normalizeContributorName(name).toLowerCase())),
      loadedAt: Date.now()
    };
  } catch (err) {
    console.error('[admin names] could not load:', err.message || err);
  }
}

function isNonTechnicianName(name) {
  const key = normalizeContributorName(name).toLowerCase();
  return NON_TECHNICIAN_NAMES.has(key) || adminNamesCache.names.has(key);
}

function buildTechReportLog(activityRows = [], range = null) {
  const rollup = new Map();

  for (const row of activityRows) {
    if (!activityRowInRange(row, range)) continue;

    const names = Array.isArray(row && row.technicians) && row.technicians.length
      ? row.technicians
      : [(row && row.technician) || 'Unknown Technician'];
    // Resolved means the report's status is "Finished – unit is working"
    // (stored as Active). Any other status, or none, is unresolved.
    const resolved = row && row.outcomeStatus === 'Active' ? 1 : 0;
    for (const rawName of names) {
      const name = String(rawName || '').trim() || 'Unknown Technician';
      if (isNonTechnicianName(name)) continue;
      let entry = rollup.get(name);
      if (!entry) {
        entry = { name, total: 0, resolved: 0, unresolved: 0 };
        rollup.set(name, entry);
      }
      entry.total += 1;
      entry.resolved += resolved;
      entry.unresolved += 1 - resolved;
    }
  }

  return Array.from(rollup.values())
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// What a technician picks in the status dropdown and what the dashboard calls
// it. The stored value never changes ("Active" stays "Active" in the database
// and the Service Report), only the wording shown to people.
const STATUS_OUTCOMES = {
  Active: { label: 'Finished', group: 'finished' },
  Maintenance: { label: 'In progress – under maintenance', group: 'in_progress' },
  Faulty: { label: 'In progress – still faulty', group: 'in_progress' },
  Inactive: { label: 'Out of service', group: 'out_of_service' }
};
const STATUS_GROUP_ORDER = ['in_progress', 'finished', 'out_of_service', 'unspecified'];

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Today's work, one row per serial number: who did it, the status they chose,
 * the client and the serial. Always "today" — the Monitoring Overview's date
 * range deliberately does not apply, because this card answers "what is being
 * worked on right now".
 *
 * A serial appears once, under its latest activity today, and carries the
 * status chosen on that activity rather than the unit's current status.
 * `activityRows` is sorted newest-first, so the first row seen per serial wins.
 * Encoder and admin accounts are dropped from the names when a technician is
 * also named on the record.
 */
function buildTodaySerialStatus(activityRows = []) {
  const range = todayRange();
  const seenSerials = new Set();
  const rows = [];

  for (const row of activityRows) {
    if (!activityRowInRange(row, range)) continue;

    const serial = String((row && row.serialNo) || '').trim();
    if (!serial || serial === '—') continue;
    const key = serial.toLowerCase();
    if (seenSerials.has(key)) continue;
    seenSerials.add(key);

    // Encoder and admin names are dropped when a technician is also named. A
    // job logged by one of those accounts alone still shows, under that name:
    // its status matters here even when nobody else is on the record.
    const allNames = Array.isArray(row.technicians) ? row.technicians : [];
    const technicianNames = allNames.filter(name => !isNonTechnicianName(name));
    const technicians = technicianNames.length ? technicianNames : allNames;
    if (!technicians.length) continue;

    const outcome = STATUS_OUTCOMES[row.outcomeStatus]
      || { label: 'No status recorded', group: 'unspecified' };
    rows.push({
      technicians: technicians.join(', '),
      statusLabel: outcome.label,
      group: outcome.group,
      client: row.clientName,
      serialNo: serial
    });
  }

  rows.sort((a, b) => STATUS_GROUP_ORDER.indexOf(a.group) - STATUS_GROUP_ORDER.indexOf(b.group));

  const counts = { finished: 0, in_progress: 0, out_of_service: 0, unspecified: 0 };
  rows.forEach(row => { counts[row.group] += 1; });
  return { rows, counts, total: rows.length };
}

const MONITOR_PARTS_CATALOG = {
  CIJ: {
    '9450': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'A40846 RECOVERY TOOL', expiryHours: 8000 },
      { name: 'ENM 40209 AIR FILTER', expiryHours: 8000 },
      { name: 'ENM 19134 INK FILTER', expiryHours: 8000 },
      { name: 'ENM 40830 IP54 OUTLET FOAM FILTER', expiryHours: 8000 },
      { name: 'ENM 5629 PRESSURE PUMP', expiryHours: 8000 }
    ],
    '9410': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'A40846 RECOVERY TOOL', expiryHours: 8000 },
      { name: 'ENM 40209 AIR FILTER', expiryHours: 8000 },
      { name: 'ENM 19134 INK FILTER', expiryHours: 8000 },
      { name: 'ENM 40830 IP54 OUTLET FOAM FILTER', expiryHours: 8000 },
      { name: 'ENM 5629 PRESSURE PUMP', expiryHours: 8000 }
    ],
    '9450S': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'A40846 RECOVERY TOOL', expiryHours: 8000 },
      { name: 'ENM 40209 AIR FILTER', expiryHours: 8000 },
      { name: 'ENM 19134 INK FILTER', expiryHours: 8000 },
      { name: 'ENM 40830 IP54 OUTLET FOAM FILTER', expiryHours: 8000 },
      { name: 'ENM 5629 PRESSURE PUMP', expiryHours: 8000 }
    ],
    '9450E': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'A40846 RECOVERY TOOL', expiryHours: 8000 },
      { name: 'ENM 40209 AIR FILTER', expiryHours: 8000 },
      { name: 'ENM 19134 INK FILTER', expiryHours: 8000 },
      { name: 'ENM 40830 IP54 OUTLET FOAM FILTER', expiryHours: 8000 },
      { name: 'ENM 5629 PRESSURE PUMP', expiryHours: 8000 }
    ],
    '9330': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'A40846 RECOVERY TOOL', expiryHours: 8000 },
      { name: 'ENM 40209 AIR FILTER', expiryHours: 8000 },
      { name: 'ENM 19134 INK FILTER', expiryHours: 8000 },
      { name: 'ENM 40830 IP54 OUTLET FOAM FILTER', expiryHours: 8000 },
      { name: 'ENM 5629 PRESSURE PUMP', expiryHours: 8000 }
    ],
    '9750': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'A40846 RECOVERY TOOL', expiryHours: 8000 },
      { name: 'ENM 40209 AIR FILTER', expiryHours: 8000 },
      { name: 'ENM 19134 INK FILTER', expiryHours: 8000 },
      { name: 'ENM 40830 IP54 OUTLET FOAM FILTER', expiryHours: 8000 },
      { name: 'ENM 5629 PRESSURE PUMP', expiryHours: 8000 }
    ],
    '9750+': [
      { name: 'ENM 38941 GUTTER BLOCK', expiryMonths: 4 },
      { name: 'ENM 47458 EHV COVER', expiryMonths: 6 },
      { name: 'ENM 49967 EQUIP PRINT HEADBOARD', expiryMonths: 6 },
      { name: 'ENM 46408 FOUR ELECTOVALVE BLOCK', expiryMonths: 4 },
      { name: 'ENM 38980 MODULATION ASSEMBLY', expiryMonths: 6 },
      { name: 'A40846 RECOVERY TOOL', expiryHours: 8000 },
      { name: 'ENM 40209 AIR FILTER', expiryHours: 8000 },
      { name: 'ENM 19134 INK FILTER', expiryHours: 8000 },
      { name: 'ENM 40830 IP54 OUTLET FOAM FILTER', expiryHours: 8000 },
      { name: 'ENM 5629 PRESSURE PUMP', expiryHours: 8000 }
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

// The install base profile is keyed off the same catalog the Add Printer form
// validates against — including units added from the Units & Models tab — so a
// new unit type shows up on the dashboard with no second list to remember. Keys
// are normalized to match machine.unit; the catalog spelling is kept for display.
function getInstallBaseUnits(unitCatalog) {
  const labels = Object.keys(unitCatalog || {}).reduce((acc, name) => {
    acc[normalizeUnitKey(name)] = name;
    return acc;
  }, {});
  return { labels, keys: Object.keys(labels) };
}

// The categorical palette holds 8 hues. Catalog entries past that share one
// neutral "other" slot rather than getting a generated 9th hue nobody could
// tell apart.
const INSTALL_BASE_COLOR_SLOTS = 8;

// Unit types to keep off the profile as named rows: they are counted into one
// "Other" row instead, so totals and percentages still add up to the whole
// fleet. The hover detail names the unit behind each model. Currently empty:
// ANSER and SUNINE were grouped here but management wants them shown by name.
const INSTALL_BASE_OTHER_UNITS = new Set();
const INSTALL_BASE_OTHER_KEY = '__OTHER__';

function installBaseGroupKey(unitKey) {
  return INSTALL_BASE_OTHER_UNITS.has(unitKey) ? INSTALL_BASE_OTHER_KEY : unitKey;
}

function parseMachineDate(value) {
  return parseActivityDate(value);
}

function getMachineMaintenanceStatus(machine, warningDays = 30) {
  let anchorDate = parseMachineDate(machine?.maintenanceServiceDate);
  if (!anchorDate) {
    anchorDate = parseMachineDate(machine?.dateInstalled);
  }
  if (!anchorDate) {
    return { isOverdue: false, isDueSoon: false };
  }

  const maintenanceDate = new Date(anchorDate);
  maintenanceDate.setDate(anchorDate.getDate() + 750);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((maintenanceDate - today) / (1000 * 60 * 60 * 24));

  return {
    isOverdue: diffDays < 0,
    isDueSoon: diffDays >= 0 && diffDays <= warningDays
  };
}

// Installs predating this date also predate the service paperwork we hold, so
// their 750-day clock ran out years ago with nothing on file to close it. Left
// alone they reported as pending forever and buried the units that genuinely
// need attention. Treat them as closed out — but only until a service is
// actually logged against them on or after the cutoff, at which point the
// normal clock takes over again from that real service date.
const LEGACY_INSTALL_CUTOFF = new Date(2026, 0, 1);

function isLegacyUndocumentedUnit(machine) {
  const installed = parseMachineDate(machine?.dateInstalled);
  if (!installed || installed >= LEGACY_INSTALL_CUTOFF) {
    return false;
  }
  const serviced = parseMachineDate(machine?.maintenanceServiceDate);
  return !serviced || serviced < LEGACY_INSTALL_CUTOFF;
}

function hasUnitWarning(machine) {
  if (isLegacyUndocumentedUnit(machine)) {
    return false;
  }
  const maintenanceStatus = getMachineMaintenanceStatus(machine, 30);
  return maintenanceStatus.isOverdue || maintenanceStatus.isDueSoon;
}

/**
 * Fleet-wide pending/completion tally, independent of the Monitoring Overview's
 * date-range filter. "Pending Units" and "Clients Pending" answer "what needs
 * attention right now", so a maintenance-overdue machine must count even if it
 * had no activity logged in the selected period.
 */
function computeFleetPendingSummary(clients = [], machines = []) {
  const activeClientIds = new Set(
    clients
      .filter(client => String(client.status || '').toLowerCase() !== 'inactive')
      .map(client => String(client.id || '').toLowerCase())
  );

  const rollup = new Map();
  const getEntry = (clientId, clientName) => {
    if (!rollup.has(clientId)) {
      rollup.set(clientId, {
        clientId,
        clientName,
        units: 0,
        finishedUnits: 0,
        isActive: activeClientIds.has(clientId)
      });
    }
    return rollup.get(clientId);
  };

  for (const client of clients) {
    const clientId = String(client.id || '').trim().toLowerCase();
    if (!clientId) continue;
    getEntry(clientId, String(client.name || clientId || 'Unknown Client'));
  }

  let completedUnits = 0;
  let pendingUnits = 0;
  let faultyUnits = 0;
  const faultyUnitsList = [];

  for (const machine of machines) {
    const clientId = String(machine.clientId || '').trim().toLowerCase();
    const entry = getEntry(clientId, String(machine.clientName || clientId || 'Unknown Client'));
    entry.units += 1;

    if (normalizeStatus(machine.status) === 'Faulty') {
      faultyUnits += 1;
      faultyUnitsList.push({
        id: machine.id || '',
        serial: machine.serial || 'Unknown',
        model: machine.model || 'Unknown',
        clientName: entry.clientName
      });
    }

    if (hasUnitWarning(machine)) {
      pendingUnits += 1;
    } else {
      completedUnits += 1;
      entry.finishedUnits += 1;
    }
  }

  const totalUnits = completedUnits + pendingUnits;
  const completionRate = totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0;

  let completedClients = 0;
  const pendingClientsList = [];
  for (const entry of rollup.values()) {
    if (entry.units === 0) continue;
    if (entry.finishedUnits === entry.units) {
      completedClients += 1;
    } else {
      pendingClientsList.push({
        clientId: entry.clientId,
        clientName: entry.clientName,
        units: entry.units,
        finishedUnits: entry.finishedUnits,
        pendingUnits: entry.units - entry.finishedUnits,
        completionRate: Math.round((entry.finishedUnits / entry.units) * 100),
        isActive: entry.isActive
      });
    }
  }
  pendingClientsList.sort((a, b) => b.pendingUnits - a.pendingUnits || a.clientName.localeCompare(b.clientName));

  faultyUnitsList.sort((a, b) => a.clientName.localeCompare(b.clientName) || String(a.serial).localeCompare(String(b.serial)));

  return { completedUnits, pendingUnits, completionRate, completedClients, pendingClientsList, faultyUnits, faultyUnitsList };
}

/**
 * The fleet as monitoring sees it: a client marked inactive is off the
 * dashboard entirely. Its units leave every KPI, the install base profile, the
 * technician tallies and the activity log alike, so the figures answer "what we
 * service" rather than "what rows exist".
 *
 * Every monitoring caller passes its lists through here before buildMonitoring,
 * which is why that function has no status logic of its own beyond the
 * `isActive` flag it hands the view.
 *
 * Machines whose clientId matches no client row are deliberately kept. They are
 * not inactive, they are unattached, and dropping them here would make the
 * totals disagree with the machines table for a reason nobody could see on the
 * page. There are none today; this keeps it that way if one ever appears.
 */
function scopeToActiveClients(clients = [], machines = []) {
  const safeClients = Array.isArray(clients) ? clients : [];
  const safeMachines = Array.isArray(machines) ? machines : [];

  const inactiveClientIds = new Set(
    safeClients
      .filter(client => String(client.status || '').toLowerCase() === 'inactive')
      .map(client => String(client.id || '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (!inactiveClientIds.size) {
    return { clients: safeClients, machines: safeMachines };
  }

  return {
    clients: safeClients.filter(
      client => !inactiveClientIds.has(String(client.id || '').trim().toLowerCase())
    ),
    machines: safeMachines.filter(
      machine => !inactiveClientIds.has(String(machine.clientId || '').trim().toLowerCase())
    )
  };
}

/**
 * Every disabled unit, for the Units Disabled card's detail. Labelled with the
 * client's current name for the same reason buildUnitsInstalledByClient is: a
 * machine keeps the name it was installed under.
 */
function buildUnitsDisabledList(machines = [], clients = []) {
  const currentNames = new Map();
  for (const client of clients) {
    const id = String(client.id || '').trim().toLowerCase();
    if (id) currentNames.set(id, String(client.name || '').trim());
  }

  return machines
    .filter(isMachineDisabled)
    .map(machine => {
      const clientId = String(machine.clientId || '').trim().toLowerCase();
      return {
        id: machine.id,
        serial: machine.serialNo || 'Unknown',
        unit: machine.unit || '',
        model: machine.model || '',
        clientName: currentNames.get(clientId) || String(machine.clientName || '').trim() || 'Unknown Client',
        disabledAt: machine.disabledAt,
        disabledBy: machine.disabledBy || ''
      };
    })
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || String(a.serial).localeCompare(String(b.serial)));
}

function buildMonitoring(clients = [], machines = [], range = null, allMachines = null, unitCatalog = MONITOR_PARTS_CATALOG) {
  const catalogUnits = getInstallBaseUnits(unitCatalog);
  // Named rows only; the grouped types live in the one "Other" row, which is
  // seeded last so it never takes a hue from a named type.
  const namedUnitKeys = catalogUnits.keys.filter(key => !INSTALL_BASE_OTHER_UNITS.has(key));
  const safeClients = Array.isArray(clients) ? clients : [];
  const safeMachines = Array.isArray(machines) ? machines : [];
  // Falls back to safeMachines when the caller has no separate unfiltered list
  // (i.e. it didn't pre-filter machines by range in the first place).
  const safeAllMachines = Array.isArray(allMachines) ? allMachines : safeMachines;
  const activityData = buildMonitorActivityRows(safeMachines);
  // Client management is authoritative; machine rows may retain an old address.
  const clientLocations = new Map(safeClients.map(client => [String(client.id || '').trim().toLowerCase(), String(client.location || '').trim()]));
  activityData.activityRows.forEach(row => {
    if (clientLocations.has(row.clientId)) row.clientLocation = clientLocations.get(row.clientId);
  });
  const activityRowCap = getMonitorActivityRowCap();
  const activityRowTotal = activityData.activityRows.length;
  const activityRowsCapped = Number.isFinite(activityRowCap) && activityRowTotal > activityRowCap;
  const activityRowsForView = activityRowsCapped
    ? activityData.activityRows.slice(0, activityRowCap)
    : activityData.activityRows;

  const activeClientIds = new Set(
    safeClients
      .filter(client => String(client.status || '').toLowerCase() !== 'inactive')
      .map(client => String(client.id || '').toLowerCase())
  );

  // Seed every catalog unit type at zero: the profile is meant to show the whole
  // fleet line-up, so a type with no installs reads as an explicit 0 instead of
  // silently dropping off the card.
  const installBaseTotals = {};
  const installBaseModels = {};
  // Counted separately from totalUnits: the profile answers "what went in during
  // this period", while totalUnits counts every machine that saw any activity in
  // it. Sharing one total made "Today" show a full fleet mix next to a Units
  // Installed KPI reading 0.
  let installBaseUnits = 0;
  const seededKeys = INSTALL_BASE_OTHER_UNITS.size
    ? [...namedUnitKeys, INSTALL_BASE_OTHER_KEY]
    : namedUnitKeys;
  for (const key of seededKeys) {
    installBaseTotals[key] = 0;
    installBaseModels[key] = new Map();
  }

  const modelCounts = new Map();
  const clientRollup = new Map();
  const userRollup = new Map();
  const timelineDayCounts = new Map();

  // Seed every known client at zero: a client with no units in the selected
  // period should still show up in Client Unit Progress as "0 units" instead
  // of silently disappearing from the list.
  for (const client of safeClients) {
    const clientId = String(client.id || '').trim().toLowerCase();
    if (!clientId || clientRollup.has(clientId)) continue;
    clientRollup.set(clientId, {
      clientId,
      clientName: String(client.name || clientId || 'Unknown Client'),
      units: 0,
      models: new Set(),
      updates: 0,
      reports: 0,
      finishedUnits: 0,
      isActive: activeClientIds.has(clientId)
    });
  }

  let updateEvents = 0;
  let reportEvents = 0;

  for (const machine of safeMachines) {
    const machineContributorsOnce = getMachineContributors(machine);
    const machineClientId = String(machine.clientId || '').trim().toLowerCase();
    const modelName = String(machine.model || '').trim() || 'Unknown Model';
    const unitName = String(machine.unit || '').trim() || 'Unknown Unit';
    const statusLabel = normalizeStatus(machine.status);
    const updates = Array.isArray(machine.updates) ? machine.updates : [];
    const reports = Array.isArray(machine.reports) ? machine.reports : [];

    // Only units installed inside the selected range belong on the profile;
    // a machine that merely had a report logged today was not installed today.
    const unitKey = normalizeUnitKey(machine.unit);
    if (unitKey && !isMachineDisabled(machine) && machineInstalledInRange(machine, range)) {
      const groupKey = installBaseGroupKey(unitKey);
      // Inside "Other" a bare model name wouldn't say which unit it is.
      const modelLabel = groupKey === INSTALL_BASE_OTHER_KEY
        ? `${catalogUnits.labels[unitKey] || unitName} ${modelName}`
        : modelName;
      installBaseUnits += 1;
      installBaseTotals[groupKey] = (installBaseTotals[groupKey] || 0) + 1;
      if (!installBaseModels[groupKey]) installBaseModels[groupKey] = new Map();
      const unitModelCounts = installBaseModels[groupKey];
      unitModelCounts.set(modelLabel, (unitModelCounts.get(modelLabel) || 0) + 1);
    }

    if (!isMachineDisabled(machine)) {
      modelCounts.set(modelName, (modelCounts.get(modelName) || 0) + 1);
    }

    if (!clientRollup.has(machineClientId)) {
      clientRollup.set(machineClientId, {
        clientId: machineClientId,
        clientName: String(machine.clientName || machineClientId || 'Unknown Client'),
        units: 0,
        models: new Set(),
        updates: 0,
        reports: 0,
        finishedUnits: 0,
        isActive: activeClientIds.has(machineClientId)
      });
    }

    const clientEntry = clientRollup.get(machineClientId);

    // Unit counts and maintenance health are deliberately NOT filled in here —
    // see the fleet-wide pass below. Only period-scoped event tallies belong in
    // this loop, where `machine` is already narrowed to the selected range.
    updateEvents += updates.length;
    reportEvents += reports.length;

    for (const update of updates) {
      const contributors = update && update.report
        ? getReportContributors(update.report)
        : splitContributorNames(update?.submittedBy || '');
      const contributorNames = contributors.length ? contributors : [normalizeContributorName(update?.submittedBy) || 'Unknown Technician'];

      for (const contributorName of contributorNames) {
        if (!userRollup.has(contributorName)) {
          userRollup.set(contributorName, {
            name: contributorName,
            updates: 0,
            reports: 0,
            finishedUnits: 0,
            units: new Set(),
            models: new Set(),
            clients: new Set()
          });
        }
        const row = userRollup.get(contributorName);
        row.updates += 1;
        row.units.add(`${machineClientId}|${unitName}|${machine.serialNo || machine.model}`);
        row.models.add(modelName);
        row.clients.add(machineClientId);
      }

      const eventDate = parseActivityDate(
        effectiveActivityDate(update?.smrDate, update?.date || update?.report?.date)
      );
      if (eventDate) {
        const dayKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
        timelineDayCounts.set(dayKey, (timelineDayCounts.get(dayKey) || 0) + 1);
      }

      // "What did we do for this client in this window" — an update counts only
      // when its own event date lands inside the range, the same rule every
      // other period-scoped figure on the dashboard follows.
      if (dateValueInRange(eventDate, range)) {
        clientEntry.updates += 1;
      }
    }

    const hasInstallationReport = reports.some(isInstallationReport);

    if (!hasInstallationReport) {
      reportEvents += 1;
    }

    if (!hasInstallationReport && machineContributorsOnce.length) {
      for (const contributorName of machineContributorsOnce) {
        if (!userRollup.has(contributorName)) {
          userRollup.set(contributorName, {
            name: contributorName,
            updates: 0,
            reports: 0,
            finishedUnits: 0,
            units: new Set(),
            models: new Set(),
            clients: new Set()
          });
        }
        const row = userRollup.get(contributorName);
        row.reports += 1;
        row.units.add(`${machineClientId}|${unitName}|${machine.serialNo || machine.model}`);
        row.models.add(modelName);
        row.clients.add(machineClientId);
      }
    }

    for (const report of reports) {
      if (!isInstallationReport(report)) {
        continue;
      }

      const contributors = getReportContributors(report);
      const contributorNames = contributors.length
        ? contributors
        : (machineContributorsOnce.length
          ? machineContributorsOnce
          : [normalizeContributorName(report && report.submittedBy) || 'Unknown Technician']);

      for (const contributorName of contributorNames) {
        if (!userRollup.has(contributorName)) {
          userRollup.set(contributorName, {
            name: contributorName,
            updates: 0,
            reports: 0,
            finishedUnits: 0,
            units: new Set(),
            models: new Set(),
            clients: new Set()
          });
        }
        const row = userRollup.get(contributorName);
        row.reports += 1;
        row.units.add(`${machineClientId}|${unitName}|${machine.serialNo || machine.model}`);
        row.models.add(modelName);
        row.clients.add(machineClientId);
      }

      const eventDate = parseActivityDate(report?.date);
      if (eventDate) {
        const dayKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
        timelineDayCounts.set(dayKey, (timelineDayCounts.get(dayKey) || 0) + 1);
      }
    }
  }

  // ── Client Unit Progress: unit health is fleet-wide, on purpose ──
  // A machine three years overdue is still overdue today, so it has to count on
  // every range. Reading the range-filtered list here hid exactly the units that
  // most needed attention: a client whose machines saw no activity in the period
  // collapsed to "0/0 units · 0%" while the Pending Units KPI above still
  // counted them. This matches computeFleetPendingSummary(), which reads the
  // same unfiltered list for the same reason.
  for (const machine of safeAllMachines) {
    if (isMachineDisabled(machine)) continue;
    const clientId = String(machine.clientId || '').trim().toLowerCase();
    if (!clientRollup.has(clientId)) {
      clientRollup.set(clientId, {
        clientId,
        clientName: String(machine.clientName || clientId || 'Unknown Client'),
        units: 0,
        models: new Set(),
        updates: 0,
        reports: 0,
        finishedUnits: 0,
        isActive: activeClientIds.has(clientId)
      });
    }
    const entry = clientRollup.get(clientId);
    entry.units += 1;
    entry.models.add(String(machine.model || '').trim() || 'Unknown Model');
    if (!hasUnitWarning(machine)) {
      entry.finishedUnits += 1;
    }
  }

  // Reports stay period-scoped — they answer "how much work did we log for this
  // client in this window". Counting every report ever filed put "14 reports"
  // beside a Tech Reports Log reading 0. Counting activity rows rather than
  // machine.reports also makes this column sum to the reportsInRange headline.
  for (const row of activityData.activityRows) {
    if (!activityRowInRange(row, range)) continue;
    const entry = clientRollup.get(String(row.clientId || '').trim().toLowerCase());
    if (entry) entry.reports += 1;
  }

  const totalUnits = safeMachines.filter(machine => !isMachineDisabled(machine)).length;
  const totalModels = modelCounts.size;
  const totalClientsServed = clientRollup.size;
  const activeClientsServed = Array.from(clientRollup.values()).filter(client => client.isActive).length;
  const fleetPending = computeFleetPendingSummary(
    safeClients,
    safeAllMachines.filter(machine => !isMachineDisabled(machine))
  );

  // Fleet-wide, not range-scoped: "how many units are disabled" has no period.
  const unitsDisabledList = buildUnitsDisabledList(safeAllMachines, safeClients);

  // One row per catalog unit type, whether or not it has installs — "we own none
  // of these" and "nothing was recorded" look identical when the row is missing.
  // Sorted by count so the fleet reads high-to-low, with the zero rows settling
  // at the bottom in catalog order.
  const installBaseShare = Object.keys(installBaseTotals)
    .map(key => {
      const count = installBaseTotals[key] || 0;
      const isOther = key === INSTALL_BASE_OTHER_KEY;
      const knownIndex = isOther ? -1 : namedUnitKeys.indexOf(key);
      // Unit types found on machines but missing from the catalog sort after it.
      const catalogIndex = knownIndex >= 0 ? knownIndex : namedUnitKeys.length;
      return {
        key,
        label: isOther ? 'Other' : (catalogUnits.labels[key] || key),
        isOther,
        count,
        // Rounded for display; `share` keeps the exact fraction so the stacked
        // composition bar's segments still fill the track exactly.
        percentage: installBaseUnits > 0 ? Math.round((count / installBaseUnits) * 100) : 0,
        share: installBaseUnits > 0 ? (count / installBaseUnits) * 100 : 0,
        // Colour follows the unit type, never its rank, so changing the date
        // range never repaints the types that survive the filter.
        colorIndex: knownIndex >= 0 && knownIndex < INSTALL_BASE_COLOR_SLOTS ? knownIndex : -1,
        catalogIndex,
        // Top model mix inside the type, for the hover detail.
        models: Array.from((installBaseModels[key] || new Map()).entries())
          .map(([model, modelCount]) => ({ model, count: modelCount }))
          .sort((a, b) => b.count - a.count)
          .slice(0, isOther ? undefined : 3)
      };
    })
    // In-service rows high-to-low with "Other" last among them, then the idle
    // rows in catalog order.
    .sort((a, b) =>
      (b.count > 0) - (a.count > 0)
      || (a.count > 0 && (a.isOther - b.isOther))
      || b.count - a.count
      || a.catalogIndex - b.catalogIndex);

  const installedUnitTypes = installBaseShare.filter(row => row.count > 0).length;
  const catalogUnitTypes = installBaseShare.length;

  const topModels = Array.from(modelCounts.entries())
    .map(([model, count]) => ({
      model,
      count,
      percentage: totalUnits > 0 ? Math.round((count / totalUnits) * 100) : 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Client Unit Progress lists active clients only. An inactive client's units
  // still count fleet-wide (totalUnits and the pending KPIs read the unfiltered
  // list), but this card is a worklist: a row nobody is expected to service is
  // noise. Filtering on the same flag the Active Clients KPI reads also keeps
  // the two in step.
  const clientHighlights = Array.from(clientRollup.values())
    .filter(entry => entry.isActive)
    .map(entry => ({
      clientId: entry.clientId,
      clientName: entry.clientName,
      units: entry.units,
      models: entry.models.size,
      updates: entry.updates,
      reports: entry.reports,
      finishedUnits: entry.finishedUnits,
      completionRate: entry.units > 0 ? Math.round((entry.finishedUnits / entry.units) * 100) : 0,
      isActive: entry.isActive
    }))
    .sort((a, b) => b.finishedUnits - a.finishedUnits || b.reports - a.reports || b.units - a.units);

  // Tech reports: per-technician total reports (all activity types count)
  const techReports = Array.from(userRollup.values())
    .map(entry => ({
      name: entry.name,
      totalReports: entry.reports + entry.updates,
      reports: entry.reports,
      updates: entry.updates,
      unitsServed: entry.units.size,
      clientsServed: entry.clients.size
    }))
    .sort((a, b) => b.totalReports - a.totalReports);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentActivity = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    recentActivity.push({
      key: dayKey,
      label: formatDayLabel(day),
      count: timelineDayCounts.get(dayKey) || 0
    });
  }

  const activityPeak = recentActivity.reduce((max, day) => Math.max(max, day.count), 0);

  // Ignores `range` on purpose, and reads every machine: the range-narrowed list
  // would hide a unit worked on today whose other activity fell outside it.
  const todaySerialStatus = buildTodaySerialStatus(
    safeAllMachines === safeMachines
      ? activityData.activityRows
      : buildMonitorActivityRows(safeAllMachines).activityRows
  );

  // Both of these read the selected date range directly rather than relying on
  // the caller having pre-filtered machines: "installed today" and "logged
  // today" are about the event date, not about the machine being in scope.
  const unitsInstalledByClient = buildUnitsInstalledByClient(safeMachines, range, safeClients);
  const unitsInstalledInRange = unitsInstalledByClient.reduce((sum, row) => sum + row.count, 0);
  const techReportLog = buildTechReportLog(activityData.activityRows, range);
  const repairPartsUsage = buildRepairPartsUsage(activityData.activityRows, range);
  // Counts the reports themselves, so a job shared by two technicians is one
  // report here even though it appears on both of their bars.
  const reportsInRange = activityData.activityRows
    .filter(row => activityRowInRange(row, range)).length;

  return {
    totalUnits,
    totalModels,
    totalClientsServed,
    activeClientsServed,
    completedUnits: fleetPending.completedUnits,
    pendingUnits: fleetPending.pendingUnits,
    faultyUnits: fleetPending.faultyUnits,
    faultyUnitsList: fleetPending.faultyUnitsList,
    completedClients: fleetPending.completedClients,
    pendingClientsList: fleetPending.pendingClientsList,
    completionRate: fleetPending.completionRate,
    updateEvents,
    reportEvents,
    installBaseShare,
    installBaseTotalUnits: installBaseUnits,
    installedUnitTypes,
    catalogUnitTypes,
    topModels,
    clientHighlights,
    techReports,
    recentActivity,
    activityPeak,
    todaySerialStatus,
    unitsInstalledByClient,
    unitsInstalledInRange,
    unitsDisabled: unitsDisabledList.length,
    unitsDisabledList,
    techReportLog,
    reportsInRange,
    repairPartsUsage,
    activityRows: activityRowsForView,
    activityRowTotal,
    technicianHistory: buildTechnicianHistory(activityData.activityRows),
    activityRowsCapped,
    technicianOptions: activityData.technicianOptions,
    clientOptions: activityData.clientOptions,
    unitOptions: activityData.unitOptions,
    modelOptions: activityData.modelOptions,
    unitModelOptions: activityData.unitModelOptions
  };
}

/**
 * Data for the admin-only Units & Models tab: every unit in the merged catalog
 * with its models, flagged built-in (in code, read-only here) or added (a
 * unit_models row the admin can remove while no machine uses it).
 */
function buildUnitModelView(rows = [], available = false, machines = []) {
  const catalog = mergeCatalog(MONITOR_PARTS_CATALOG, rows);

  const machineCounts = new Map();
  machines.forEach(machine => {
    const key = `${normalizeUnitKey(machine.unit)}|${normalizeModelKey(machine.model)}`;
    machineCounts.set(key, (machineCounts.get(key) || 0) + 1);
    const unitKey = `${normalizeUnitKey(machine.unit)}|`;
    machineCounts.set(unitKey, (machineCounts.get(unitKey) || 0) + 1);
  });

  const units = Object.keys(catalog).map(unitName => {
    const unitKey = normalizeUnitKey(unitName);
    const builtInUnit = Object.keys(MONITOR_PARTS_CATALOG).some(name => normalizeUnitKey(name) === unitKey);
    const builtInModels = builtInUnit
      ? Object.keys(MONITOR_PARTS_CATALOG[findUnitName(MONITOR_PARTS_CATALOG, unitName)] || {})
      : [];
    const unitRow = rows.find(row => !row.modelKey && row.unitKey === unitKey);

    const models = Object.keys(catalog[unitName]).map(modelName => {
      const row = builtInModels.includes(modelName)
        ? null
        : rows.find(r => r.unitKey === unitKey && r.model === modelName);
      return {
        name: modelName,
        builtIn: !row,
        id: row ? row.id : null,
        createdBy: row ? row.createdBy : '',
        machineCount: machineCounts.get(`${unitKey}|${normalizeModelKey(modelName)}`) || 0
      };
    });

    return {
      name: unitName,
      builtIn: builtInUnit,
      id: unitRow ? unitRow.id : null,
      machineCount: machineCounts.get(`${unitKey}|`) || 0,
      models
    };
  });

  return {
    available,
    units,
    totalModels: units.reduce((sum, unit) => sum + unit.models.length, 0),
    addedModels: rows.filter(row => row.modelKey).length
  };
}

/** Just the fields the Transfer Unit tab searches and shows — not the whole history. */
function buildTransferMachines(machines) {
  return (Array.isArray(machines) ? machines : [])
    .map(machine => ({
      id: machine.id,
      serialNo: machine.serialNo,
      unit: machine.unit,
      model: machine.model,
      clientId: machine.clientId || '',
      clientName: machine.clientName,
      dateInstalled: machine.dateInstalled,
      disabledAt: machine.disabledAt || ''
    }))
    .sort((a, b) => String(a.serialNo).localeCompare(String(b.serialNo)));
}

/**
 * Narrows clients and their machines to what the signed-in user may see. Only
 * sales users are narrowed — to the clients assigned to them; everyone else
 * gets both lists back unchanged.
 */
function scopeToUser(user, clients = [], machines = []) {
  if (!user || user.role !== 'sales') return { clients, machines };
  const scopedClients = filterClientsForUser(user, clients);
  const ids = new Set(scopedClients.map(client => String(client.id || '').trim().toLowerCase()));
  return {
    clients: scopedClients,
    machines: (Array.isArray(machines) ? machines : [])
      .filter(machine => ids.has(String(machine.clientId || '').trim().toLowerCase()))
  };
}

async function renderAdmin(req, res, { success = null, error = null } = {}) {
  const isSales = req.session?.user?.role === 'sales';

  if (isSales) {
    const [clientsAll, machinesAll, unitCatalog] = await Promise.all([
      listClients(),
      listAllMachines(),
      getUnitCatalog(MONITOR_PARTS_CATALOG)
    ]);
    const { clients: clientsRaw, machines } = scopeToUser(req.session.user, clientsAll, machinesAll);
    const sortedClients = clientsRaw.slice().sort((a, b) => a.name.localeCompare(b.name));
    // Monitoring sees active clients only; the Clients tab below still gets the
    // full list so inactive ones remain manageable.
    const monitorScope = scopeToActiveClients(sortedClients, machines);
    await refreshAdminNames();
    const monitoring = buildMonitoring(monitorScope.clients, monitorScope.machines, null, null, unitCatalog);

    return res.render('admin_account', {
      currentUser: req.session.user,
      accounts: [],
      clients: sortedClients,
      monitoring,
      unitModels: null,
      partsCatalog: null,
      transferMachines: null,
      schedules: null,
      success,
      error
    });
  }

  const [userAccountsRaw, clientsRaw, machines, partRows, unitModelData, salesAssignmentAvailable, scheduleData] = await Promise.all([
    listStaffAccounts(),
    listClients(),
    listAllMachines(),
    listParts().catch(err => {
      console.error('[parts] could not load:', err.message || err);
      return [];
    }),
    listUnitModels().catch(err => {
      console.error('[unit models] could not load:', err.message || err);
      return { rows: [], available: false };
    }),
    isSalesAssignmentAvailable(),
    listSchedules().catch(err => {
      console.error('[schedules] could not load:', err.message || err);
      return { rows: [], available: false };
    })
  ]);
  const userAccounts = userAccountsRaw.slice().sort((a, b) => a.fullName.localeCompare(b.fullName));
  const sortedClients = clientsRaw.slice().sort((a, b) => a.name.localeCompare(b.name));
  const unitCatalog = mergeCatalog(MONITOR_PARTS_CATALOG, unitModelData.rows);
  // Monitoring sees active clients only. Units & Models and Transfer Unit below
  // deliberately keep the full machine list: a model still in use by an
  // inactive client's unit must not look free to delete, and pulling a unit out
  // of a client you just deactivated is exactly when a transfer is needed.
  const monitorScope = scopeToActiveClients(sortedClients, machines);
  await refreshAdminNames();
  const monitoring = buildMonitoring(monitorScope.clients, monitorScope.machines, null, null, unitCatalog);

  return res.render('admin_account', {
    currentUser: req.session.user,
    accounts: userAccounts,
    salesAssignmentAvailable,
    clients: sortedClients,
    monitoring,
    unitModels: buildUnitModelView(unitModelData.rows, unitModelData.available, machines),
    partsCatalog: { parts: partRows, units: Object.keys(unitCatalog).sort((a, b) => a.localeCompare(b)) },
    transferMachines: buildTransferMachines(machines),
    schedules: scheduleData,
    success,
    error
  });
}

function redirectWithFlash(req, res, { success, error, hash = '' }) {
  if (success) req.session.flashSuccess = success;
  if (error) req.session.flashError = error;
  return res.redirect(`/admin_account${hash ? `#${hash}` : ''}`);
}

router.get('/', requireAdminOrSales, async (req, res, next) => {
  try {
    const success = req.session.flashSuccess || null;
    const error = req.session.flashError || null;
    delete req.session.flashSuccess;
    delete req.session.flashError;
    await renderAdmin(req, res, { success, error });
  } catch (err) {
    next(err);
  }
});

router.get('/serial-search', requireAdminOrSales, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const serial = typeof req.query.serial === 'string' ? req.query.serial.trim() : '';
  const page = req.query.page === undefined ? 0 : Number(req.query.page);
  if (!serial || serial.length > 100 || !Number.isSafeInteger(page) || page < 0 || page > 1000000) {
    return res.status(400).json({ ok: false, error: 'Enter a serial number (up to 100 characters) and a valid page.' });
  }
  try {
    const result = await searchMachinesBySerialNo(serial, page);
    return res.json({ ok: true, ...result, page });
  } catch (error) {
    console.error('[serial-search]', error.message);
    return res.status(500).json({ ok: false, error: 'Could not search serial numbers. Please try again.' });
  }
});

router.get('/serial-search/:machineId', requireAdminOrSales, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = Number(req.params.machineId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid machine ID.' });
  }
  try {
    const machine = await findMachineById(id);
    if (!machine) return res.status(404).json({ ok: false, error: 'Machine record not found.' });
    return res.json({ ok: true, machine });
  } catch (error) {
    console.error('[serial-search detail]', error.message);
    return res.status(500).json({ ok: false, error: 'Could not load the machine history. Please try again.' });
  }
});

/**
 * Fresh Technician History data. The admin page re-fetches this whenever the
 * tab is opened or the browser tab regains focus, so a correction saved on a
 * client page shows up without reloading the whole admin page.
 */
router.get('/tech-history-data', requireAdminOrSales, async (req, res) => {
  try {
    // Same active-client scope the page was rendered with, or reopening the tab
    // would quietly put inactive clients back into the history.
    const [clientsAll, machinesAll] = await Promise.all([listClients(), listAllMachines()]);
    const { clients, machines } = scopeToUser(req.session.user, clientsAll, machinesAll);
    const monitorScope = scopeToActiveClients(clients, machines);
    const { activityRows } = buildMonitorActivityRows(monitorScope.machines);
    return res.json({ ok: true, technicianHistory: buildTechnicianHistory(activityRows) });
  } catch (err) {
    console.error('[tech-history-data]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load technician history.' });
  }
});

/**
 * Lightweight JSON API: returns monitoring data filtered by date range.
 * Query param `range` accepts: today | this-month | last-month | last-year | all (default) | q1 | q2 | q3 | q4
 * Quarters are real calendar quarters of the current year (Q1 Jan 1 - Mar 31,
 * Q2 Apr 1 - Jun 30, Q3 Jul 1 - Sep 30, Q4 Oct 1 - Dec 31) — the day-0-of-next-month
 * trick below always lands on the correct last day regardless of month length.
 */
router.get('/monitoring-data', requireAdminOrSales, async (req, res) => {
  try {
    const range = String(req.query.range || 'all').trim().toLowerCase();
    const [clientsAll, machinesAll, unitCatalog] = await Promise.all([
      listClients(),
      listAllMachines(),
      getUnitCatalog(MONITOR_PARTS_CATALOG)
    ]);
    const { clients: clientsRaw, machines } = scopeToUser(req.session.user, clientsAll, machinesAll);
    const sortedClients = clientsRaw.slice().sort((a, b) => a.name.localeCompare(b.name));
    // Applied before the range filter so both the in-range list and the
    // fleet-wide list below are already free of inactive clients.
    const monitorScope = scopeToActiveClients(sortedClients, machines);
    const scopedClients = monitorScope.clients;
    const scopedMachines = monitorScope.machines;

    // Build date boundaries
    const now = new Date();
    let rangeStart = null;
    let rangeEnd = null;

    if (range === 'today') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (range === 'this-month') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
      rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (range === 'last-month') {
      rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (range === 'last-year') {
      rangeStart = new Date(now.getFullYear() - 1, 0, 1);
      rangeEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    } else if (range === 'q1' || range === 'q2' || range === 'q3' || range === 'q4') {
      const quarterStartMonth = { q1: 0, q2: 3, q3: 6, q4: 9 }[range];
      rangeStart = new Date(now.getFullYear(), quarterStartMonth, 1);
      rangeEnd = new Date(now.getFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999);
    } else if (range === 'custom') {
      const customStart = parseActivityDate(req.query.start);
      const customEnd = parseActivityDate(req.query.end);
      if (customStart && customEnd) {
        rangeStart = new Date(customStart.getFullYear(), customStart.getMonth(), customStart.getDate());
        rangeEnd = new Date(customEnd.getFullYear(), customEnd.getMonth(), customEnd.getDate(), 23, 59, 59, 999);
      }
      // Missing/invalid bounds => rangeStart/rangeEnd stay null => no filtering
    }
    // 'all' => rangeStart/rangeEnd stay null => no filtering

    // Keep machines with any activity in range, dated the same way the rows are
    // — by SMR date where one exists. Reading the encoded date here while the
    // rows scope by SMR date dropped a machine before its rows were ever built:
    // a 2025 job encoded in Sept 2026 failed this filter, and 104 of the 130
    // reports belonging to 2025 disappeared from every card.
    //
    // This stays deliberately wider than activityRowInRange. It only decides
    // which machines are worth building rows for; the row filter does the real
    // scoping, so an extra machine here costs nothing but a missing one is lost.
    let filteredMachines = scopedMachines;
    if (rangeStart && rangeEnd) {
      const inRange = value => {
        const d = parseActivityDate(value);
        return Boolean(d && d >= rangeStart && d <= rangeEnd);
      };
      filteredMachines = scopedMachines.filter(machine => {
        if (inRange(effectiveActivityDate(machine.initialSmrDate, machine.dateInstalled))) return true;
        const updates = Array.isArray(machine.updates) ? machine.updates : [];
        for (const u of updates) {
          if (inRange(effectiveActivityDate(u && u.smrDate, u && u.date))) return true;
        }
        const reports = Array.isArray(machine.reports) ? machine.reports : [];
        for (const r of reports) {
          if (inRange(r && r.date)) return true;
        }
        return false;
      });
    }

    await refreshAdminNames();
    const monitoring = buildMonitoring(scopedClients, filteredMachines, { start: rangeStart, end: rangeEnd }, scopedMachines, unitCatalog);
    return res.json({
      ok: true,
      range,
      monitoring: {
        totalUnits: monitoring.totalUnits,
        completedUnits: monitoring.completedUnits,
        pendingUnits: monitoring.pendingUnits,
        faultyUnits: monitoring.faultyUnits,
        faultyUnitsList: monitoring.faultyUnitsList,
        completedClients: monitoring.completedClients,
        pendingClientsList: monitoring.pendingClientsList,
        reportEvents: monitoring.reportEvents,
        updateEvents: monitoring.updateEvents,
        completionRate: monitoring.completionRate,
        installBaseShare: monitoring.installBaseShare,
        installBaseTotalUnits: monitoring.installBaseTotalUnits,
        installedUnitTypes: monitoring.installedUnitTypes,
        catalogUnitTypes: monitoring.catalogUnitTypes,
        clientHighlights: monitoring.clientHighlights,
        techReports: monitoring.techReports,
        todaySerialStatus: monitoring.todaySerialStatus,
        unitsInstalledByClient: monitoring.unitsInstalledByClient,
        unitsInstalledInRange: monitoring.unitsInstalledInRange,
        unitsDisabled: monitoring.unitsDisabled,
        unitsDisabledList: monitoring.unitsDisabledList,
        techReportLog: monitoring.techReportLog,
        reportsInRange: monitoring.reportsInRange,
        repairPartsUsage: monitoring.repairPartsUsage,
        // Omit heavy activity rows from the lightweight response
        activityRowTotal: monitoring.activityRowTotal
      }
    });
  } catch (err) {
    console.error('[monitoring-data]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load monitoring data.' });
  }
});

router.post('/employees/invite', requireAdmin, async (req, res) => {
  const email = String(req.body.inviteEmail || '').trim().toLowerCase();
  const role = String(req.body.inviteRole || '').trim().toLowerCase();
  const branch = String(req.body.inviteBranch || '').trim();
  const department = String(req.body.inviteDept || '').trim().toUpperCase();

  if (!emailRegex.test(email)) {
    return redirectWithFlash(req, res, {
      error: 'Please enter a valid email address.'
    });
  }

  if (!inviteRoles.has(role)) {
    return redirectWithFlash(req, res, {
      error: 'Please select a valid invite role.'
    });
  }

  if (!inviteBranches.has(branch)) {
    return redirectWithFlash(req, res, {
      error: 'Please select a valid branch.'
    });
  }

  if (!inviteDepartments.has(department)) {
    return redirectWithFlash(req, res, {
      error: 'Please select a valid department.'
    });
  }

  const invite = {
    token: crypto.randomBytes(24).toString('hex'),
    email,
    role,
    branch,
    department,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };

  await createInvite(invite);
  const inviteLink = `${buildAppBaseUrl(req)}/account_setup?token=${encodeURIComponent(invite.token)}`;

  const inviteEmailResult = await sendGmailAppLink({
    to: email,
    linkUrl: inviteLink,
    kind: 'account_invite',
    inviteRole: role
  });

  let inviteEmailNote = '';
  if (inviteEmailResult.sent) {
    inviteEmailNote = ` Email sent via ${inviteEmailResult.provider || 'email'}.`;
  } else if (inviteEmailResult.skipped) {
    inviteEmailNote = ' Email not sent (no email provider configured).';
  } else {
    inviteEmailNote = ` Email failed: ${inviteEmailResult.error || 'Unknown error'}.`;
  }

  const successMessage = `Invite created for ${email}. Invite link: ${inviteLink}${inviteEmailNote}`;
  return redirectWithFlash(req, res, { success: successMessage });
});

router.post('/employees/update', requireAdmin, async (req, res) => {
  const { username } = req.body;

  const fullName = properCase(req.body.fullName || '');
  const department = String(req.body.department || '').trim().toUpperCase();
  const branch = properCase(req.body.branch || '');

  if (!nameRegex.test(fullName)) {
    return redirectWithFlash(req, res, { error: 'Invalid full name.' });
  }

  const updated = await updateUserAccount(username, {
    fullName,
    department,
    branch
  });

  if (!updated) {
    return redirectWithFlash(req, res, { error: 'Technician account not found.' });
  }

  return redirectWithFlash(req, res, { success: 'Technician account updated successfully.' });
});

router.post('/employees/reset-password', requireAdmin, async (req, res) => {
  const email = String(req.body.resetEmail || '').trim().toLowerCase();

  if (!emailRegex.test(email)) {
    return redirectWithFlash(req, res, {
      error: 'Please enter a valid email address.'
    });
  }

  const account = await findAccountByEmail(email);
  if (!account) {
    return redirectWithFlash(req, res, {
      error: 'No account was found for that email address.'
    });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const resetEntry = {
    token,
    username: account.username,
    email,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    usedAt: null
  };

  await createPasswordReset(resetEntry);

  const resetLink = `${buildAppBaseUrl(req)}/reset_password?token=${encodeURIComponent(token)}`;

  const resetEmailResult = await sendGmailAppLink({
    to: email,
    linkUrl: resetLink,
    kind: 'password_reset'
  });

  let resetEmailNote = '';
  if (resetEmailResult.sent) {
    resetEmailNote = ` Email sent via ${resetEmailResult.provider || 'email'}.`;
  } else if (resetEmailResult.skipped) {
    resetEmailNote = ' Email not sent (no email provider configured).';
  } else {
    resetEmailNote = ` Email failed: ${resetEmailResult.error || 'Unknown error'}.`;
  }

  const successMessage = `Reset link created for ${email}. Reset link: ${resetLink}${resetEmailNote}`;
  return redirectWithFlash(req, res, { success: successMessage });
});

router.post('/employees/toggle', requireAdmin, async (req, res) => {
  const { username, status } = req.body;
  const updated = await setUserStatus(username, status === 'inactive' ? 'inactive' : 'active');

  if (!updated) {
    return redirectWithFlash(req, res, { error: 'Technician account not found.' });
  }

  return redirectWithFlash(req, res, { success: 'Technician status updated successfully.' });
});

// Unit and model names: letters, digits, spaces and the symbols the built-in
// catalog already uses (P&A, 9750+, K663 (CO2)).
const unitModelNameRegex = /^[A-Za-z0-9&+()/. -]+$/;
const UNIT_MODEL_MAX_LENGTH = 40;

router.post('/unit-models/create', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'unit-models' });
  const unitInput = cleanName(req.body.unit);
  const modelInput = cleanName(req.body.model).toUpperCase();

  if (!unitInput) {
    return flash({ error: 'Enter or select a unit.' });
  }
  if (unitInput.length > UNIT_MODEL_MAX_LENGTH || !unitModelNameRegex.test(unitInput)) {
    return flash({ error: `Unit name must be up to ${UNIT_MODEL_MAX_LENGTH} characters: letters, numbers, spaces and & + ( ) / . - only.` });
  }
  if (modelInput && (modelInput.length > UNIT_MODEL_MAX_LENGTH || !unitModelNameRegex.test(modelInput) || !normalizeModelKey(modelInput))) {
    return flash({ error: `Model name must be up to ${UNIT_MODEL_MAX_LENGTH} characters: letters, numbers, spaces and & + ( ) / . - only.` });
  }

  const { rows, available } = await listUnitModels();
  if (!available) {
    return flash({ error: 'Units & Models is not set up yet. Run database/migrations/002-unit-models.sql in Supabase first.' });
  }

  const catalog = mergeCatalog(MONITOR_PARTS_CATALOG, rows);
  const existingUnit = findUnitName(catalog, unitInput);

  if (!modelInput) {
    if (existingUnit) {
      return flash({ error: `Unit "${existingUnit}" already exists.` });
    }
  } else {
    // One model name in the whole system: CIJ 9450 existing blocks TTO 9450.
    const conflict = findModelConflict(catalog, modelInput);
    if (conflict) {
      return flash({
        error: `Model "${conflict.model}" already exists under ${conflict.unit}. Each model can only exist once in the system.`
      });
    }
  }

  const unitName = existingUnit || unitInput;
  try {
    await insertUnitModel({
      unit: unitName,
      unitKey: normalizeUnitKey(unitName),
      model: modelInput || null,
      modelKey: modelInput ? normalizeModelKey(modelInput) : null,
      createdBy: req.session.user ? req.session.user.fullName || req.session.user.username || '' : ''
    });
  } catch (err) {
    // Someone added the same name between our check and the insert.
    if (err && err.code === 'DUPLICATE_UNIT_MODEL') {
      return flash({ error: modelInput ? `Model "${modelInput}" already exists.` : `Unit "${unitName}" already exists.` });
    }
    throw err;
  }

  return flash({
    success: modelInput ? `Model ${unitName} ${modelInput} added.` : `Unit "${unitName}" added.`
  });
});

router.post('/unit-models/delete', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'unit-models' });
  const id = Number(req.body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return flash({ error: 'Invalid entry.' });
  }

  const row = await findUnitModelById(id);
  if (!row) {
    return flash({ error: 'That entry no longer exists.' });
  }

  const [machines, { rows }] = await Promise.all([listAllMachines(), listUnitModels()]);

  if (row.modelKey) {
    // Removing a model that machines are recorded against would make those
    // records fail the Add Printer model check the next time it's used.
    const inUse = machines.filter(machine =>
      normalizeUnitKey(machine.unit) === row.unitKey && normalizeModelKey(machine.model) === row.modelKey
    ).length;
    if (inUse) {
      return flash({ error: `${row.unit} ${row.model} is used by ${inUse} machine record${inUse === 1 ? '' : 's'} and cannot be removed.` });
    }
  } else {
    const catalog = mergeCatalog(MONITOR_PARTS_CATALOG, rows);
    const unitName = findUnitName(catalog, row.unit);
    const modelCount = unitName ? Object.keys(catalog[unitName]).length : 0;
    if (modelCount) {
      return flash({ error: `Unit "${row.unit}" still has ${modelCount} model${modelCount === 1 ? '' : 's'}. Remove them first.` });
    }
    const inUse = machines.filter(machine => normalizeUnitKey(machine.unit) === row.unitKey).length;
    if (inUse) {
      return flash({ error: `Unit "${row.unit}" is used by ${inUse} machine record${inUse === 1 ? '' : 's'} and cannot be removed.` });
    }
  }

  await deleteUnitModel(id);
  return flash({ success: row.modelKey ? `Model ${row.unit} ${row.model} removed.` : `Unit "${row.unit}" removed.` });
});

// ── Parts catalog (admin only) ──
// The only list technicians may pick parts from; they can never add to it.

const PART_NUMBER_MAX = 100;
const PART_DESCRIPTION_MAX = 255;

router.post('/parts/save', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'parts' });
  const id = String(req.body.id || '').trim();
  const partNumber = cleanName(req.body.partNumber).toUpperCase();
  const description = cleanName(req.body.description).toUpperCase();
  const unitInput = cleanName(req.body.unit);

  if (!partNumber) return flash({ error: 'Enter a part number.' });
  if (!description) return flash({ error: 'Enter a part description.' });
  if (partNumber.length > PART_NUMBER_MAX) {
    return flash({ error: `Part number can be up to ${PART_NUMBER_MAX} characters.` });
  }
  if (description.length > PART_DESCRIPTION_MAX) {
    return flash({ error: `Part description can be up to ${PART_DESCRIPTION_MAX} characters.` });
  }

  const { rows } = await listUnitModels();
  const catalog = mergeCatalog(MONITOR_PARTS_CATALOG, rows);
  const unit = findUnitName(catalog, unitInput);
  if (!unit) return flash({ error: 'Select a unit from the list.' });

  const parts = await listParts();
  const key = partKey(partNumber, unit);
  const duplicate = parts.find(part => part.id !== id && partKey(part.partNumber, part.unit) === key);
  if (duplicate) {
    return flash({ error: `${partNumber} already exists under ${unit}.` });
  }

  if (id) {
    const existing = await findPartById(id);
    if (!existing) return flash({ error: 'That part no longer exists.' });
    await updatePart(id, { partNumber, description, unit });
    return flash({ success: `Part ${partNumber} updated.` });
  }

  await insertPart({ partNumber, description, unit });
  return flash({ success: `Part ${partNumber} added to ${unit}.` });
});

router.post('/parts/delete', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'parts' });
  const id = String(req.body.id || '').trim();
  const part = id ? await findPartById(id) : null;
  if (!part) return flash({ error: 'That part no longer exists.' });
  await deletePart(id);
  // Past reports keep the part's name as it was written; only the picker changes.
  return flash({ success: `Part ${part.partNumber} removed.` });
});

/**
 * Move one serial (one machine row) to another client — for a unit encoded
 * under the wrong client, or one physically moved to a new site. Admin only.
 * The row is picked by id, not serial, because a few legacy serials appear on
 * more than one row.
 */
router.post('/unit-transfer', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'unit-transfer' });
  const machineId = Number(req.body.machineId);
  const fromClientId = String(req.body.fromClientId || '').trim().toLowerCase();
  const toClientId = String(req.body.toClientId || '').trim().toLowerCase();

  if (!Number.isInteger(machineId) || machineId <= 0) {
    return flash({ error: 'Select a unit to transfer.' });
  }
  if (!toClientId) {
    return flash({ error: 'Select the client to move the unit to.' });
  }
  if (toClientId === fromClientId) {
    return flash({ error: 'The unit is already under that client.' });
  }

  const toClient = await findClientById(toClientId);
  if (!toClient) {
    return flash({ error: 'That client no longer exists.' });
  }
  if (toClient.status === 'inactive') {
    return flash({ error: `${toClient.name} is inactive. Reactivate it before moving units to it.` });
  }

  const moved = await transferMachineToClient(machineId, fromClientId, toClient);
  if (!moved) {
    return flash({ error: 'That unit was changed or moved by someone else. Reload and try again.' });
  }

  const by = req.session.user ? req.session.user.fullName || req.session.user.username || '' : '';
  console.log(`[unit-transfer] ${moved.serialNo} (#${moved.id}) ${fromClientId} -> ${toClient.id} by ${by}`);

  return flash({ success: `Serial ${moved.serialNo} moved to ${toClient.name}.` });
});

/**
 * Disable or re-enable one unit (machine row). A disabled unit keeps its serial
 * and history but stops counting as installed; it shows under Units Disabled in
 * Monitoring instead. Admin only. Picked by row id for the same reason
 * /unit-transfer is.
 */
router.post('/unit-disable', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'unit-transfer' });
  const machineId = Number(req.body.machineId);
  const disable = String(req.body.action || '').trim().toLowerCase() !== 'enable';

  if (!Number.isInteger(machineId) || machineId <= 0) {
    return flash({ error: 'Select a unit first.' });
  }

  const by = req.session.user ? req.session.user.fullName || req.session.user.username || '' : '';

  let updated;
  try {
    updated = await setMachineDisabled(machineId, disable, by);
  } catch (err) {
    if (err && err.code === 'MACHINE_DISABLE_UNAVAILABLE') {
      console.error('[unit-disable]', err.message);
      return flash({ error: 'Disabling units needs a one-time database setup (migration 004) that has not been run yet.' });
    }
    throw err;
  }

  if (!updated) {
    return flash({
      error: `That unit was already ${disable ? 'disabled' : 'enabled'}, or no longer exists. Reload and try again.`
    });
  }

  console.log(`[unit-disable] ${updated.serialNo} (#${updated.id}) ${disable ? 'disabled' : 'enabled'} by ${by}`);
  return flash({
    success: disable
      ? `Serial ${updated.serialNo} disabled. It no longer counts as an installed unit.`
      : `Serial ${updated.serialNo} enabled. It counts as an installed unit again.`
  });
});

/**
 * Scheduling: assign a technician to a client site on a date (time optional)
 * with work instructions. Create and edit share one form — a scheduleId means
 * edit. Admin only.
 */
const SCHEDULE_DESCRIPTION_MAX = 2000;

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Push a schedule event to the technician's phone(s). Past-dated schedules
// aren't news. Returns the number of phones reached, or null when nothing was
// sent on purpose.
async function notifySchedule(kind, schedule) {
  if (!schedule || schedule.date < scheduleToday()) return null;
  return notifyUser(schedule.technicianUsername, scheduleNotification(kind, schedule));
}

// Tells the admin whether the technician will actually see a notification.
function notifiedNote(sent) {
  if (sent === null || !isPushConfigured()) return '';
  return sent
    ? ' Notification sent to their phone.'
    : ' They have not turned on notifications, so tell them directly.';
}

const SCHEDULE_NOTIFY_FIELDS = ['date', 'time', 'clientId', 'location', 'description'];

router.post('/schedules/save', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'scheduling' });
  const scheduleId = req.body.scheduleId ? Number(req.body.scheduleId) : null;
  const technicianUsername = String(req.body.technicianUsername || '').trim().toLowerCase();
  const clientId = String(req.body.clientId || '').trim().toLowerCase();
  const location = cleanName(req.body.location || '');
  const date = String(req.body.date || '').trim();
  const time = String(req.body.time || '').trim();
  const description = String(req.body.description || '').replace(/\r\n/g, '\n').trim();

  if (scheduleId !== null && (!Number.isInteger(scheduleId) || scheduleId <= 0)) {
    return flash({ error: 'That schedule no longer exists. Reload and try again.' });
  }
  if (!technicianUsername) return flash({ error: 'Select a technician.' });
  if (!clientId) return flash({ error: 'Select a client.' });
  if (!isValidIsoDate(date)) return flash({ error: 'Enter a valid schedule date.' });
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return flash({ error: 'Enter a valid schedule time.' });
  if (!description) return flash({ error: 'Enter a description of the scheduled work.' });
  if (description.length > SCHEDULE_DESCRIPTION_MAX) {
    return flash({ error: `Keep the description under ${SCHEDULE_DESCRIPTION_MAX} characters.` });
  }

  // Work can only be scheduled for today or later. A schedule already on a
  // past date can still be edited (say, to fix its description) as long as
  // its date is left as it was.
  // The schedule as it was before this edit, to know whom to notify and of what.
  let existing = null;
  try {
    existing = scheduleId ? await findScheduleById(scheduleId) : null;
  } catch (err) {
    if (!err || err.code !== 'SCHEDULES_UNAVAILABLE') throw err;
  }
  if (existing && existing.status === 'done') {
    return flash({ error: 'A completed schedule can no longer be edited. Delete it instead.' });
  }
  if (date < scheduleToday()) {
    if (!existing || existing.date !== date) {
      return flash({ error: 'A schedule date cannot be in the past. Pick today or a later date.' });
    }
  }

  const [technician, client] = await Promise.all([
    findAccountByUsername(technicianUsername),
    findClientById(clientId)
  ]);
  if (!technician || technician.role !== 'user' || technician.status === 'inactive') {
    return flash({ error: 'That technician is not an active technician account.' });
  }
  if (!client) return flash({ error: 'That client no longer exists.' });
  if (client.status === 'inactive') {
    return flash({ error: `${client.name} is inactive. Reactivate it before scheduling work there.` });
  }

  const schedule = {
    technicianUsername: technician.username,
    technicianName: technician.fullName,
    clientId: client.id,
    clientName: client.name,
    location: location || client.location || '',
    date,
    time,
    description
  };
  const by = req.session.user ? req.session.user.fullName || req.session.user.username || '' : '';

  let saved;
  try {
    saved = scheduleId
      ? await updateSchedule(scheduleId, schedule)
      : await insertSchedule(schedule, by);
  } catch (err) {
    if (err && err.code === 'SCHEDULES_UNAVAILABLE') {
      console.error('[schedules]', err.message);
      return flash({ error: 'Scheduling needs a one-time database setup (migration 005) that has not been run yet.' });
    }
    throw err;
  }
  if (!saved) return flash({ error: 'That schedule no longer exists. Reload and try again.' });

  console.log(`[schedules] #${saved.id} ${scheduleId ? 'updated' : 'created'}: ${saved.technicianUsername} @ ${saved.clientId} on ${saved.date} by ${by}`);

  // Done or cancelled schedules are edited quietly; only live work is news.
  let sent = null;
  if (saved.status === 'scheduled') {
    if (!existing) {
      sent = await notifySchedule('created', saved);
    } else if (existing.technicianUsername !== saved.technicianUsername) {
      await notifySchedule('removed', existing);
      sent = await notifySchedule('created', saved);
    } else if (SCHEDULE_NOTIFY_FIELDS.some(field => existing[field] !== saved[field])) {
      sent = await notifySchedule('changed', saved);
    }
  }

  return flash({
    success: `${saved.technicianName} ${scheduleId ? 'schedule updated' : 'scheduled'} for ${saved.clientName} on ${saved.date}${saved.time ? ` at ${saved.time}` : ''}.${notifiedNote(sent)}`
  });
});

router.post('/schedules/status', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'scheduling' });
  const scheduleId = Number(req.body.scheduleId);
  const status = String(req.body.status || '').trim().toLowerCase();
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) return flash({ error: 'Select a schedule first.' });
  if (!['scheduled', 'done', 'cancelled'].includes(status)) return flash({ error: 'Unknown schedule status.' });

  let updated;
  try {
    const current = await findScheduleById(scheduleId);
    if (current && current.status === 'done') {
      return flash({ error: 'A completed schedule can no longer be changed. Delete it instead.' });
    }
    updated = await setScheduleStatus(scheduleId, status);
  } catch (err) {
    if (err && err.code === 'SCHEDULES_UNAVAILABLE') {
      return flash({ error: 'Scheduling needs a one-time database setup (migration 005) that has not been run yet.' });
    }
    throw err;
  }
  if (!updated) return flash({ error: 'That schedule no longer exists. Reload and try again.' });

  // Marking work done is the technician's own news; the rest changes their day.
  const sent = status === 'done' ? null
    : await notifySchedule(status === 'cancelled' ? 'cancelled' : 'reopened', updated);

  const label = { scheduled: 'reopened', done: 'marked done', cancelled: 'cancelled' }[status];
  return flash({ success: `${updated.technicianName}'s ${updated.date} schedule at ${updated.clientName} ${label}.${notifiedNote(sent)}` });
});

router.post('/schedules/delete', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'scheduling' });
  const scheduleId = Number(req.body.scheduleId);
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) return flash({ error: 'Select a schedule first.' });

  let deleted;
  let removed = null;
  try {
    removed = await findScheduleById(scheduleId);
    deleted = await deleteSchedule(scheduleId);
  } catch (err) {
    if (err && err.code === 'SCHEDULES_UNAVAILABLE') {
      return flash({ error: 'Scheduling needs a one-time database setup (migration 005) that has not been run yet.' });
    }
    throw err;
  }
  if (!deleted) return flash({ error: 'That schedule was already removed.' });

  // Removing a schedule the technician still expects to work is news to them.
  const sent = removed && removed.status === 'scheduled'
    ? await notifySchedule('removed', removed)
    : null;
  return flash({ success: `Schedule removed.${notifiedNote(sent)}` });
});

router.post('/clients/create', requireAdmin, async (req, res) => {
  const clientName = properCase(req.body.clientName || '');
  const location = properCase(req.body.location || '');
  const id = slugify(clientName);

  if (!clientName) {
    return redirectWithFlash(req, res, { error: 'Client name is required.' });
  }

  const created = await createClient({
    id,
    name: clientName,
    location,
    status: 'active'
  });

  if (!created) {
    return redirectWithFlash(req, res, { error: 'Client already exists.' });
  }

  return res.redirect('/admin_account#clients');
});

router.post('/clients/update', requireAdmin, async (req, res) => {
  const { clientId } = req.body;
  const updated = await updateClient(clientId, {
    name: properCase(req.body.clientName || ''),
    location: properCase(req.body.location || '')
  });

  if (!updated) {
    return redirectWithFlash(req, res, { error: 'Client not found.' });
  }

  return res.redirect('/admin_account#clients');
});

router.post('/clients/toggle', requireAdmin, async (req, res) => {
  const { clientId, status } = req.body;
  const updated = await setClientStatus(clientId, status === 'inactive' ? 'inactive' : 'active');

  if (!updated) {
    return redirectWithFlash(req, res, { error: 'Client not found.' });
  }

  return res.redirect('/admin_account#clients');
});

/**
 * Assigns a client to one sales account, or removes the assignment when
 * action=unassign. A client holds at most one sales account, so assigning one
 * that already has a different owner is refused — remove the assignment first.
 * A sales account can hold any number of clients.
 */
router.post('/clients/assign-sales', requireAdmin, async (req, res) => {
  const flash = payload => redirectWithFlash(req, res, { ...payload, hash: 'clients' });
  try {
    const clientId = String(req.body.clientId || '').trim().toLowerCase();
    if (!(await isSalesAssignmentAvailable())) {
      return flash({ error: 'Setup needed: run database/migrations/003-client-sales-assignment.sql in the Supabase SQL editor first.' });
    }

    const client = await findClientById(clientId);
    if (!client) return flash({ error: 'Client not found.' });

    if (req.body.action === 'unassign') {
      await assignClientSales(client.id, '');
      return flash({ success: `${client.name} is no longer assigned to a sales account.` });
    }

    const salesUsername = String(req.body.salesUsername || '').trim().toLowerCase();
    if (!salesUsername) return flash({ error: 'Select a sales account.' });

    const salesAccount = await findAccountByUsername(salesUsername);
    if (!salesAccount || salesAccount.role !== 'sales' || salesAccount.status === 'inactive') {
      return flash({ error: 'That is not an active sales account.' });
    }

    const outcome = await assignClientSales(client.id, salesUsername);
    if (outcome.result === 'taken') {
      const owner = await findAccountByUsername(outcome.owner);
      const ownerName = owner ? owner.fullName : outcome.owner;
      return flash({ error: `${client.name} is already assigned to ${ownerName}. Remove that assignment first.` });
    }
    if (outcome.result === 'not_found') return flash({ error: 'Client not found.' });

    return flash({ success: `${client.name} assigned to ${salesAccount.fullName}.` });
  } catch (err) {
    console.error('[clients/assign-sales]', err);
    return flash({ error: 'Could not update the sales assignment.' });
  }
});

module.exports = router;
