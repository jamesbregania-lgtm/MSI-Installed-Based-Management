// ── Ad-Hoc Modal: Cannibalize, Pull Out, Parts Return ──

const adHocPopup = document.getElementById('adHocPopup');
const closeAdHocPopupBtn = document.getElementById('closeAdHocPopup');
const cancelAdHocBtn = document.getElementById('cancelAdHocBtn');
const adHocForm = document.getElementById('adHocForm');
const adHocTechniciansInput = document.getElementById('ad-hoc-technicians');
const adHocTechDropdown = document.getElementById('ad-hoc-tech-dropdown');
let adHocTechFocusedIndex = -1;
let adHocDraft = null;
const adHocPhotoPicker = createPhotoPicker(document.getElementById('ad-hoc-photo-picker'));

function buildAdHocDraft(record, index, activityType) {
    return {
        index,
        activityType: activityType || ACTIVITY_TYPES.CANNIBALIZE,
        selectedParts: []
    };
}

function getLatestCannibalizedParts(record) {
    const updates = Array.isArray(record && record.updates) ? record.updates : [];
    for (let i = updates.length - 1; i >= 0; i -= 1) {
        const update = updates[i] || {};
        const type = String(update.activityType || '').trim();
        if (type === ACTIVITY_TYPES.CANNIBALIZE || type === ACTIVITY_TYPES.PARTS_RETURN) {
            return Array.isArray(update.partsUpdated) ? [...update.partsUpdated] : [];
        }
    }
    return [];
}

// ── Technician dropdown for ad-hoc modal ──

function closeAdHocTechDropdown() {
    if (!adHocTechDropdown) return;
    adHocTechDropdown.classList.remove('open');
    adHocTechFocusedIndex = -1;
}

function insertAdHocTechnician(name) {
    if (!adHocTechniciansInput) return;
    const draft = getTechnicianDraftState(adHocTechniciansInput.value);
    const merged = [...draft.committed, name]
        .filter(Boolean)
        .filter((v, idx, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === idx);
    adHocTechniciansInput.value = merged.length ? `${merged.join(', ')}, ` : '';
    closeAdHocTechDropdown();
    adHocTechniciansInput.focus();
}

function renderAdHocTechDropdown() {
    if (!adHocTechniciansInput || !adHocTechDropdown) return;
    const draft = getTechnicianDraftState(adHocTechniciansInput.value);
    const committedSet = new Set(draft.committed.map(n => n.toLowerCase()));
    let options = getTechnicianPool().filter(n => !committedSet.has(n.toLowerCase()));
    if (draft.searchTerm) {
        const q = draft.searchTerm.toLowerCase();
        options = options.filter(n => n.toLowerCase().includes(q));
    }
    if (!options.length) {
        adHocTechDropdown.innerHTML = '<li class="report-tech-empty">No active users found.</li>';
        adHocTechDropdown.classList.add('open');
        return;
    }
    adHocTechDropdown.innerHTML = options.map((name, i) =>
        `<li class="report-tech-item${i === adHocTechFocusedIndex ? ' is-active' : ''}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</li>`
    ).join('');
    adHocTechDropdown.classList.add('open');
    adHocTechDropdown.querySelectorAll('.report-tech-item').forEach(item => {
        item.addEventListener('mousedown', (event) => {
            event.preventDefault();
            insertAdHocTechnician(item.dataset.name || '');
        });
    });
}

function closeAdHocModal() {
    if (!adHocPopup) return;
    adHocPopup.style.display = 'none';
    adHocDraft = null;
    adHocPhotoPicker.reset();
    closeAdHocTechDropdown();
}

// ── Ad-hoc parts list rendering ──

function syncAdHocSelectedParts() {
    if (!adHocDraft) return;
    const partsList = document.getElementById('ad-hoc-parts-list');
    if (!partsList) { adHocDraft.selectedParts = []; return; }
    adHocDraft.selectedParts = Array.from(partsList.querySelectorAll('.ad-hoc-part-item'))
        .filter(item => { const cb = item.querySelector('input[type="checkbox"]'); return cb && cb.checked; })
        .map(item => {
            const cb = item.querySelector('input[type="checkbox"]');
            const partName = decodeURIComponent(cb.dataset.name || '');
            // Technicians no longer enter a destination. A part recorded earlier with
            // one keeps it, so it still matches its old entry when it is returned.
            const savedSerial = decodeURIComponent(cb.dataset.serial || '');
            return savedSerial ? `${partName} [${savedSerial}]` : partName;
        }).filter(Boolean);
}

function renderAdHocPartsList(record, activityType, selectedParts) {
    selectedParts = selectedParts || [];
    const partsSection = document.getElementById('ad-hoc-parts-section');
    const partsList = document.getElementById('ad-hoc-parts-list');
    if (!partsSection || !partsList) return;
    const isAdHocPartsActivity = activityType === ACTIVITY_TYPES.CANNIBALIZE || activityType === ACTIVITY_TYPES.PARTS_RETURN;
    partsSection.style.display = isAdHocPartsActivity ? '' : 'none';
    if (!isAdHocPartsActivity) return;

    const selectedSerialMap = new Map();
    (Array.isArray(selectedParts) ? selectedParts : []).forEach(name => {
        let n = String(name || '').trim();
        const m = n.match(/(.*)\s+\[(.*?)\]$/);
        if (m) { selectedSerialMap.set(m[1].trim().toLowerCase(), m[2].trim()); }
        else { selectedSerialMap.set(n.toLowerCase(), ''); }
    });
    const selectedSet = new Set(selectedSerialMap.keys());

    const { unitKey } = getPartsCatalogLocation(record);
    const catalog = window.PARTS_CATALOG || (typeof PARTS_CATALOG !== 'undefined' ? PARTS_CATALOG : {});
    const unitMap = catalog[unitKey] || {};
    let catalogParts = [];
    Object.values(unitMap).forEach(sp => { catalogParts = catalogParts.concat(sp); });

    // Only parts from the admin Parts list are offered. A part this unit already
    // has cannibalized stays listed (even if the admin has since removed it) so
    // it can still be returned.
    const dynamicPartNames = new Set();
    selectedSet.forEach(n => dynamicPartNames.add(n.toLowerCase()));
    catalogParts.forEach(cp => { if (cp.name) dynamicPartNames.delete(cp.name.toLowerCase()); });

    let parts = [...catalogParts, ...Array.from(dynamicPartNames).map(n => ({ name: n.toUpperCase() }))];
    const adHocSearchInput = document.getElementById('ad-hoc-parts-search');
    if (adHocSearchInput && adHocSearchInput.value) {
        const q = adHocSearchInput.value.toLowerCase();
        parts = parts.filter(p => p.name && p.name.toLowerCase().includes(q));
    }

    const selectedArr = parts.filter(p => p.name && selectedSet.has(p.name.trim().toLowerCase()));
    const unselectedArr = parts.filter(p => p.name && !selectedSet.has(p.name.trim().toLowerCase()));
    let finalParts = selectedArr;
    if (finalParts.length < 10) finalParts = finalParts.concat(unselectedArr.slice(0, 10 - finalParts.length));

    if (!finalParts.length) {
        partsList.innerHTML = '<div class="ad-hoc-parts-empty">No parts matching your search or listed for this model.</div>';
        return;
    }

    const initiallyCannibalizedSet = new Set(getLatestCannibalizedParts(record).map(name => {
        let n = String(name || '').trim();
        const m = n.match(/(.*)\s+\[(.*?)\]$/);
        return (m ? m[1] : n).trim().toLowerCase();
    }));

    partsList.innerHTML = finalParts.map(part => {
        const encodedName = encodeURIComponent(part.name || '');
        const normName = String(part.name || '').trim().toLowerCase();
        const isSelected = selectedSet.has(normName);
        const existingSerial = selectedSerialMap.get(normName) || '';
        const isInitiallyCannibalized = initiallyCannibalizedSet.has(normName);
        let isDisabled = false;
        if (activityType === ACTIVITY_TYPES.CANNIBALIZE) isDisabled = isInitiallyCannibalized;
        else if (activityType === ACTIVITY_TYPES.PARTS_RETURN) isDisabled = !isInitiallyCannibalized;
        return `
            <div class="ad-hoc-part-item${isSelected ? ' is-selected' : ''}" style="${isDisabled ? 'opacity:0.5; pointer-events:none;' : ''}">
                <label class="ad-hoc-part-item-label" style="cursor: ${isDisabled ? 'not-allowed' : 'pointer'};">
                    <input type="checkbox" data-name="${encodedName}" data-serial="${encodeURIComponent(existingSerial)}"${isSelected ? ' checked' : ''}${isDisabled ? ' disabled' : ''}>
                    <span class="ad-hoc-part-name">${escapeHtml(part.name || '')}</span>
                </label>
            </div>
        `;
    }).join('');

    partsList.querySelectorAll('.ad-hoc-part-item').forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (!checkbox) return;
        const syncItemState = () => {
            item.classList.toggle('is-selected', checkbox.checked);
        };
        checkbox.addEventListener('change', () => {
            syncItemState();
            syncAdHocSelectedParts();
        });
        syncItemState();
    });
}

function syncAdHocModeToggle(activityType) {
    const labelEl = document.getElementById('ad-hoc-parts-section-label');
    const iconEl = document.getElementById('ad-hoc-mode-icon');
    const toggleBtn = document.getElementById('ad-hoc-mode-toggle');
    if (!labelEl) return;
    if (activityType === ACTIVITY_TYPES.CANNIBALIZE) {
        labelEl.textContent = 'Parts to Cannibalize';
        if (iconEl) { iconEl.setAttribute('fill', '#e67e22'); iconEl.querySelector('path').setAttribute('d', 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z'); }
        if (toggleBtn) toggleBtn.title = 'Click to switch to Parts Return mode';
    } else if (activityType === ACTIVITY_TYPES.PARTS_RETURN) {
        labelEl.textContent = 'Parts to Return';
        if (iconEl) { iconEl.setAttribute('fill', '#2563eb'); iconEl.querySelector('path').setAttribute('d', 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z'); }
        if (toggleBtn) toggleBtn.title = 'Click to switch to Cannibalize mode';
    }
}

// ── Open ad-hoc modal ──

window.openAdHocModal = function (index, activityType) {
    const record = allMachines[index];
    if (!record) return;
    if (typeof record._runningSeconds === 'undefined') record._runningSeconds = parseRunningHoursToSeconds(record.runningHours);
    const unitEl = document.getElementById('ad-hoc-unit-display');
    const modelEl = document.getElementById('ad-hoc-model-display');
    const serialEl = document.getElementById('ad-hoc-serial-display');
    if (unitEl) unitEl.textContent = record.unit || '\u2014';
    if (modelEl) modelEl.textContent = record.model || '\u2014';
    if (serialEl) serialEl.textContent = record.serialNo || '\u2014';
    const titleEl = document.getElementById('ad-hoc-modal-title');
    if (titleEl) {
        if (activityType === ACTIVITY_TYPES.CANNIBALIZE) titleEl.textContent = 'Cannibalize Parts';
        else if (activityType === ACTIVITY_TYPES.PARTS_RETURN) titleEl.textContent = 'Return Parts';
        else titleEl.textContent = 'Pull Out Unit';
    }
    const searchInput = document.getElementById('ad-hoc-parts-search');
    if (searchInput) searchInput.value = '';
    const globalSerialInput = document.getElementById('ad-hoc-serial-no');
    const globalSerialLabel = document.getElementById('ad-hoc-serial-no-label');
    if (globalSerialInput && globalSerialLabel) {
        if (activityType === ACTIVITY_TYPES.CANNIBALIZE) { globalSerialInput.style.display = 'block'; globalSerialLabel.style.display = 'block'; globalSerialInput.value = ''; }
        else { globalSerialInput.style.display = 'none'; globalSerialLabel.style.display = 'none'; globalSerialInput.value = ''; }
    }
    adHocDraft = buildAdHocDraft(record, index, activityType);
    if (adHocDraft) {
        adHocDraft.selectedParts = (activityType === ACTIVITY_TYPES.CANNIBALIZE || activityType === ACTIVITY_TYPES.PARTS_RETURN)
            ? getLatestCannibalizedParts(record) : [];
    }
    if (adHocTechniciansInput) adHocTechniciansInput.value = '';
    adHocPhotoPicker.reset();
    const adHocSmrInput = document.getElementById('ad-hoc-smr-date');
    if (adHocSmrInput) {
        adHocSmrInput.value = '';
        guardFutureDate(adHocSmrInput, 'SMR date');
    }
    closeAdHocTechDropdown();
    renderAdHocPartsList(record, activityType, adHocDraft ? adHocDraft.selectedParts : []);
    if (adHocForm) { adHocForm.dataset.index = index; adHocForm.dataset.activityType = activityType || ACTIVITY_TYPES.CANNIBALIZE; }
    syncAdHocModeToggle(activityType);
    if (adHocPopup) adHocPopup.style.display = 'grid';
};

// ── Ad-hoc modal event listeners ──

if (closeAdHocPopupBtn) closeAdHocPopupBtn.addEventListener('click', closeAdHocModal);
if (cancelAdHocBtn) cancelAdHocBtn.addEventListener('click', closeAdHocModal);
if (adHocPopup) adHocPopup.addEventListener('click', (e) => { if (e.target === adHocPopup) closeAdHocModal(); });

// Mode toggle
const adHocModeToggleBtn = document.getElementById('ad-hoc-mode-toggle');
if (adHocModeToggleBtn) {
    adHocModeToggleBtn.addEventListener('click', () => {
        if (!adHocForm) return;
        const current = adHocForm.dataset.activityType;
        if (current !== ACTIVITY_TYPES.CANNIBALIZE && current !== ACTIVITY_TYPES.PARTS_RETURN) return;
        const next = current === ACTIVITY_TYPES.CANNIBALIZE ? ACTIVITY_TYPES.PARTS_RETURN : ACTIVITY_TYPES.CANNIBALIZE;
        adHocForm.dataset.activityType = next;
        if (adHocDraft) adHocDraft.activityType = next;
        const t = document.getElementById('ad-hoc-modal-title');
        if (t) t.textContent = next === ACTIVITY_TYPES.CANNIBALIZE ? 'Cannibalize Parts' : 'Return Parts';
        syncAdHocModeToggle(next);
        const idx = parseInt(adHocForm.dataset.index, 10);
        const rec = allMachines[idx];
        if (rec) renderAdHocPartsList(rec, next, adHocDraft ? adHocDraft.selectedParts : []);
    });
}

// Technician input listeners
if (adHocTechniciansInput) {
    adHocTechniciansInput.addEventListener('input', () => { adHocTechFocusedIndex = -1; renderAdHocTechDropdown(); adHocTechniciansInput.setCustomValidity(''); });
    adHocTechniciansInput.addEventListener('focus', () => { renderAdHocTechDropdown(); });
    adHocTechniciansInput.addEventListener('keydown', (event) => {
        if (!adHocTechDropdown || !adHocTechDropdown.classList.contains('open')) {
            if (event.key === 'ArrowDown') { event.preventDefault(); renderAdHocTechDropdown(); }
            return;
        }
        const items = Array.from(adHocTechDropdown.querySelectorAll('.report-tech-item'));
        if (!items.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); adHocTechFocusedIndex = Math.min(adHocTechFocusedIndex + 1, items.length - 1); renderAdHocTechDropdown(); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); adHocTechFocusedIndex = Math.max(adHocTechFocusedIndex - 1, 0); renderAdHocTechDropdown(); return; }
        if (event.key === 'Enter') { event.preventDefault(); if (adHocTechFocusedIndex >= 0 && items[adHocTechFocusedIndex]) insertAdHocTechnician(items[adHocTechFocusedIndex].dataset.name || ''); return; }
        if (event.key === 'Escape') closeAdHocTechDropdown();
    });
}

document.addEventListener('click', (event) => {
    if (!adHocTechniciansInput || !adHocTechDropdown) return;
    if (!event.target.closest('#adHocForm .report-tech-wrap')) closeAdHocTechDropdown();
});

// Parts search
const adHocPartsSearchInput = document.getElementById('ad-hoc-parts-search');
if (adHocPartsSearchInput) {
    adHocPartsSearchInput.addEventListener('input', () => {
        if (!adHocDraft) return;
        const record = allMachines[parseInt(adHocForm.dataset.index, 10)];
        if (record) renderAdHocPartsList(record, adHocDraft.activityType, adHocDraft.selectedParts);
    });
}
