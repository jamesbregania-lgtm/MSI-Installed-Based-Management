// ── Form Submission Handlers ──

const saveEditBtn = document.getElementById('saveEditBtn');
let editSaveInFlight = false;

// Activity modal submission (PM, Parts Replacement, Repair, Inspection,
// Pull Out): the update, its service report and its image save together.
editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (editSaveInFlight) return;
    syncEditDraftFromInputs();

    const index = parseInt(editForm.dataset.index, 10);
    const record = allMachines[index];
    if (!record) return;

    // Repair: Parts Used is required (the server refuses it too).
    checkRepairPartsRequired();

    // Use native HTML5 validation UI
    if (editForm && typeof editForm.reportValidity === 'function') {
        if (!editForm.reportValidity()) return;
    }

    // PM/Parts exist to *change* machine state, so blocking a no-op save
    // makes sense for them — and PM always has a "changed" signal anyway,
    // since its maintenance-due date defaults to today when left blank.
    // Repair (and Inspection and Pull Out, which share its flow) has no such
    // signal: it's unscheduled, so its due dates never move, and its whole
    // purpose is the service report, not whatever running hours/status
    // happen to already match the saved record. Never block it here.
    if (
        editDraft.activityType !== ACTIVITY_TYPES.REPAIR &&
        editDraft.activityType !== ACTIVITY_TYPES.INSPECTION &&
        editDraft.activityType !== ACTIVITY_TYPES.PULL_OUT &&
        !hasEditDraftChanges()
    ) {
        showToast('No changes to save.', 'info');
        return;
    }

    const reportFields = readActivityReport();
    if (!reportFields) return;

    const pendingMachineUpdate = buildPendingMachineUpdate(record, index);
    if (!pendingMachineUpdate) {
        showToast('Unable to prepare the update.', 'warning');
        return;
    }

    editSaveInFlight = true;
    if (saveEditBtn) saveEditBtn.disabled = true;
    try {
        await saveActivityUpdate(record, index, pendingMachineUpdate, reportFields);
        await closeEditModal(true);
        showToast('Update saved successfully.', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to save the update.', 'warning');
    } finally {
        editSaveInFlight = false;
        if (saveEditBtn) saveEditBtn.disabled = false;
    }
});

// Ad-hoc form submission (Cannibalize / Pull Out / Parts Return)
if (adHocForm) {
    adHocForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const index = parseInt(adHocForm.dataset.index, 10);
        const record = allMachines[index];
        if (!record) return;

        const activityType = adHocForm.dataset.activityType || ACTIVITY_TYPES.CANNIBALIZE;
        const adHocSmrInput = document.getElementById('ad-hoc-smr-date');
        const adHocSmrDate = adHocSmrInput ? adHocSmrInput.value : '';
        const technicianInput = adHocTechniciansInput ? adHocTechniciansInput.value : '';
        const technicianParse = parseTechnicianInput(technicianInput);
        if (technicianParse.invalid.length) {
            if (adHocTechniciansInput) {
                adHocTechniciansInput.setCustomValidity('Select technicians from the list only.');
                if (typeof adHocTechniciansInput.reportValidity === 'function') adHocTechniciansInput.reportValidity();
                adHocTechniciansInput.focus();
            }
            return;
        }
        if (adHocTechniciansInput) adHocTechniciansInput.setCustomValidity('');

        const pickedTechnicians = technicianParse.picked;

        if (adHocForm && typeof adHocForm.reportValidity === 'function') {
            if (!adHocForm.reportValidity()) return;
        }

        if (!adHocPhotoPicker.validate()) return;

        const partsList = document.getElementById('ad-hoc-parts-list');
        syncAdHocSelectedParts();
        const selectedParts = adHocDraft && Array.isArray(adHocDraft.selectedParts)
            ? adHocDraft.selectedParts.slice()
            : (partsList
                ? Array.from(partsList.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(input => decodeURIComponent(input.dataset.name || ''))
                    .filter(Boolean)
                : []);

        if (!Array.isArray(record.updates)) record.updates = [];

        let finalActivityType = activityType;
        if (activityType === ACTIVITY_TYPES.CANNIBALIZE) {
            const previousParts = getLatestCannibalizedParts(record);
            const returnedSome = previousParts.some(p => !selectedParts.includes(p));
            if (returnedSome) finalActivityType = ACTIVITY_TYPES.PARTS_RETURN;
        }

        const todayStr = getTodayDateString();
        const runningHours = coerceRunningHours(record.runningHours, record.unit, record.model);
        const status = record.status || '';

        const updateEntry = {
            date: todayStr,
            activityType: finalActivityType,
            submittedBy: typeof CURRENT_USER_FULLNAME !== 'undefined' ? CURRENT_USER_FULLNAME : 'Unknown User',
            status,
            runningHours,
            smrDate: adHocSmrDate,
            maintenanceUpdated: false,
            maintenanceServiceDate: String(record.maintenanceServiceDate || ''),
            partsUpdated: (finalActivityType === ACTIVITY_TYPES.CANNIBALIZE || finalActivityType === ACTIVITY_TYPES.PARTS_RETURN) ? selectedParts : [],
            partServiceDates: clonePartMap(record.partServiceDates),
            partServiceHours: clonePartMap(record.partServiceHours),
            technicians: pickedTechnicians
        };

        try {
            const response = await fetch(`/client/${encodeURIComponent(CLIENT_ID)}/machines/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    serialNo: record.serialNo,
                    model: record.model,
                    dateInstalled: record.dateInstalled,
                    runningHours,
                    status,
                    smrDate: adHocSmrDate,
                    activityType: finalActivityType,
                    maintenanceServiceDate: String(record.maintenanceServiceDate || ''),
                    partServiceDates: clonePartMap(record.partServiceDates),
                    partServiceHours: clonePartMap(record.partServiceHours),
                    partServiceAdjustments: clonePartMap(record.partServiceAdjustments),
                    newUpdate: updateEntry,
                    photoId: adHocPhotoPicker.getPhotoId()
                })
            });

            const payload = await readJsonResponse(response);
            if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to save updates.');

            Object.assign(record, payload.machine);
            record._runningSeconds = (Number(payload.machine.runningHours) || 0) * 3600;

            allMachines = orderMachinesNewestFirst(allMachines);
            filteredMachines = orderMachinesNewestFirst(filteredMachines);
            currentPage = 1;
            renderTable(filteredMachines);

            if (detailPopup.style.display !== 'none' && currentDetailIndex === index) {
                showDetails(index);
            }

            closeAdHocModal();
            showToast('Record updated successfully.', 'success');
        } catch (error) {
            showToast(error.message || 'Failed to save updates.', 'warning');
        }
    });
}
