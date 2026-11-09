// ── Parts Panel: Rendering and Marking ──

function updatePartsPanel(record, unitKey) {
    const usedSection = document.getElementById('edit-parts-used-section');
    if (usedSection) {
        usedSection.style.display = editDraft && editDraft.activityType === ACTIVITY_TYPES.REPAIR ? '' : 'none';
    }
    const partsSection = document.getElementById('edit-parts-section');
    const isScheduled = editDraft && (editDraft.activityType === ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE || editDraft.activityType === ACTIVITY_TYPES.PARTS_REPLACEMENT);
    if (!partsSection) {
        if (isScheduled) renderPartsList(unitKey, null, record._runningSeconds, record, editDraft);
        return;
    }
    if (!isScheduled) { partsSection.style.display = 'none'; return; }
    partsSection.style.display = '';
    renderPartsList(unitKey, null, record._runningSeconds, record, editDraft);
}

function renderPartsList(unitKey, modelKey, runningSeconds, record, draftState) {
    const partsBody = document.getElementById('parts-tbody');
    if (!unitKey) {
        partsBody.innerHTML = `<tr><td colspan="2" style="text-align:center;color:var(--muted);padding:12px;">No parts data for this machine.</td></tr>`;
        return;
    }
    const catalog = window.PARTS_CATALOG || (typeof PARTS_CATALOG !== 'undefined' ? PARTS_CATALOG : {});
    const unitMap = catalog[unitKey] || {};
    let catalogParts = [];
    Object.values(unitMap).forEach(sp => { catalogParts = catalogParts.concat(sp); });

    const dynamicPartNames = new Set();
    const mapToCheck = draftState ? draftState.partServiceDates : (record.partServiceDates || {});
    if (mapToCheck) {
        Object.keys(mapToCheck).forEach(name => {
            if (!catalogParts.some(cp => cp.name.toLowerCase() === name.toLowerCase())) dynamicPartNames.add(name);
        });
    }

    let parts = [...catalogParts, ...Array.from(dynamicPartNames).map(name => ({ name }))];
    const partsSearchInput = document.getElementById('partsSearch');
    if (partsSearchInput && partsSearchInput.value) {
        const q = partsSearchInput.value.toLowerCase();
        parts = parts.filter(p => p.name && p.name.toLowerCase().includes(q));
    }
    parts = parts.slice(0, 10);

    if (!parts.length) {
        partsBody.innerHTML = `<tr><td colspan="2" style="text-align:center;color:var(--muted);padding:12px;">No parts matching your search or listed for this model.</td></tr>`;
        return;
    }
    const recordIndex = findMachineIndexByRecord(record);
    const statusRecord = draftState
        ? { ...record, maintenanceServiceDate: draftState.maintenanceServiceDate || '', partServiceDates: clonePartMap(draftState.partServiceDates), partServiceHours: clonePartMap(draftState.partServiceHours) }
        : record;

    const isMaintenance = draftState && draftState.activityType === ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE;
    const isPartsReplacement = draftState && draftState.activityType === ACTIVITY_TYPES.PARTS_REPLACEMENT;

    const maintenanceStatus = getMaintenanceStatus(record.dateInstalled, runningSeconds, statusRecord, 30);
    let maintenanceRow = '';

    if (isMaintenance) {
        let maintenanceBadge = '', maintenanceRowClass = '';
        if (maintenanceStatus.isOverdue) {
            maintenanceBadge = `<button type="button" class="parts-badge parts-badge-overdue parts-badge-action" title="Mark maintenance as completed today" onclick="markMaintenanceAsServiced(${recordIndex})">OVERDUE</button>`;
            maintenanceRowClass = 'parts-row-overdue';
        } else if (maintenanceStatus.isDueSoon) {
            maintenanceBadge = `<button type="button" class="parts-badge parts-badge-soon parts-badge-action" title="Mark maintenance as completed today" onclick="markMaintenanceAsServiced(${recordIndex})">\u26A0 DUE SOON</button>`;
            maintenanceRowClass = 'parts-row-soon';
        } else if (maintenanceStatus.label !== '\u2014') {
            maintenanceBadge = `<button type="button" class="parts-badge parts-badge-ok parts-badge-action" title="Mark maintenance as completed today" onclick="markMaintenanceAsServiced(${recordIndex})">MARK DONE</button>`;
        } else {
            maintenanceBadge = `<span class="parts-badge parts-badge-ok">NO SCHEDULE</span>`;
        }
        const maintenanceLabel = maintenanceStatus.label !== '\u2014' ? maintenanceStatus.label : 'No schedule set';
        maintenanceRow = `<tr class="${maintenanceRowClass}">
            <td class="parts-cell-part">MAINTENANCE</td>
            <td class="parts-cell-status"><div class="parts-status-wrapper">${maintenanceBadge}<span class="parts-expiry-label">${escapeHtml(maintenanceLabel)}</span></div></td>
        </tr>`;
    }

    // Parts have no due date, so a row only says whether the part was replaced
    // on this visit, judged the same way the save picks partsUpdated
    // (getChangedPartNames): its replacement date moved from the saved record's.
    let partRows = '';
    if (isPartsReplacement) {
        const savedDates = (record && record.partServiceDates) || {};
        const draftDates = (draftState && draftState.partServiceDates) || {};
        partRows = parts.map(p => {
            const replaced = String(draftDates[p.name] || '') !== String(savedDates[p.name] || '');
            const statusBadge = replaced
                ? `<span class="parts-badge parts-badge-ok">\u2713 REPLACED</span>`
                : `<button type="button" class="parts-badge parts-badge-ok parts-badge-action" title="Mark this part as replaced today" onclick="markPartAsServiced(${recordIndex}, '${encodeURIComponent(p.name)}')">REPLACE</button>`;
            return `<tr><td class="parts-cell-part">${escapeHtml(p.name)}</td><td class="parts-cell-status"><div class="parts-status-wrapper">${statusBadge}</div></td></tr>`;
        }).join('');
    }

    const alertRows = `${maintenanceRow}${partRows}`;
    partsBody.innerHTML = alertRows || `<tr><td colspan="2" style="text-align:center;color:var(--muted);padding:14px;font-size:13px;">No due soon or overdue items.</td></tr>`;
}

// ── Mark as serviced handlers ──

window.markMaintenanceAsServiced = async function (index) {
    const record = allMachines[index];
    if (!record || !editDraft || editDraft.index !== index) return;
    const shouldApply = await showConfirmDialog({
        title: 'Confirm Maintenance Completion', message: 'Mark preventive maintenance as completed today?',
        confirmText: 'Apply Update', cancelText: 'Cancel', tone: 'warning'
    });
    if (!shouldApply) return;
    editDraft.maintenanceServiceDate = getTodayDateString();
    const { unitKey, modelKey } = getPartsCatalogLocation(record);
    updatePartsPanel(record, unitKey, modelKey);
};

window.markPartAsServiced = async function (index, encodedPartName) {
    const record = allMachines[index];
    if (!record || !editDraft || editDraft.index !== index) return;
    const partName = decodeURIComponent(encodedPartName || '');
    if (!partName) return;
    const shouldApply = await showConfirmDialog({
        title: 'Confirm Part Replacement', message: `Mark "${partName}" as replaced today?`,
        confirmText: 'Apply Update', cancelText: 'Cancel', tone: 'warning'
    });
    if (!shouldApply) return;
    if (!editDraft.partServiceDates || typeof editDraft.partServiceDates !== 'object') editDraft.partServiceDates = {};
    if (!editDraft.partServiceHours || typeof editDraft.partServiceHours !== 'object') editDraft.partServiceHours = {};
    syncEditDraftFromInputs();
    editDraft.partServiceDates[partName] = getTodayDateString();
    // Same rule as above: no hours to carry forward on LASER / DOD / 5800.
    editDraft.partServiceHours[partName] = isRecordRunningHoursExempt(record)
        ? 0
        : (Number(editDraft.runningHours) || ((record._runningSeconds || 0) / 3600));
    if (editDraft.adjustedPartDates && editDraft.adjustedPartDates[partName]) delete editDraft.adjustedPartDates[partName];
    const { unitKey, modelKey } = getPartsCatalogLocation(record);
    updatePartsPanel(record, unitKey, modelKey);
};

const partsSearchInput = document.getElementById('partsSearch');
if (partsSearchInput) {
    partsSearchInput.addEventListener('input', () => {
        const index = parseInt(editForm.dataset.index, 10);
        const record = allMachines[index];
        if (!record) return;
        const { unitKey, modelKey } = getPartsCatalogLocation(record);
        renderPartsList(unitKey, modelKey, record._runningSeconds, record, editDraft);
    });
}

// ── Repair: Parts Used ──
// Technicians search the admin-managed Parts list and pick from the
// suggestions. The box only searches: typing never creates a part, and a part
// outside the list cannot be added (the server rejects it too).

const repairPartsInput = document.getElementById('repair-parts-search');
const repairPartsDropdown = document.getElementById('repair-parts-dropdown');
const repairPartsChips = document.getElementById('repair-parts-chips');
let repairPartsFocusedIndex = -1;

function getRepairPartOptions() {
    const record = editDraft ? allMachines[editDraft.index] : null;
    if (!record) return [];
    const { unitKey } = getPartsCatalogLocation(record);
    const catalog = window.PARTS_CATALOG || (typeof PARTS_CATALOG !== 'undefined' ? PARTS_CATALOG : {});
    const names = [];
    [unitKey, ''].forEach(key => {
        Object.values(catalog[key] || {}).forEach(list => list.forEach(part => { if (part.name) names.push(part.name); }));
    });
    return names.filter((name, i, arr) => arr.findIndex(n => n.toLowerCase() === name.toLowerCase()) === i);
}

function closeRepairPartsDropdown() {
    if (repairPartsDropdown) repairPartsDropdown.classList.remove('open');
    repairPartsFocusedIndex = -1;
}

function renderRepairPartsChips() {
    if (!repairPartsChips) return;
    const used = (editDraft && editDraft.partsUsed) || [];
    repairPartsChips.innerHTML = used.map((name, i) =>
        '<span class="repair-part-chip">' + escapeHtml(name) +
        '<button type="button" class="repair-part-chip-x" data-index="' + i + '" aria-label="Remove part">\u00d7</button></span>'
    ).join('');
    repairPartsChips.querySelectorAll('.repair-part-chip-x').forEach(btn => {
        btn.addEventListener('click', () => {
            editDraft.partsUsed.splice(Number(btn.dataset.index), 1);
            renderRepairPartsChips();
        });
    });
}

function addRepairPart(name) {
    if (!editDraft || !name) return;
    if (!editDraft.partsUsed.some(n => n.toLowerCase() === name.toLowerCase())) editDraft.partsUsed.push(name);
    repairPartsInput.value = '';
    closeRepairPartsDropdown();
    renderRepairPartsChips();
    clearRepairPartsError();
}

function renderRepairPartsDropdown() {
    if (!repairPartsInput || !repairPartsDropdown) return;
    const q = repairPartsInput.value.trim().toLowerCase();
    if (!q) { closeRepairPartsDropdown(); return; }
    const taken = new Set(((editDraft && editDraft.partsUsed) || []).map(n => n.toLowerCase()));
    const options = getRepairPartOptions()
        .filter(name => !taken.has(name.toLowerCase()) && name.toLowerCase().includes(q))
        .slice(0, 15);
    if (!options.length) {
        repairPartsDropdown.innerHTML = '<li class="report-tech-empty">No matching part in the Parts list.</li>';
        repairPartsDropdown.classList.add('open');
        return;
    }
    repairPartsDropdown.innerHTML = options.map((name, i) =>
        '<li class="report-tech-item' + (i === repairPartsFocusedIndex ? ' is-active' : '') + '" data-name="' + escapeHtml(name) + '">' + escapeHtml(name) + '</li>'
    ).join('');
    repairPartsDropdown.classList.add('open');
    repairPartsDropdown.querySelectorAll('.report-tech-item').forEach(item => {
        item.addEventListener('mousedown', (event) => {
            event.preventDefault();
            addRepairPart(item.dataset.name || '');
        });
    });
}

function resetRepairPartsInput() {
    if (repairPartsInput) repairPartsInput.value = '';
    closeRepairPartsDropdown();
    renderRepairPartsChips();
    clearRepairPartsError();
}

// Parts Used is required on a Repair: at least one part must be picked. The
// error sits on the search box so the browser's own message points at it.
function checkRepairPartsRequired() {
    if (!repairPartsInput) return true;
    const isRepair = editDraft && editDraft.activityType === ACTIVITY_TYPES.REPAIR;
    const missing = isRepair && !((editDraft.partsUsed || []).length);
    repairPartsInput.setCustomValidity(missing ? 'Pick at least one part used in this repair.' : '');
    repairPartsInput.classList.toggle('edit-input-invalid', Boolean(missing));
    return !missing;
}

function clearRepairPartsError() {
    if (!repairPartsInput) return;
    repairPartsInput.setCustomValidity('');
    repairPartsInput.classList.remove('edit-input-invalid');
}

if (repairPartsInput) {
    repairPartsInput.addEventListener('input', () => { repairPartsFocusedIndex = -1; renderRepairPartsDropdown(); });
    repairPartsInput.addEventListener('focus', renderRepairPartsDropdown);
    repairPartsInput.addEventListener('blur', () => { closeRepairPartsDropdown(); repairPartsInput.value = ''; });
    repairPartsInput.addEventListener('keydown', (event) => {
        const items = repairPartsDropdown ? Array.from(repairPartsDropdown.querySelectorAll('.report-tech-item')) : [];
        if (event.key === 'Enter') {
            // Never submits the form: Enter only picks a suggestion.
            event.preventDefault();
            const pick = items[repairPartsFocusedIndex >= 0 ? repairPartsFocusedIndex : 0];
            if (pick) addRepairPart(pick.dataset.name || '');
            return;
        }
        if (!items.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); repairPartsFocusedIndex = Math.min(repairPartsFocusedIndex + 1, items.length - 1); renderRepairPartsDropdown(); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); repairPartsFocusedIndex = Math.max(repairPartsFocusedIndex - 1, 0); renderRepairPartsDropdown(); }
        else if (event.key === 'Escape') closeRepairPartsDropdown();
    });
}
