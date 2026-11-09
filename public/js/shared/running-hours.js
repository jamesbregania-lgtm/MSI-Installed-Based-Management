/**
 * Which units track running hours — one rule, one file.
 *
 * LASER and DOD units, and the 5800 model wherever it sits, have no hour meter
 * to read, so running hours are not collected for them: the forms lock the
 * field at 0 and the store pins it to 0 no matter what a request carries.
 *
 * 5800 is an LCIJ model. It stays matched by model rather than by unit because
 * legacy rows still carry it under DOD, and those must go on reading 0 whether
 * or not they are ever refiled.
 *
 * It lives under public/ because the browser loads it as a plain <script>, and
 * the server `require`s this same file — the forms and the database must never
 * disagree about which units are exempt.
 */
(function (global) {
  const NO_RUNNING_HOURS_UNITS = ['LASER', 'DOD'];
  const NO_RUNNING_HOURS_MODELS = ['5800'];

  // Unit names are spelled inconsistently across legacy rows ("P & A" vs
  // "P&A"), so every comparison goes through the same squash.
  function unitKey(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase();
  }

  // "5800", "5800 " and "5800-S" are not the same model, but "58 00" style
  // spacing and hyphens are noise — matches lib/unit-catalog's model key.
  function modelKey(value) {
    return String(value == null ? '' : value).toUpperCase().replace(/[\s-]+/g, '');
  }

  const EXEMPT_UNITS = new Set(NO_RUNNING_HOURS_UNITS.map(unitKey));
  const EXEMPT_MODELS = new Set(NO_RUNNING_HOURS_MODELS.map(modelKey));

  /** True when this unit/model pair has no running hours to record. */
  function isRunningHoursExempt(unit, model) {
    return EXEMPT_UNITS.has(unitKey(unit)) || EXEMPT_MODELS.has(modelKey(model));
  }

  /** The inverse, for reading as a condition rather than a negation. */
  function tracksRunningHours(unit, model) {
    return !isRunningHoursExempt(unit, model);
  }

  /** Same check against a machine record, whichever shape it arrives in. */
  function isRecordRunningHoursExempt(record) {
    if (!record || typeof record !== 'object') return false;
    const unit = record.unit !== undefined ? record.unit : record.unit_type;
    return isRunningHoursExempt(unit, record.model);
  }

  /**
   * The value to store: whatever was entered for a tracked unit, a hard 0 for
   * an exempt one. Non-numeric input falls back to 0 as it always has.
   */
  function coerceRunningHours(value, unit, model) {
    if (isRunningHoursExempt(unit, model)) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  /**
   * Browser only: pin a running-hours <input> to 0 and take it out of reach,
   * or hand it back when the unit does track hours. The greyed-out 0 is the
   * whole explanation — the technicians know which units have no hour meter.
   *
   * `required` is dropped while locked, then put back as the markup had it.
   * These modals are reused for every machine in the list, so unlocking has
   * to restore exactly what locking took away — otherwise the first exempt
   * machine opened would leave the field optional for every machine after it.
   */
  function applyRunningHoursLock(inputEl, exempt) {
    if (!inputEl) return;

    if (inputEl.dataset && inputEl.dataset.runningHoursRequired === undefined) {
      inputEl.dataset.runningHoursRequired = inputEl.required ? '1' : '0';
    }

    if (exempt) {
      inputEl.value = '0';
      inputEl.disabled = true;
      inputEl.readOnly = true;
      inputEl.required = false;
      inputEl.setAttribute('aria-disabled', 'true');
      inputEl.classList.add('running-hours-locked');
    } else {
      inputEl.disabled = false;
      inputEl.readOnly = false;
      inputEl.required = !inputEl.dataset || inputEl.dataset.runningHoursRequired === '1';
      inputEl.removeAttribute('aria-disabled');
      inputEl.classList.remove('running-hours-locked');
    }
  }

  const api = {
    NO_RUNNING_HOURS_UNITS,
    NO_RUNNING_HOURS_MODELS,
    isRunningHoursExempt,
    tracksRunningHours,
    isRecordRunningHoursExempt,
    coerceRunningHours,
    applyRunningHoursLock
  };

  if (typeof module !== 'undefined' && module.exports) {
    // Node: exports only — the server has no business gaining globals.
    module.exports = api;
  } else if (global) {
    // Browser: the client scripts are plain globals, so these join them.
    Object.assign(global, api);
    global.RunningHoursRule = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
