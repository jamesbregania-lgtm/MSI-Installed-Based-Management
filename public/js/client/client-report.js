function getTechnicianPool() {
    const currentName = normalizeTechnicianName(
        typeof CURRENT_USER_FULLNAME !== 'undefined' ? CURRENT_USER_FULLNAME : ''
    ).toLowerCase();

    return (Array.isArray(TEAM_MEMBERS) ? TEAM_MEMBERS : [])
        .map(normalizeTechnicianName)
        .filter(Boolean)
        .filter((name, index, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === index)
        .filter(name => name.toLowerCase() !== currentName)
        .sort((a, b) => a.localeCompare(b));
}

function getTechnicianDraftState(rawValue) {
    const text = String(rawValue || '');
    const endsWithSeparator = /,\s*$/.test(text);
    const segments = text.split(',');
    const normalized = segments.map(normalizeTechnicianName);

    let searchTerm = '';
    if (!endsWithSeparator && normalized.length > 0) {
        searchTerm = normalized[normalized.length - 1] || '';
    }

    const committed = endsWithSeparator
        ? normalized.filter(Boolean)
        : normalized.slice(0, -1).filter(Boolean);

    return { committed, searchTerm };
}

function parseTechnicianInput(rawValue) {
    const chunks = String(rawValue || '')
        .split(',')
        .map(normalizeTechnicianName)
        .filter(Boolean);

    const poolSet = new Set(getTechnicianPool().map(name => name.toLowerCase()));
    const picked = [];
    const invalid = [];

    chunks.forEach(name => {
        const key = name.toLowerCase();
        if (!poolSet.has(key)) {
            invalid.push(name);
            return;
        }
        if (!picked.some(existing => existing.toLowerCase() === key)) {
            picked.push(name);
        }
    });

    return { picked, invalid };
}

//  Service report fields of the activity modal
//
// The report used to be a second step after the update form. It is now part
// of the same modal: Ref No., Other Technicians and one image of the paper
// report. Problem / Action / Recommendation were dropped — the image carries
// them, and no KPI used them.

const reportTechniciansInput = document.getElementById('report-technicians');
const reportTechDropdown = document.getElementById('report-tech-dropdown');
let reportTechFocusedIndex = -1;

// Ref no must be globally unique — same algorithm as the serial-number
// check on the new-machine form. This is always a brand-new report, so
// there's nothing of its own to exclude from the collision check.
const reportRefNoInput = document.getElementById('report-refno');
const reportRefNoCheck = wireRefNoLiveCheck(reportRefNoInput);

const editPhotoPicker = createPhotoPicker(document.getElementById('edit-photo-picker'));

function closeReportTechDropdown() {
    if (!reportTechDropdown) return;
    reportTechDropdown.classList.remove('open');
    reportTechFocusedIndex = -1;
}

function insertSelectedTechnician(name) {
    if (!reportTechniciansInput) return;

    const draft = getTechnicianDraftState(reportTechniciansInput.value);
    const merged = [...draft.committed, name]
        .filter(Boolean)
        .filter((value, idx, arr) => arr.findIndex(v => v.toLowerCase() === value.toLowerCase()) === idx);

    reportTechniciansInput.value = merged.length ? `${merged.join(', ')}, ` : '';
    closeReportTechDropdown();
    reportTechniciansInput.focus();
}

function renderReportTechDropdown() {
    if (!reportTechniciansInput || !reportTechDropdown) return;

    const draft = getTechnicianDraftState(reportTechniciansInput.value);
    const committedSet = new Set(draft.committed.map(name => name.toLowerCase()));

    let options = getTechnicianPool().filter(name => !committedSet.has(name.toLowerCase()));

    if (draft.searchTerm) {
        const q = draft.searchTerm.toLowerCase();
        options = options.filter(name => name.toLowerCase().includes(q));
    }

    if (!options.length) {
        reportTechDropdown.innerHTML = '<li class="report-tech-empty">No active users found.</li>';
        reportTechDropdown.classList.add('open');
        return;
    }

    reportTechDropdown.innerHTML = options.map((name, index) =>
        `<li class="report-tech-item${index === reportTechFocusedIndex ? ' is-active' : ''}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</li>`
    ).join('');

    reportTechDropdown.classList.add('open');

    reportTechDropdown.querySelectorAll('.report-tech-item').forEach(item => {
        item.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const selected = item.dataset.name || '';
            insertSelectedTechnician(selected);
        });
    });
}

/** Empties the report fields; called whenever the activity modal opens. */
function resetActivityReportFields() {
    if (reportRefNoInput) {
        reportRefNoInput.value = '';
        reportRefNoInput.classList.remove('edit-input-invalid');
        reportRefNoInput.setCustomValidity('');
        const staleNote = reportRefNoInput.parentElement
            ? reportRefNoInput.parentElement.querySelector('.refno-check-note')
            : null;
        if (staleNote) staleNote.remove();
    }
    if (reportTechniciansInput) {
        reportTechniciansInput.value = '';
        reportTechniciansInput.setCustomValidity('');
    }
    editPhotoPicker.reset();
    closeReportTechDropdown();
}

/** Whether anything was typed or attached in the report fields. */
function hasActivityReportInput() {
    return Boolean(
        (reportRefNoInput && reportRefNoInput.value.trim()) ||
        (reportTechniciansInput && reportTechniciansInput.value.trim()) ||
        editPhotoPicker.hasInput()
    );
}

/**
 * Reads the report fields, or returns null after pointing at what's wrong.
 * The ref no's "required" and duplicate checks go through the form's own
 * validation before this runs.
 */
function readActivityReport() {
    const technicianParse = parseTechnicianInput(reportTechniciansInput ? reportTechniciansInput.value : '');
    if (technicianParse.invalid.length) {
        if (reportTechniciansInput) {
            reportTechniciansInput.setCustomValidity('Select technicians from the list only.');
            if (typeof reportTechniciansInput.reportValidity === 'function') {
                reportTechniciansInput.reportValidity();
            }
            reportTechniciansInput.focus();
        }
        return null;
    }
    if (reportTechniciansInput) reportTechniciansInput.setCustomValidity('');

    if (!editPhotoPicker.validate()) return null;

    return {
        refNo: reportRefNoInput ? reportRefNoInput.value.trim() : '',
        additionalTechnicians: technicianParse.picked,
        photoId: editPhotoPicker.getPhotoId()
    };
}

/**
 * Saves the activity modal: the update entry, its report and its image in
 * one request. Returns true once saved.
 */
async function saveActivityUpdate(record, index, pendingMachineUpdate, reportFields) {
    const reporterName = normalizeTechnicianName(
        typeof CURRENT_USER_FULLNAME !== 'undefined' ? CURRENT_USER_FULLNAME : 'Unknown User'
    );
    const submittedBy = splitTechnicianNames(reporterName)[0] || reporterName || 'Unknown User';
    const technicians = [submittedBy, ...reportFields.additionalTechnicians]
        .filter(Boolean)
        .filter((name, idx, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === idx);

    const todayStr = getTodayDateString();

    const nextUpdateIndex = Array.isArray(record.updates) ? record.updates.length : 0;

    const reportEntry = {
        date: todayStr,
        submittedBy,
        technicians,
        refNo: reportFields.refNo,
        updateIndex: nextUpdateIndex
    };

    const updateEntry = {
        date: todayStr,
        activityType: pendingMachineUpdate.activityType,
        submittedBy: typeof CURRENT_USER_FULLNAME !== 'undefined' ? CURRENT_USER_FULLNAME : 'Unknown User',
        status: pendingMachineUpdate.status,
        runningHours: pendingMachineUpdate.runningHours,
        smrDate: pendingMachineUpdate.smrDate,
        maintenanceUpdated: pendingMachineUpdate.maintenanceUpdated,
        maintenanceServiceDate: pendingMachineUpdate.maintenanceServiceDate,
        partsUpdated: pendingMachineUpdate.partsUpdated,
        ...(pendingMachineUpdate.activityType === ACTIVITY_TYPES.REPAIR
            ? { partsUsed: pendingMachineUpdate.partsUsed || [] }
            : {}),
        partServiceDates: pendingMachineUpdate.partServiceDates,
        partServiceHours: pendingMachineUpdate.partServiceHours
    };

    const response = await fetch(`/client/${encodeURIComponent(CLIENT_ID)}/machines/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            serialNo:      record.serialNo,
            model:         record.model,
            dateInstalled: record.dateInstalled,
            runningHours:   pendingMachineUpdate.runningHours,
            status:         pendingMachineUpdate.status,
            smrDate:        pendingMachineUpdate.smrDate,
            activityType:   pendingMachineUpdate.activityType,
            maintenanceServiceDate: pendingMachineUpdate.maintenanceServiceDate,
            partServiceDates: pendingMachineUpdate.partServiceDates,
            partServiceHours: pendingMachineUpdate.partServiceHours,
            partServiceAdjustments: pendingMachineUpdate.partServiceAdjustments,
            newUpdate:      updateEntry,
            report:         reportEntry,
            updateIndex:    nextUpdateIndex,
            photoId:        reportFields.photoId
        })
    });

    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Failed to save the update.');
    }

    Object.assign(record, payload.machine);
    record._runningSeconds = (Number(payload.machine.runningHours) || 0) * 3600;

    allMachines = orderMachinesNewestFirst(allMachines);
    filteredMachines = orderMachinesNewestFirst(filteredMachines);
    currentPage = 1;
    renderTable(filteredMachines);

    if (detailPopup.style.display !== 'none' && currentDetailIndex === index) {
        showDetails(index);
    }
    return true;
}

if (reportTechniciansInput) {
    reportTechniciansInput.addEventListener('input', () => {
        reportTechFocusedIndex = -1;
        renderReportTechDropdown();
        reportTechniciansInput.setCustomValidity('');
    });

    reportTechniciansInput.addEventListener('focus', () => {
        renderReportTechDropdown();
    });

    reportTechniciansInput.addEventListener('keydown', (event) => {
        if (!reportTechDropdown || !reportTechDropdown.classList.contains('open')) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                renderReportTechDropdown();
            }
            return;
        }

        const items = Array.from(reportTechDropdown.querySelectorAll('.report-tech-item'));
        if (!items.length) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            reportTechFocusedIndex = Math.min(reportTechFocusedIndex + 1, items.length - 1);
            renderReportTechDropdown();
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            reportTechFocusedIndex = Math.max(reportTechFocusedIndex - 1, 0);
            renderReportTechDropdown();
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            if (reportTechFocusedIndex >= 0 && items[reportTechFocusedIndex]) {
                const selected = items[reportTechFocusedIndex].dataset.name || '';
                insertSelectedTechnician(selected);
            }
            return;
        }

        if (event.key === 'Escape') {
            closeReportTechDropdown();
        }
    });
}

document.addEventListener('click', (event) => {
    if (!reportTechniciansInput || !reportTechDropdown) return;
    const wrap = reportTechniciansInput.closest('.report-tech-wrap');
    if (!wrap || !wrap.contains(event.target)) {
        closeReportTechDropdown();
    }
});
