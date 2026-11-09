// ── Edit Modal: Draft State & Open/Close ──

const editPopup = document.getElementById('editPopup');
const closeEditPopup = document.getElementById('closeEditPopup');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const editForm = document.getElementById('editForm');
let editDraft = null;
window.pendingMachineUpdate = null;

function buildEditDraft(record, index) {
    return {
        index,
        activityType: ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE,
        // LASER, DOD and 5800 have no hour meter — the field is locked at 0
        // rather than left blank for the technician to fill in.
        runningHours: isRecordRunningHoursExempt(record) ? '0' : '',
        status: '',
        smrDate: '',
        maintenanceServiceDate: record.maintenanceServiceDate || '',
        partServiceDates: clonePartMap(record.partServiceDates),
        partServiceHours: clonePartMap(record.partServiceHours),
        adjustedPartDates: clonePartMap(record.partServiceAdjustments),
        // Repair only: parts picked from the admin Parts list.
        partsUsed: []
    };
}

function clearEditDraft() { editDraft = null; }

function syncEditDraftFromInputs() {
    if (!editDraft) return;
    const draftRecord = allMachines[editDraft.index];
    editDraft.runningHours = isRecordRunningHoursExempt(draftRecord)
        ? '0'
        : document.getElementById('edit-runningHours').value;
    editDraft.status = document.getElementById('edit-status').value || '';
    const smrEl = document.getElementById('edit-smr-date');
    if (smrEl) editDraft.smrDate = smrEl.value || '';
    const activityRadio = document.querySelector('input[name="edit-activity-type"]:checked');
    if (activityRadio) editDraft.activityType = activityRadio.value;
}

function hasEditDraftChanges() {
    if (!editDraft) return false;
    const record = allMachines[editDraft.index];
    if (!record) return false;
    // An exempt unit's field is locked at 0, so it is never something the
    // technician changed — comparing it would flag a legacy LASER/DOD row
    // that still carries hours as "unsaved" the moment the modal opens.
    const exempt = isRecordRunningHoursExempt(record);
    const liveHours = formatRunningHoursOnly(record._runningSeconds);
    const draftHours = String(editDraft.runningHours || '0');
    return (
        (!exempt && draftHours !== liveHours) ||
        (editDraft.status || '') !== (record.status || '') ||
        (editDraft.smrDate || '') !== '' ||
        (editDraft.partsUsed || []).length > 0 ||
        (editDraft.maintenanceServiceDate || '') !== (record.maintenanceServiceDate || '') ||
        JSON.stringify(clonePartMap(editDraft.partServiceDates)) !== JSON.stringify(clonePartMap(record.partServiceDates)) ||
        JSON.stringify(clonePartMap(editDraft.partServiceHours)) !== JSON.stringify(clonePartMap(record.partServiceHours))
    );
}

async function closeEditModal(discardChanges = false) {
    if (!discardChanges && (hasEditDraftChanges() || hasActivityReportInput())) {
        const shouldDiscard = await showConfirmDialog({
            title: 'Discard Changes?',
            message: 'You have unsaved updates in this form. Discard them?',
            confirmText: 'Discard', cancelText: 'Keep Editing', tone: 'warning'
        });
        if (!shouldDiscard) return;
    }
    editPopup.style.display = 'none';
    clearEditDraft();
    window.pendingMachineUpdate = null;
    resetActivityReportFields();
}

function buildPendingMachineUpdate(record, index) {
    if (!record || !editDraft) return null;
    const activityType = editDraft.activityType || ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE;
    const isScheduled = SCHEDULED_ACTIVITY_TYPES.has(activityType);
    const newRunningHours = isRecordRunningHoursExempt(record)
        ? 0
        : (parseInt(document.getElementById('edit-runningHours').value, 10) || 0);
    const newStatus = document.getElementById('edit-status').value;
    const smrEl = document.getElementById('edit-smr-date');
    const newSmrDate = smrEl ? smrEl.value : '';
    const previousMaintenanceServiceDate = String(record.maintenanceServiceDate || '');
    const previousPartServiceDates = clonePartMap(record.partServiceDates);
    const todayStr = getTodayDateString();
    const nextMaintenanceServiceDate = isScheduled
        ? (activityType === ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE
            ? String(editDraft.maintenanceServiceDate || todayStr)
            : String(editDraft.maintenanceServiceDate || ''))
        : previousMaintenanceServiceDate;
    const nextPartServiceDates = isScheduled ? clonePartMap(editDraft.partServiceDates) : clonePartMap(record.partServiceDates);
    const nextPartServiceAdjustments = isScheduled ? clonePartMap(editDraft.adjustedPartDates) : clonePartMap(record.partServiceAdjustments);
    const rawChangedParts = isScheduled ? getChangedPartNames(previousPartServiceDates, nextPartServiceDates) : [];
    const adjustedPartSet = new Set(
        editDraft.adjustedPartDates ? Object.keys(editDraft.adjustedPartDates).map(n => n.toLowerCase()) : []
    );
    const changedParts = rawChangedParts.filter(n => !adjustedPartSet.has(String(n || '').toLowerCase()));
    return {
        recordIndex: index, activityType,
        runningHours: newRunningHours, status: newStatus,
        smrDate: newSmrDate,
        maintenanceUpdated: isScheduled && previousMaintenanceServiceDate !== nextMaintenanceServiceDate,
        maintenanceServiceDate: nextMaintenanceServiceDate,
        partsUpdated: changedParts,
        partsUsed: activityType === ACTIVITY_TYPES.REPAIR ? (editDraft.partsUsed || []).slice() : [],
        partServiceDates: nextPartServiceDates,
        partServiceHours: isScheduled && editDraft ? clonePartMap(editDraft.partServiceHours) : clonePartMap(record.partServiceHours),
        partServiceAdjustments: nextPartServiceAdjustments
    };
}

window.openEditModal = function (index, activityType) {
    const record = allMachines[index];
    if (!record) return;
    if (typeof record._runningSeconds === 'undefined') record._runningSeconds = parseRunningHoursToSeconds(record.runningHours);
    document.getElementById('edit-unit-display').textContent = record.unit || '\u2014';
    document.getElementById('edit-model-display').textContent = record.model || '\u2014';
    document.getElementById('edit-serial-display').textContent = record.serialNo || '\u2014';
    const activityDisplay = document.getElementById('edit-activity-display');
    if (activityDisplay) activityDisplay.textContent = activityType || '\u2014';
    const titleEl = document.getElementById('edit-modal-title');
    if (titleEl) titleEl.textContent = `Update Machine Record — ${activityType || 'Update'}`;
    editDraft = buildEditDraft(record, index);
    if (activityType) editDraft.activityType = activityType;
    const smrEl = document.getElementById('edit-smr-date');
    if (smrEl) {
        smrEl.required = true;
        smrEl.value = editDraft.smrDate;
        guardFutureDate(smrEl, 'SMR date');
    }
    const partsSearchInput = document.getElementById('partsSearch');
    if (partsSearchInput) partsSearchInput.value = '';
    const runningHoursInput = document.getElementById('edit-runningHours');
    runningHoursInput.value = editDraft.runningHours;
    // After the value, so the lock's own "0" is what stays in the box.
    applyRunningHoursLock(runningHoursInput, isRecordRunningHoursExempt(record));
    document.getElementById('edit-status').value = editDraft.status;
    resetActivityReportFields();
    renderActivityTypeSelector(editDraft.activityType);
    syncEditDraftFromInputs();
    const { unitKey } = getPartsCatalogLocation(record);
    updatePartsPanel(record, unitKey);
    resetRepairPartsInput();
    editForm.dataset.index = index;
    editPopup.style.display = 'grid';
};

function renderActivityTypeSelector(selectedType) {
    const container = document.getElementById('edit-activity-type-group');
    if (!container) return;
    const types = [
        { value: ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE, label: 'Preventive Maintenance', scheduled: true },
        { value: ACTIVITY_TYPES.PARTS_REPLACEMENT, label: 'Parts Replacement', scheduled: true },
        { value: ACTIVITY_TYPES.REPAIR, label: 'Repair', scheduled: false },
        { value: ACTIVITY_TYPES.PULL_OUT, label: 'Pull Out', scheduled: false },
        { value: ACTIVITY_TYPES.CANNIBALIZE, label: 'Cannibalize', scheduled: false }
    ];
    container.innerHTML = types.map(t => `
        <label class="activity-type-option${t.scheduled ? '' : ' activity-type-adhoc'}">
            <input type="radio" name="edit-activity-type" value="${escapeHtml(t.value)}"${t.value === selectedType ? ' checked' : ''}>
            <span class="activity-type-label">${escapeHtml(t.label)}</span>
            ${!t.scheduled ? '<span class="activity-type-tag">Ad-hoc</span>' : ''}
        </label>
    `).join('');
    function markSmrDateRequired() {
        const smr = document.getElementById('edit-smr-date');
        if (smr) smr.required = true;
    }
    container.querySelectorAll('input[name="edit-activity-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            syncEditDraftFromInputs();
            const record = allMachines[editDraft ? editDraft.index : -1];
            if (!record) return;
            const { unitKey, modelKey } = getPartsCatalogLocation(record);
            updatePartsPanel(record, unitKey, modelKey);
            markSmrDateRequired();
        });
    });
    markSmrDateRequired();
}

// ── Edit modal close/sync event listeners ──
closeEditPopup.addEventListener('click', async () => { await closeEditModal(); });
if (cancelEditBtn) cancelEditBtn.addEventListener('click', async () => { await closeEditModal(); });
editPopup.addEventListener('click', (e) => { if (e.target === editPopup) closeEditModal(); });
document.getElementById('edit-runningHours').addEventListener('input', syncEditDraftFromInputs);
document.getElementById('edit-status').addEventListener('change', syncEditDraftFromInputs);
const editSmrDateInput = document.getElementById('edit-smr-date');
if (editSmrDateInput) editSmrDateInput.addEventListener('change', syncEditDraftFromInputs);
