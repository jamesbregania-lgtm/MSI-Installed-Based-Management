const db = require('./db');

const STATUSES = ['scheduled', 'done', 'cancelled'];

// Every branch is in the Philippines, so "today" for scheduling is Manila's
// date, whatever timezone the server itself runs in.
const SCHEDULE_TIMEZONE = 'Asia/Manila';

function scheduleToday() {
  // en-CA formats as YYYY-MM-DD, the same shape as the stored dates.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// "relation does not exist" (database/db.js maps MySQL 1146 to 42P01):
// the 005 migration hasn't been run yet.
function isMissingTableError(error) {
  const code = String(error && error.code || '');
  return code === '42P01' || code === 'PGRST205';
}

function unavailableError() {
  const err = new Error('schedules table is missing — run database/migrations/005-schedules.sql.');
  err.code = 'SCHEDULES_UNAVAILABLE';
  return err;
}

function mapRow(row) {
  return {
    id: row.id,
    technicianUsername: row.technician_username,
    technicianName: row.technician_name || row.technician_username,
    clientId: row.client_id,
    clientName: row.client_name || row.client_id,
    location: row.location || '',
    date: row.schedule_date,
    // The database returns "09:00:00"; the page only needs HH:MM.
    time: row.schedule_time ? String(row.schedule_time).slice(0, 5) : '',
    description: row.description || '',
    status: STATUSES.includes(row.status) ? row.status : 'scheduled',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

function toRow(schedule) {
  return {
    technician_username: schedule.technicianUsername,
    technician_name: schedule.technicianName || '',
    client_id: schedule.clientId,
    client_name: schedule.clientName || '',
    location: schedule.location || '',
    schedule_date: schedule.date,
    schedule_time: schedule.time || null,
    description: schedule.description || ''
  };
}

/**
 * Every schedule, oldest date first. Returns { rows, available } — available
 * is false when the table hasn't been created, so the admin page can show a
 * setup notice instead of failing.
 */
async function listSchedules() {
  const { data, error } = await db
    .from('schedules')
    .select('*')
    .order('schedule_date')
    .order('schedule_time', { nullsFirst: true })
    .order('id');
  if (error) {
    if (isMissingTableError(error)) return { rows: [], available: false };
    throw error;
  }
  return { rows: (data || []).map(mapRow), available: true };
}

/**
 * One technician's schedules dated on or after `fromDate` (YYYY-MM-DD).
 * A missing table just means no schedules yet.
 */
async function listSchedulesForTechnician(username, fromDate) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return [];
  let query = db
    .from('schedules')
    .select('*')
    .eq('technician_username', key);
  if (fromDate) query = query.gte('schedule_date', fromDate);
  const { data, error } = await query
    .order('schedule_date')
    .order('schedule_time', { nullsFirst: true })
    .order('id');
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data || []).map(mapRow);
}

async function insertSchedule(schedule, createdBy) {
  const { data, error } = await db
    .from('schedules')
    .insert({ ...toRow(schedule), created_by: createdBy || '' })
    .select('*')
    .single();
  if (error) {
    if (isMissingTableError(error)) throw unavailableError();
    throw error;
  }
  return mapRow(data);
}

async function findScheduleById(id) {
  const { data, error } = await db
    .from('schedules')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw unavailableError();
    throw error;
  }
  return data ? mapRow(data) : null;
}

async function updateSchedule(id, schedule) {
  const { data, error } = await db
    .from('schedules')
    .update({ ...toRow(schedule), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw unavailableError();
    throw error;
  }
  return data ? mapRow(data) : null;
}

async function setScheduleStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown schedule status "${status}".`);
  const { data, error } = await db
    .from('schedules')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw unavailableError();
    throw error;
  }
  return data ? mapRow(data) : null;
}

/**
 * A technician's activity log is their proof of work: mark the open schedules
 * of every technician on the log (the submitter and anyone picked under Other
 * Technicians) for this client dated today as done. A technician who isn't on
 * the log keeps their schedule pending. Earlier days are
 * never touched — an uncompleted past schedule stays closed (the admin page
 * shows it as Closed) and a later log can't complete it. Returns the schedules
 * that were completed; a missing table just means there is nothing to complete.
 */
async function completeSchedulesForLog(usernames, clientId, today = scheduleToday()) {
  const keys = [...new Set([].concat(usernames || [])
    .map(name => String(name || '').trim().toLowerCase())
    .filter(Boolean))];
  const client = String(clientId || '').trim();
  if (!keys.length || !client) return [];
  const { data, error } = await db
    .from('schedules')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .in('technician_username', keys)
    .eq('client_id', client)
    .eq('schedule_date', today)
    .eq('status', 'scheduled')
    .select('*');
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data || []).map(mapRow);
}

async function deleteSchedule(id) {
  const { data, error } = await db
    .from('schedules')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) {
    if (isMissingTableError(error)) throw unavailableError();
    throw error;
  }
  return Boolean(data && data.length);
}

module.exports = {
  listSchedules,
  listSchedulesForTechnician,
  insertSchedule,
  findScheduleById,
  updateSchedule,
  setScheduleStatus,
  completeSchedulesForLog,
  scheduleToday,
  deleteSchedule
};
