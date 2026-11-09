/* ── Edit Service Report / History Entry (admin-only) ──
   Corrects an existing history entry — the install snapshot, a PM/Parts
   report, or an ad-hoc Cannibalize/Pull Out update. Does not create a new
   activity.
   Server enforces the admin-only rule independently (POST .../machines/report/edit,
   guarded by requireAdmin); this file only controls whether the button/form
   are shown, matching the server behavior, not replacing it.

   Locked fields (never editable): submitted by
   Editable when a report exists: refNo (Problem / Action / Recommendation
   were dropped from new reports; old text is kept as it was)
   Always editable: unit, model, serial no, date, running hours, status,
   SMR date, technicians

   Unit, model and serial are machine-level: correcting them from any entry
   corrects the whole unit. They go to the server only when changed, and the
   server re-checks them with the Add Printer rules. */

const editReportPopup = document.getElementById('editReportPopup');
const closeEditReportPopupBtn = document.getElementById('closeEditReportPopup');
const cancelEditReportBtn = document.getElementById('cancelEditReportBtn');
const editReportForm = document.getElementById('editReportForm');
const editServiceReportBtn = document.getElementById('editServiceReportBtn');

let editReportContext = null; // { machineIndex, rowIndex, record, target }

// ── Technician dropdown ──
// Same suggestion list and behaviour as the Other Technicians field on the
// report and ad-hoc forms, so corrections can't introduce misspelled names.
const editReportTechniciansInput = document.getElementById('edit-report-technicians');
const editReportTechDropdown = document.getElementById('edit-report-tech-dropdown');
let editReportTechFocusedIndex = -1;

// Names already on the entry when the modal opened. A correction may keep
// them even when they aren't an active account any more (inactive staff,
// legacy spellings) — otherwise those older entries could never be saved.
let editReportOriginalTechnicians = [];

// The entry's submitter is credited under Submitted By, so this field never
// lists or offers them. Report entries store the submitter first in their
// technicians list; when the entry did, that stored name is put back on save
// so the correction doesn't reshape it.
let editReportSubmitter = '';
let editReportListedSubmitter = '';

function isEditReportSubmitter(name) {
    return Boolean(editReportSubmitter) && normalizeTechnicianName(name).toLowerCase() === editReportSubmitter.toLowerCase();
}

// Like "Other Technicians", minus the submitter — but the person doing the
// correction is a valid pick when they didn't submit the entry.
function getEditReportTechnicianPool() {
    const currentName = normalizeTechnicianName(
        typeof CURRENT_USER_FULLNAME !== 'undefined' ? CURRENT_USER_FULLNAME : ''
    );
    return [...getTechnicianPool(), currentName]
        .filter(Boolean)
        .filter(name => !isEditReportSubmitter(name))
        .filter((name, index, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === index)
        .sort((a, b) => a.localeCompare(b));
}

function closeEditReportTechDropdown() {
    if (!editReportTechDropdown) return;
    editReportTechDropdown.classList.remove('open');
    editReportTechFocusedIndex = -1;
}

function insertEditReportTechnician(name) {
    if (!editReportTechniciansInput) return;
    const draft = getTechnicianDraftState(editReportTechniciansInput.value);
    const merged = [...draft.committed, name]
        .filter(Boolean)
        .filter((v, idx, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === idx);
    editReportTechniciansInput.value = merged.length ? `${merged.join(', ')}, ` : '';
    editReportTechniciansInput.setCustomValidity('');
    closeEditReportTechDropdown();
    editReportTechniciansInput.focus();
}

function renderEditReportTechDropdown() {
    if (!editReportTechniciansInput || !editReportTechDropdown) return;
    const draft = getTechnicianDraftState(editReportTechniciansInput.value);
    const committedSet = new Set(draft.committed.map(n => n.toLowerCase()));
    let options = getEditReportTechnicianPool().filter(n => !committedSet.has(n.toLowerCase()));
    if (draft.searchTerm) {
        const q = draft.searchTerm.toLowerCase();
        options = options.filter(n => n.toLowerCase().includes(q));
    }
    if (!options.length) {
        editReportTechDropdown.innerHTML = '<li class="report-tech-empty">No active users found.</li>';
        editReportTechDropdown.classList.add('open');
        return;
    }
    editReportTechDropdown.innerHTML = options.map((name, i) =>
        `<li class="report-tech-item${i === editReportTechFocusedIndex ? ' is-active' : ''}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</li>`
    ).join('');
    editReportTechDropdown.classList.add('open');
    editReportTechDropdown.querySelectorAll('.report-tech-item').forEach(item => {
        item.addEventListener('mousedown', (event) => {
            event.preventDefault();
            insertEditReportTechnician(item.dataset.name || '');
        });
    });
}

// Splits the field into names and flags any that are neither on the list nor
// already on the entry, and the submitter if they were typed back in.
function parseEditReportTechnicians(rawValue) {
    const allowed = new Set(
        [...getEditReportTechnicianPool(), ...editReportOriginalTechnicians].map(n => n.toLowerCase())
    );
    const picked = [];
    const invalid = [];
    let hasSubmitter = false;
    String(rawValue || '').split(',').map(normalizeTechnicianName).filter(Boolean).forEach(name => {
        const key = name.toLowerCase();
        if (isEditReportSubmitter(name)) { hasSubmitter = true; return; }
        if (!allowed.has(key)) { invalid.push(name); return; }
        if (!picked.some(existing => existing.toLowerCase() === key)) picked.push(name);
    });
    return { picked, invalid, hasSubmitter };
}

if (editReportTechniciansInput) {
    editReportTechniciansInput.addEventListener('input', () => { editReportTechFocusedIndex = -1; renderEditReportTechDropdown(); editReportTechniciansInput.setCustomValidity(''); });
    editReportTechniciansInput.addEventListener('focus', () => { renderEditReportTechDropdown(); });
    editReportTechniciansInput.addEventListener('keydown', (event) => {
        if (!editReportTechDropdown || !editReportTechDropdown.classList.contains('open')) {
            if (event.key === 'ArrowDown') { event.preventDefault(); renderEditReportTechDropdown(); }
            return;
        }
        const items = Array.from(editReportTechDropdown.querySelectorAll('.report-tech-item'));
        if (!items.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); editReportTechFocusedIndex = Math.min(editReportTechFocusedIndex + 1, items.length - 1); renderEditReportTechDropdown(); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); editReportTechFocusedIndex = Math.max(editReportTechFocusedIndex - 1, 0); renderEditReportTechDropdown(); return; }
        if (event.key === 'Enter') { event.preventDefault(); if (editReportTechFocusedIndex >= 0 && items[editReportTechFocusedIndex]) insertEditReportTechnician(items[editReportTechFocusedIndex].dataset.name || ''); return; }
        if (event.key === 'Escape') closeEditReportTechDropdown();
    });
}

document.addEventListener('click', (event) => {
    if (!editReportTechniciansInput || !editReportTechDropdown) return;
    if (!event.target.closest('#editReportForm .report-tech-wrap')) closeEditReportTechDropdown();
});

// ── Unit / Model pickers ──
// Free-typed like the Technicians field, but only a value from the list is
// accepted: the unit/model catalog the Add Printer form offers.
const editReportUnitInput = document.getElementById('edit-report-unit');
const editReportUnitDropdown = document.getElementById('edit-report-unit-dropdown');
const editReportModelInput = document.getElementById('edit-report-model');
const editReportModelDropdown = document.getElementById('edit-report-model-dropdown');
const editReportSerialInput = document.getElementById('edit-report-serial');
const editReportDateInput = document.getElementById('edit-report-date');

// The values the entry opened with, so unchanged fields aren't re-validated
// or sent — legacy units whose model has left the catalog stay saveable.
let editReportOriginalIdentity = { unit: '', model: '', serialNo: '', date: '' };

function getUnitModelOptions() {
    return window.UNIT_MODEL_OPTIONS || {};
}

function findCatalogUnit(value) {
    const key = String(value || '').trim().toUpperCase();
    if (!key) return null;
    return Object.keys(getUnitModelOptions()).find(unit => unit.toUpperCase() === key) || null;
}

function findCatalogModel(unit, value) {
    const key = String(value || '').trim().toUpperCase();
    if (!unit || !key) return null;
    return (getUnitModelOptions()[unit] || []).find(model => model.toUpperCase() === key) || null;
}

function wireSinglePicker(inputEl, dropdownEl, getOptions, onPick) {
    if (!inputEl || !dropdownEl) return;
    let focusedIndex = -1;

    const close = () => { dropdownEl.classList.remove('open'); focusedIndex = -1; };
    const pick = (value) => {
        inputEl.value = value;
        inputEl.setCustomValidity('');
        close();
        if (onPick) onPick(value);
    };
    const render = () => {
        const query = inputEl.value.trim().toLowerCase();
        const all = getOptions();
        // An exact value shows the whole list, so the field can be switched
        // without clearing it first.
        const exact = all.some(option => option.toLowerCase() === query);
        const options = query && !exact ? all.filter(option => option.toLowerCase().includes(query)) : all;
        if (!options.length) {
            dropdownEl.innerHTML = '<li class="report-tech-empty">No matches in the list.</li>';
            dropdownEl.classList.add('open');
            return;
        }
        dropdownEl.innerHTML = options.map((option, i) =>
            `<li class="report-tech-item${i === focusedIndex ? ' is-active' : ''}" data-value="${escapeHtml(option)}">${escapeHtml(option)}</li>`
        ).join('');
        dropdownEl.classList.add('open');
        dropdownEl.querySelectorAll('.report-tech-item').forEach(item => {
            item.addEventListener('mousedown', (event) => {
                event.preventDefault();
                pick(item.dataset.value || '');
            });
        });
    };

    inputEl.addEventListener('input', () => { focusedIndex = -1; inputEl.setCustomValidity(''); render(); });
    inputEl.addEventListener('focus', render);
    inputEl.addEventListener('blur', close);
    inputEl.addEventListener('keydown', (event) => {
        if (!dropdownEl.classList.contains('open')) {
            if (event.key === 'ArrowDown') { event.preventDefault(); render(); }
            return;
        }
        const items = Array.from(dropdownEl.querySelectorAll('.report-tech-item'));
        if (!items.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); focusedIndex = Math.min(focusedIndex + 1, items.length - 1); render(); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); focusedIndex = Math.max(focusedIndex - 1, 0); render(); return; }
        if (event.key === 'Enter') { event.preventDefault(); if (focusedIndex >= 0 && items[focusedIndex]) pick(items[focusedIndex].dataset.value || ''); return; }
        if (event.key === 'Escape') close();
    });
}

wireSinglePicker(
    editReportUnitInput,
    editReportUnitDropdown,
    () => Object.keys(getUnitModelOptions()).sort((a, b) => a.localeCompare(b)),
    (unit) => {
        // A model from the previous unit can't stay under the new one.
        if (editReportModelInput && !findCatalogModel(unit, editReportModelInput.value)) {
            editReportModelInput.value = '';
        }
    }
);

wireSinglePicker(
    editReportModelInput,
    editReportModelDropdown,
    () => {
        const unit = findCatalogUnit(editReportUnitInput ? editReportUnitInput.value : '');
        return unit ? [...(getUnitModelOptions()[unit] || [])].sort((a, b) => a.localeCompare(b)) : [];
    }
);

// ── Serial No. — the Add Printer rules: exactly 10 characters, unique system-wide ──
const EDIT_REPORT_SERIAL_LENGTH = 10;
let editReportSerialTimer = null;
let editReportSerialToken = 0;

function setEditReportSerialState(state, message) {
    if (!editReportSerialInput) return;
    const existingNote = editReportSerialInput.parentElement.querySelector('.serial-check-note');
    if (existingNote) existingNote.remove();
    editReportSerialInput.classList.remove('edit-input-invalid');
    editReportSerialInput.setCustomValidity(state === 'taken' || state === 'invalid' ? message : '');
    if (state === 'ok' || !message) return;

    const note = document.createElement('span');
    note.className = 'serial-check-note ' + (state === 'checking' ? 'edit-field-checking' : 'edit-field-error');
    note.textContent = message;
    editReportSerialInput.insertAdjacentElement('afterend', note);
    if (state !== 'checking') editReportSerialInput.classList.add('edit-input-invalid');
}

async function checkEditReportSerial() {
    if (!editReportSerialInput) return;
    const serialNo = editReportSerialInput.value.trim();
    // The entry's own serial is always fine, even a legacy 9-character one.
    if (!serialNo || serialNo.toLowerCase() === editReportOriginalIdentity.serialNo.toLowerCase()) {
        editReportSerialToken += 1;
        setEditReportSerialState('ok');
        return;
    }
    if (serialNo.length !== EDIT_REPORT_SERIAL_LENGTH) {
        editReportSerialToken += 1;
        setEditReportSerialState('invalid', `Serial number must be exactly ${EDIT_REPORT_SERIAL_LENGTH} characters — this one has ${serialNo.length}.`);
        return;
    }

    const token = ++editReportSerialToken;
    setEditReportSerialState('checking', 'Checking serial number…');
    try {
        const params = new URLSearchParams({ serialNo });
        if (editReportContext && editReportContext.record) params.set('excludeId', String(editReportContext.record.id));
        const res = await fetch(`/user_account/check-serial?${params.toString()}`, { headers: { Accept: 'application/json' } });
        const payload = await res.json();
        if (token !== editReportSerialToken) return;
        if (payload && payload.invalidLength) {
            setEditReportSerialState('invalid', payload.message);
        } else if (payload && payload.available === false) {
            const owner = payload.clientName ? ` It belongs to ${payload.clientName}.` : '';
            setEditReportSerialState('taken', (payload.message || 'This serial number is already assigned to another client and cannot be used again.') + owner);
        } else {
            setEditReportSerialState('ok');
        }
    } catch {
        // Network hiccup — the server checks again on save.
        if (token === editReportSerialToken) setEditReportSerialState('ok');
    }
}

if (editReportSerialInput) {
    editReportSerialInput.addEventListener('input', () => {
        editReportSerialInput.setCustomValidity('');
        clearTimeout(editReportSerialTimer);
        editReportSerialTimer = setTimeout(checkEditReportSerial, 400);
    });
    editReportSerialInput.addEventListener('blur', () => {
        clearTimeout(editReportSerialTimer);
        checkEditReportSerial();
    });
}

// Stored dates are dd/mm/yyyy (legacy rows sometimes mm/dd/yyyy) or ISO; the
// date input needs ISO. Blank when the value can't be read as a real day.
function storedDateToIso(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!slash) return '';
    const build = (year, month, day) => {
        const d = new Date(year, month - 1, day);
        if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    return build(year, second, first) || build(year, first, second);
}

// Ref no must be globally unique — same algorithm as the serial-number
// check on the new-machine form. Excludes the report currently being
// edited (by machine + target) so re-saving its own unchanged ref no
// isn't flagged as colliding with itself.
const editReportRefNoInput = document.getElementById('edit-report-refno');
wireRefNoLiveCheck(editReportRefNoInput, {
    getExcludeParams: () => {
        if (!editReportContext || !editReportContext.record || !editReportContext.target) return null;
        const target = editReportContext.target;
        return {
            excludeMachineId: editReportContext.record.id,
            excludeTargetType: target.type,
            excludeUpdateIndex: target.type === 'update' ? target.updateIndex : undefined
        };
    }
});

function fieldWrap(id) {
    // The label + input pair are the label element and the element with the id.
    const input = document.getElementById(id);
    if (!input) return null;
    const label = document.querySelector('label[for="' + id + '"]');
    return { input, label, container: input.closest('.edit-form-grid') ? null : input.parentElement };
}

function toggleReportOnlyFields(show) {
    ['edit-report-refno'].forEach(id => {
        const pair = fieldWrap(id);
        if (!pair) return;
        pair.input.style.display = show ? '' : 'none';
        if (pair.label) pair.label.style.display = show ? '' : 'none';
    });
}

function closeEditReportModal() {
    if (editReportPopup) editReportPopup.style.display = 'none';
    editReportContext = null;
    closeEditReportTechDropdown();
    clearTimeout(editReportSerialTimer);
    editReportSerialToken += 1;
}

if (editServiceReportBtn) {
    editServiceReportBtn.addEventListener('click', () => {
        const ctx = window.currentServiceReportContext;
        if (!ctx || !ctx.record || !ctx.row) {
            showToast('Open a history entry first, then click Edit.', 'info');
            return;
        }

        const { machineIndex, rowIndex, record, row, report } = ctx;
        const detail = row.detail || {};

        // Install rows have machineIndex === -1 in buildHistoryRows.
        // Everything else is an updates[] entry, whether it has a report or not.
        const target = row.isOriginal
            ? { type: 'install' }
            : { type: 'update', updateIndex: row.machineIndex };

        editReportContext = { machineIndex, rowIndex, record, target };

        editReportOriginalIdentity = {
            unit: String(record.unit || '').trim(),
            model: String(record.model || '').trim(),
            serialNo: String(record.serialNo || '').trim(),
            date: storedDateToIso(row.date)
        };
        if (editReportUnitInput) { editReportUnitInput.value = editReportOriginalIdentity.unit; editReportUnitInput.setCustomValidity(''); }
        if (editReportModelInput) { editReportModelInput.value = editReportOriginalIdentity.model; editReportModelInput.setCustomValidity(''); }
        if (editReportSerialInput) {
            editReportSerialInput.value = editReportOriginalIdentity.serialNo;
            setEditReportSerialState('ok');
        }
        if (editReportDateInput) {
            editReportDateInput.value = editReportOriginalIdentity.date;
            guardFutureDate(editReportDateInput, 'Date');
        }

        const submittedBy = (report && report.submittedBy)
            || detail.submittedBy
            || row.tech
            || '';
        // Legacy rows hold "Submitter, Tech, …" here; the first name is the
        // submitter, as in the Service Report view.
        editReportSubmitter = splitTechnicianNames(submittedBy)[0] || '';
        const submittedByDisplay = document.getElementById('edit-report-submitted-by-display');
        if (submittedByDisplay) submittedByDisplay.textContent = submittedBy || '—';

        const runningHoursEl   = document.getElementById('edit-report-running-hours');
        const statusEl         = document.getElementById('edit-report-status');
        const smrDateEl        = document.getElementById('edit-report-smr-date');
        const refNoEl          = document.getElementById('edit-report-refno');
        const techniciansEl    = document.getElementById('edit-report-technicians');

        // Always-editable fields — come from the update entry (or the install snapshot).
        const hasRunningHours = detail.runningHours !== null && detail.runningHours !== undefined && String(detail.runningHours).trim() !== '';
        if (runningHoursEl)   runningHoursEl.value   = hasRunningHours ? detail.runningHours : '';
        // After the value: an exempt unit shows a locked 0 whatever the
        // legacy entry recorded.
        applyRunningHoursLock(runningHoursEl, isRecordRunningHoursExempt(record));
        if (statusEl)         statusEl.value         = detail.status || '';
        if (smrDateEl) {
            // Blank where the record predates the SMR field — correcting it here
            // is how an old entry gets the date it was always missing.
            smrDateEl.value = String(detail.smrDate || '').trim();
            guardFutureDate(smrDateEl, 'SMR date');
        }

        // Technicians: prefer the report's list when there is one, else the update's own list.
        const technicianSource = (report && Array.isArray(report.technicians) && report.technicians.length)
            ? report.technicians
            : (Array.isArray(detail.technicians) ? detail.technicians : []);
        const sourceNames = technicianSource.map(normalizeTechnicianName).filter(Boolean);
        editReportListedSubmitter = sourceNames.find(isEditReportSubmitter) || '';
        editReportOriginalTechnicians = sourceNames.filter(name => !isEditReportSubmitter(name));
        if (techniciansEl) {
            techniciansEl.value = editReportOriginalTechnicians.join(', ');
            techniciansEl.setCustomValidity('');
        }

        // Report-only fields — hide entirely for ad-hoc rows without a report.
        const hasReport = !!report;
        toggleReportOnlyFields(hasReport);
        if (refNoEl) {
            refNoEl.value = hasReport ? (report.refNo || '') : '';
            // Clear any leftover invalid state from a previous time this
            // modal was opened — this field's value just changed underneath
            // the debounce, so its old checking state no longer applies.
            refNoEl.classList.remove('edit-input-invalid');
            refNoEl.setCustomValidity('');
            const staleNote = refNoEl.parentElement ? refNoEl.parentElement.querySelector('.refno-check-note') : null;
            if (staleNote) staleNote.remove();
        }

        if (historyReportPopup) historyReportPopup.style.display = 'none';
        if (editReportPopup) editReportPopup.style.display = 'grid';
    });
}

if (closeEditReportPopupBtn) closeEditReportPopupBtn.addEventListener('click', closeEditReportModal);
if (cancelEditReportBtn) cancelEditReportBtn.addEventListener('click', closeEditReportModal);

if (editReportPopup) {
    editReportPopup.addEventListener('click', (e) => {
        if (e.target === editReportPopup) closeEditReportModal();
    });
}

if (editReportForm) {
    editReportForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!editReportContext) {
            showToast('Edit session expired. Please reopen the report.', 'warning');
            return;
        }

        const { machineIndex, rowIndex, record, target } = editReportContext;
        const ctx = window.currentServiceReportContext || {};
        const hasReport = !!ctx.report;

        const runningHoursEl   = document.getElementById('edit-report-running-hours');
        const statusEl         = document.getElementById('edit-report-status');
        const smrDateEl        = document.getElementById('edit-report-smr-date');
        const refNoEl          = document.getElementById('edit-report-refno');
        const techniciansEl    = document.getElementById('edit-report-technicians');

        if (smrDateEl && smrDateEl.validationMessage) {
            smrDateEl.reportValidity();
            smrDateEl.focus();
            return;
        }

        // Unit / model: from the list only, checked when either one changed.
        const unitValue = editReportUnitInput ? editReportUnitInput.value.trim() : '';
        const modelValue = editReportModelInput ? editReportModelInput.value.trim() : '';
        const unitChanged = unitValue.toUpperCase() !== editReportOriginalIdentity.unit.toUpperCase();
        const modelChanged = modelValue.toUpperCase() !== editReportOriginalIdentity.model.toUpperCase();
        let catalogUnit = null;
        let catalogModel = null;
        if (unitChanged || modelChanged) {
            catalogUnit = findCatalogUnit(unitValue);
            if (!catalogUnit) {
                editReportUnitInput.setCustomValidity('Select a unit from the list.');
                editReportUnitInput.reportValidity();
                editReportUnitInput.focus();
                return;
            }
            catalogModel = findCatalogModel(catalogUnit, modelValue);
            if (!catalogModel) {
                editReportModelInput.setCustomValidity(`Select a model from the list for ${catalogUnit}.`);
                editReportModelInput.reportValidity();
                editReportModelInput.focus();
                return;
            }
        }

        const serialValue = editReportSerialInput ? editReportSerialInput.value.trim() : '';
        const serialChanged = serialValue.toLowerCase() !== editReportOriginalIdentity.serialNo.toLowerCase();
        if (serialChanged) {
            if (!serialValue) {
                editReportSerialInput.setCustomValidity('Serial number is required.');
            } else {
                clearTimeout(editReportSerialTimer);
                await checkEditReportSerial();
            }
            if (editReportSerialInput.validationMessage) {
                editReportSerialInput.reportValidity();
                editReportSerialInput.focus();
                return;
            }
        }

        const dateValue = editReportDateInput ? editReportDateInput.value : '';
        const dateChanged = Boolean(dateValue) && dateValue !== editReportOriginalIdentity.date;
        if (editReportDateInput && editReportDateInput.validationMessage) {
            editReportDateInput.reportValidity();
            editReportDateInput.focus();
            return;
        }

        // `description` is deliberately absent: the notes field was removed from
        // the activity forms, and sending the key would blank the service notes
        // still held against older machines.
        const technicianParse = parseEditReportTechnicians(techniciansEl ? techniciansEl.value : '');
        if (techniciansEl && technicianParse.invalid.length) {
            techniciansEl.setCustomValidity(`Select technicians from the list only. Not recognised: ${technicianParse.invalid.join(', ')}`);
            techniciansEl.reportValidity();
            techniciansEl.focus();
            return;
        }
        if (techniciansEl && technicianParse.hasSubmitter) {
            techniciansEl.setCustomValidity(`${editReportSubmitter} submitted this entry and is already credited under Submitted By — remove them from Technicians.`);
            techniciansEl.reportValidity();
            techniciansEl.focus();
            return;
        }

        const patch = {
            status: statusEl ? statusEl.value : '',
            smrDate: smrDateEl ? smrDateEl.value : '',
            technicians: editReportListedSubmitter
                ? [editReportListedSubmitter, ...technicianParse.picked]
                : technicianParse.picked
        };
        if (catalogUnit && catalogModel) {
            patch.unit = catalogUnit;
            patch.model = catalogModel;
        }
        if (serialChanged) patch.serialNo = serialValue;
        if (dateChanged) patch.date = dateValue;

        if (isRecordRunningHoursExempt(record)) {
            // Rewrites the entry to 0 — the locked field is disabled, so its
            // value never reaches here on its own.
            patch.runningHours = 0;
        } else {
            const runningHoursRaw = runningHoursEl ? runningHoursEl.value.trim() : '';
            if (runningHoursRaw !== '') {
                patch.runningHours = Number(runningHoursRaw);
            }
        }

        if (hasReport) {
            if (refNoEl && refNoEl.validationMessage) {
                refNoEl.reportValidity();
                refNoEl.focus();
                return;
            }

            patch.refNo = refNoEl ? refNoEl.value.trim() : '';
        }

        const submitBtn = editReportForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const response = await fetch(`/client/${encodeURIComponent(CLIENT_ID)}/machines/report/edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    machineId: record.id,
                    target,
                    patch
                })
            });

            const payload = await readJsonResponse(response);
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Failed to save the correction.');
            }

            Object.assign(record, payload.machine);
            record._runningSeconds = (Number(payload.machine.runningHours) || 0) * 3600;

            allMachines = orderMachinesNewestFirst(allMachines);
            filteredMachines = orderMachinesNewestFirst(filteredMachines);
            renderTable(filteredMachines);

            if (detailPopup.style.display !== 'none' && currentDetailIndex === machineIndex) {
                showDetails(machineIndex);
            }

            closeEditReportModal();
            showToast('History entry corrected successfully.', 'success');

            // Reopen the view so the admin sees the corrected values immediately.
            openHistoryReportModal(machineIndex, rowIndex);
        } catch (error) {
            showToast(error.message || 'Failed to save the correction.', 'warning');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}
