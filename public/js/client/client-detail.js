//  Detail popup 

const detailPopup = document.getElementById('detailPopup');
const detailList = document.getElementById('detailList');
const closePopup = document.getElementById('closePopup');

window.showDetails = function (index) {
    const record = allMachines[index];
    if (!record) return;

    if (typeof record._runningSeconds === 'undefined') {
        record._runningSeconds = parseRunningHoursToSeconds(record.runningHours);
    }

    const submittedByText = formatTechnicianInline(record.submittedBy || 'Unknown User');

    // Pass full record so anchor date is resolved correctly
    const nextMaintenance = calculateNextMaintenance(record.dateInstalled, record._runningSeconds, record);
    const maintenanceStatus = getMaintenanceStatus(record.dateInstalled, record._runningSeconds, record, 30);
    const { unitKey } = getPartsCatalogLocation(record);
    const catalog = window.PARTS_CATALOG || (typeof PARTS_CATALOG !== 'undefined' ? PARTS_CATALOG : {});
    const unitMap = catalog[unitKey] || {};
    let partsForModel = [];
    Object.values(unitMap).forEach(seriesParts => {
        partsForModel = partsForModel.concat(seriesParts);
    });
    const detailParts = [];

    if (maintenanceStatus.label !== '\u2014') {
        detailParts.push({
            name: 'MAINTENANCE',
            date: maintenanceStatus.label
        });
    }

    // Only maintenance runs on a clock; parts have no due date to show.
    partsForModel.forEach(part => {
        detailParts.push({
            name: part.name,
            date: '\u2014'
        });
    });

    const detailListItems = detailParts.length
        ? detailParts.map(item => `<li class="detail-parts-item">
                <span class="detail-parts-name">${escapeHtml(item.name)}</span>
                <span class="detail-parts-date">${escapeHtml(item.date)}</span>
            </li>`).join('')
        : `<div class="detail-parts-empty">No parts data found for this model.</div>`;

    const statusClass = (record.status || '').toLowerCase() === 'active' ? 'status-active'
        : (record.status || '').toLowerCase() === 'decommissioned' ? 'status-decommissioned'
            : 'status-inactive';

    detailList.innerHTML = `
        <div class="detail-identity">
            <div class="detail-identity-cell">
                <div class="detail-identity-label">Unit</div>
                <div class="detail-identity-value">${escapeHtml(record.unit || '\u2014')}</div>
            </div>
            <div class="detail-identity-cell">
                <div class="detail-identity-label">Model</div>
                <div class="detail-identity-value">${escapeHtml(record.model || '\u2014')}</div>
            </div>
            <div class="detail-identity-cell">
                <div class="detail-identity-label">Serial No.</div>
                <div class="detail-identity-value">${escapeHtml(record.serialNo || '\u2014')}</div>
            </div>
        </div>
        <div class="detail-field">
            <span class="detail-field-label">Installed</span>
            <span class="detail-field-value">${formatDateDisplay(record.dateInstalled)}</span>
        </div>
        <div class="detail-field">
            <span class="detail-field-label">Running Hours</span>
            <span class="detail-field-value">${formatRunningHoursOnly(record._runningSeconds)} hrs</span>
        </div>
        <div class="detail-field">
            <span class="detail-field-label">Maintenance</span>
            <span class="detail-field-value${nextMaintenance === 'Overdue' ? ' overdue' : ''}" id="detail-next-maintenance">${nextMaintenance}</span>
        </div>
        <div class="detail-field">
            <span class="detail-field-label">Status</span>
            <span class="detail-field-value"><span class="status-badge ${statusClass}">${escapeHtml(record.status || '\u2014')}</span></span>
        </div>
        <div class="detail-field">
            <span class="detail-field-label">SMR Date</span>
            <span class="detail-field-value" style="${!record.smrDate ? 'color:var(--muted);font-style:italic;' : ''}">${escapeHtml(formatSmrDate(record.smrDate) || 'No SMR date')}</span>
        </div>
        <div class="detail-field" style="border-bottom:none;">
            <span class="detail-field-label">Submitted By</span>
            <span class="detail-field-value">${escapeHtml(submittedByText)}</span>
        </div>
        <div class="detail-parts-section">
            <div class="detail-parts-heading">Parts / Maintenance</div>
            <ul class="detail-parts-list">${detailListItems}</ul>
        </div>
    `;

    // Show/hide View History button
    const viewHistoryBtn = document.getElementById('viewHistoryBtn');
    viewHistoryBtn.style.display = 'inline-flex';
    viewHistoryBtn.onclick = () => openHistoryModal(index);

    closeActivityMenu();

    detailPopup.style.display = 'grid';
    currentDetailIndex = index;
};

/* ── Activity menu ──
   Rendered once from MACHINE_ACTIVITY_ACTIONS; handlers read the live
   currentDetailIndex, so adding an activity needs no changes here.
   Absent entirely for sales users (the EJS omits the wrapper). */

const activityMenuWrap = document.getElementById('activityMenuWrap');
const activityMenuBtn = document.getElementById('btnActivityMenu');
const activityMenu = document.getElementById('activityMenu');

function closeActivityMenu() {
    if (!activityMenu || !activityMenuBtn) return;
    activityMenu.hidden = true;
    activityMenuBtn.setAttribute('aria-expanded', 'false');
}

function openActivityMenu() {
    if (!activityMenu || !activityMenuBtn) return;
    activityMenu.hidden = false;
    activityMenuBtn.setAttribute('aria-expanded', 'true');
    const first = activityMenu.querySelector('.activity-menu-item');
    if (first) first.focus();
}

function renderActivityMenu() {
    if (!activityMenu) return;

    activityMenu.innerHTML = MACHINE_ACTIVITY_ACTIONS.map(action => `
        <button type="button" class="activity-menu-item" role="menuitem"
                data-activity-type="${escapeHtml(action.type)}"
                data-activity-flow="${escapeHtml(action.flow)}">
            <span class="activity-menu-icon activity-menu-icon--${escapeHtml(action.tone)}">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${action.icon}</svg>
            </span>
            <span class="activity-menu-text">
                <span class="activity-menu-label">${escapeHtml(action.label)}</span>
                <span class="activity-menu-desc">${escapeHtml(action.description)}</span>
            </span>
        </button>
    `).join('');

    activityMenu.querySelectorAll('.activity-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = currentDetailIndex;
            if (index === null || index === undefined) return;
            const type = item.dataset.activityType;
            const flow = item.dataset.activityFlow;

            closeActivityMenu();
            detailPopup.style.display = 'none';

            if (flow === 'adhoc') {
                openAdHocModal(index, type);
            } else {
                openEditModal(index, type);
            }
        });
    });
}

if (activityMenuBtn && activityMenu) {
    renderActivityMenu();

    activityMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (activityMenu.hidden) openActivityMenu();
        else closeActivityMenu();
    });

    document.addEventListener('click', (event) => {
        if (activityMenu.hidden) return;
        if (!activityMenuWrap.contains(event.target)) closeActivityMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !activityMenu.hidden) {
            closeActivityMenu();
            activityMenuBtn.focus();
        }
    });
}

closePopup.addEventListener('click', () => {
    detailPopup.style.display = 'none';
    currentDetailIndex = null;
});

detailPopup.addEventListener('click', (e) => {
    if (e.target === detailPopup) {
        detailPopup.style.display = 'none';
        currentDetailIndex = null;
    }
});

//  Unit update history builder ΓöÇ

function buildHistoryRows(record) {
    const rows = [];
    const installSnapshot = {
        runningHours: Number(record.initialRunningHours ?? record.runningHours ?? 0) || 0,
        status: String(record.initialStatus || record.status || '\u2014'),
        description: String(record.initialDescription || ''),
        // initialSmrDate, not smrDate \u2014 the latter moves with every service
        // update, so the install row must read its own snapshot.
        smrDate: String(record.initialSmrDate || ''),
        maintenanceServiceDate: String(record.initialMaintenanceServiceDate || ''),
        partServiceDates: clonePartMap(record.initialPartServiceDates || record.partServiceDates),
        partServiceHours: clonePartMap(record.initialPartServiceHours || record.partServiceHours)
    };

    // Two separate values, never merged: `date` is when the record was keyed in
    // and is also the key reports are matched by, `smrDate` is when the work was
    // done and is blank on older records. The table shows a column for each, so
    // a missing SMR date reads as missing instead of borrowing the other one.
    rows.push({
        date: record.dateInstalled,
        smrDate: String(record.initialSmrDate || '').trim(),
        tech: record.submittedBy || 'Unknown User',
        status: installSnapshot.status,
        isOriginal: true,
        machineIndex: -1,
        detail: installSnapshot
    });
    // Additional updates
    if (Array.isArray(record.updates)) {
        record.updates.forEach((u, updateIndex) => {
            const snapshot = cloneUpdateEntry(u);
            rows.push({
                date: snapshot.date || '\u2014',
                smrDate: String(snapshot.smrDate || '').trim(),
                tech: snapshot.submittedBy || 'Unknown User',
                status: snapshot.status || '\u2014',
                isOriginal: false,
                detail: snapshot,
                machineIndex: updateIndex
            });
        });
    }
    // Newest updates should appear first in Machine History Records.
    return rows.reverse();
}

function getMaintenanceAndPartUpdates(record, row, rowIndex) {
    const result = [];
    const updateDetail = row && row.detail ? row.detail : null;

    if (row && row.isOriginal) {
        return ['UNIT INSTALLATION'];
    }

    // For ad-hoc activities (Pull Out, Cannibalize), no scheduled maintenance/parts apply
    const activityType = updateDetail && updateDetail.activityType ? updateDetail.activityType : ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE;
    if (!SCHEDULED_ACTIVITY_TYPES.has(activityType)) {
        if (activityType === ACTIVITY_TYPES.PULL_OUT) {
            return [];
        }

        // Repair lists the parts used, picked from the admin Parts list.
        if (activityType === ACTIVITY_TYPES.REPAIR) {
            return updateDetail && Array.isArray(updateDetail.partsUsed)
                ? updateDetail.partsUsed.map(name => String(name || '').trim()).filter(Boolean)
                : [];
        }

        if (activityType === ACTIVITY_TYPES.CANNIBALIZE || activityType === ACTIVITY_TYPES.PARTS_RETURN) {
            let previousParts = [];
            if (typeof row.machineIndex === 'number' && row.machineIndex > 0 && Array.isArray(record.updates)) {
                for (let i = row.machineIndex - 1; i >= 0; i--) {
                    const prevUpdate = record.updates[i] || {};
                    const prevType = String(prevUpdate.activityType || '').trim();
                    if (prevType === ACTIVITY_TYPES.CANNIBALIZE || prevType === ACTIVITY_TYPES.PARTS_RETURN) {
                        previousParts = Array.isArray(prevUpdate.partsUpdated) ? prevUpdate.partsUpdated : [];
                        break;
                    }
                }
            }

            const currentParts = updateDetail && Array.isArray(updateDetail.partsUpdated)
                ? updateDetail.partsUpdated
                : [];

            const normalizeForDiff = (str) => {
                const s = String(str || '').trim();
                const m = s.match(/(.*)\s+\[(.*?)\]$/);
                return (m ? m[1].trim() : s).toLowerCase();
            };

            const prevNames = previousParts.map(normalizeForDiff);
            const currNames = currentParts.map(normalizeForDiff);

            const added = currentParts.filter((p, idx) => !prevNames.includes(currNames[idx]));
            const removed = previousParts.filter((p, idx) => !currNames.includes(prevNames[idx]));
            const changedParts = [...added, ...removed];

            const uniqueParts = changedParts
                .map(name => String(name || '').trim())
                .filter(Boolean)
                .filter((name, idx, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === idx);

            return uniqueParts;
        }

        return [];
    }

    if (updateDetail && Array.isArray(updateDetail.partsUpdated) && updateDetail.partsUpdated.length) {
        updateDetail.partsUpdated.forEach(name => result.push(String(name)));
    } else if (updateDetail && Array.isArray(record.updates) && row.machineIndex >= 0) {
        const currentUpdate = record.updates[row.machineIndex] || {};
        const previousUpdate = record.updates[row.machineIndex - 1] || {};
        const changedBySnapshot = getChangedPartNames(previousUpdate.partServiceDates, currentUpdate.partServiceDates);
        changedBySnapshot.forEach(name => result.push(String(name)));
    }

    const maintenanceUpdated = !!(updateDetail && updateDetail.maintenanceUpdated);
    if (maintenanceUpdated) {
        result.unshift('MAINTENANCE');
    }

    const unique = result
        .map(name => String(name || '').trim())
        .filter(Boolean)
        .filter((name, idx, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === idx);

    // Fallback for older records with no per-update part metadata.
    if (!unique.length && row && row.machineIndex === (Array.isArray(record.updates) ? record.updates.length - 1 : -1)) {
        const todayKey = toDateKey(row.date);
        const maintenanceDateKey = toDateKey(record.maintenanceServiceDate);

        if (todayKey && maintenanceDateKey && todayKey === maintenanceDateKey) {
            unique.push('MAINTENANCE');
        }

        const partDates = record.partServiceDates && typeof record.partServiceDates === 'object' ? record.partServiceDates : {};
        Object.keys(partDates).forEach(partName => {
            if (toDateKey(partDates[partName]) === todayKey) {
                unique.push(partName);
            }
        });
    }

    return unique;
}

function findReportForHistoryRow(record, row) {
    if (!record) return null;
    if (!Array.isArray(record.reports) || !record.reports.length) return null;

    if (row.isOriginal) {
        const installReport = record.reports.find(r => r && (r.updateIndex === null || r.updateIndex === undefined));
        if (installReport) return installReport;

        const installDateKey = toDateKey(record.dateInstalled);
        const byDate = record.reports.find(r => toDateKey(r && r.date) === installDateKey);
        if (byDate) return byDate;

        return record.reports[0] || null;
    }

    const updateDetail = row.detail || {};
    if (updateDetail.report && typeof updateDetail.report === 'object') {
        return updateDetail.report;
    }

    if (Number.isInteger(row.machineIndex) && row.machineIndex >= 0) {
        const direct = record.reports.find(r => Number(r.updateIndex) === row.machineIndex);
        if (direct) return direct;
    }

    if (Number.isInteger(row.machineIndex) && row.machineIndex >= 0 && record.reports[row.machineIndex]) {
        return record.reports[row.machineIndex];
    }

    const rowDateKey = toDateKey(row.date);
    const rowTech = normalizeTechnicianName(row.tech || '').toLowerCase();

    for (let i = record.reports.length - 1; i >= 0; i -= 1) {
        const candidate = record.reports[i] || {};
        const reportDateKey = toDateKey(candidate.date);
        const reportTech = normalizeTechnicianName(candidate.submittedBy || '').toLowerCase();
        if (reportDateKey && rowDateKey && reportDateKey === rowDateKey && (!rowTech || rowTech === reportTech)) {
            return candidate;
        }
    }

    return null;
}

// True for a history row saved without a Service Report. Pull Out entries
// logged before it moved onto the report flow have none, and only a report
// saved with that exact entry counts: the looser matches in
// findReportForHistoryRow would hand an old Pull Out a neighbouring
// activity's report.
function isAdHocHistoryRow(record, row, activityType) {
    if (row.isOriginal) return false;
    if (ADHOC_ACTIVITY_TYPES.has(activityType)) return true;
    if (activityType !== ACTIVITY_TYPES.PULL_OUT) return false;

    const detail = row.detail || {};
    if (detail.report && typeof detail.report === 'object') return false;
    const reports = Array.isArray(record.reports) ? record.reports : [];
    return !reports.some(r => r && r.updateIndex !== null && r.updateIndex !== undefined
        && Number(r.updateIndex) === row.machineIndex);
}

function setReportViewText(id, value, { preserveBreaks = false } = {}) {
    const el = document.getElementById(id);
    if (!el) return;

    const text = String(value || '').trim();
    if (!text) {
        el.textContent = '\u2014';
        el.classList.add('report-view-empty');
        return;
    }

    el.classList.remove('report-view-empty');

    if (preserveBreaks) {
        el.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    } else {
        el.textContent = text;
    }
}

//  History modal ΓöÇ

const historyPopup = document.getElementById('historyPopup');
const historyList = document.getElementById('historyList');
const closeHistoryPopup = document.getElementById('closeHistoryPopup');

function openHistoryModal(index) {
    const record = allMachines[index];
    if (!record) return;

    const rows = buildHistoryRows(record);

    historyList.innerHTML = rows.map((row, rowIndex) => {
        const activityType = row.isOriginal
            ? 'Installation'
            : (row.detail && row.detail.activityType ? row.detail.activityType : ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE);
        const isAdHoc = isAdHocHistoryRow(record, row, activityType);
        const report = isAdHoc ? null : findReportForHistoryRow(record, row);
        const refNo = isAdHoc ? '-' : (report && report.refNo ? report.refNo : '-');
        const activityBadgeClass = isAdHoc ? 'activity-badge activity-badge-adhoc' : 'activity-badge';
        return `
        <tr class="history-record-row" data-machine-index="${index}" data-row-index="${rowIndex}" tabindex="0" role="button" aria-label="View report for ${formatDateDisplay(row.smrDate || row.date)}">
            <td>${formatDateDisplay(row.smrDate)}</td>
            <td class="history-encoded-cell">${formatDateDisplay(row.date)}</td>
            <td class="history-tech-cell">${formatTechnicianLines(row.tech)}</td>
            <td><span class="${activityBadgeClass}">${escapeHtml(activityType)}</span></td>
            <td>${refNo}</td>
        </tr>
    `;
    }).join('');

    historyList.querySelectorAll('.history-record-row').forEach(rowEl => {
        rowEl.addEventListener('click', () => {
            const machineIndex = Number(rowEl.dataset.machineIndex);
            const targetRowIndex = Number(rowEl.dataset.rowIndex);
            openHistoryReportModal(machineIndex, targetRowIndex);
        });

        rowEl.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            const machineIndex = Number(rowEl.dataset.machineIndex);
            const targetRowIndex = Number(rowEl.dataset.rowIndex);
            openHistoryReportModal(machineIndex, targetRowIndex);
        });
    });

    historyPopup.style.display = 'grid';
}

closeHistoryPopup.addEventListener('click', () => {
    historyPopup.style.display = 'none';
});

historyPopup.addEventListener('click', (e) => {
    if (e.target === historyPopup) {
        historyPopup.style.display = 'none';
    }
});

const historyReportPopup = document.getElementById('historyReportPopup');
const closeHistoryReportPopup = document.getElementById('closeHistoryReportPopup');

function closeHistoryReportModal() {
    if (!historyReportPopup) return;
    historyReportPopup.style.display = 'none';
}

function openHistoryReportModal(machineIndex, rowIndex) {
    const record = allMachines[machineIndex];
    if (!record) return;

    const rows = buildHistoryRows(record);
    const row = rows[rowIndex];
    if (!row) return;

    const updateDetail = row.detail || {};
    const activityType = row.isOriginal
        ? 'Installation'
        : (updateDetail.activityType || ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE);
    const activityKey = String(activityType || '').trim().toLowerCase();
    const isPullOut = activityKey === 'pull out';
    const isCannibalize = activityKey === 'cannibalize';
    const isPartsReturn = activityKey === 'parts return';
    const isAdHoc = isAdHocHistoryRow(record, row, activityType);

    const report = isAdHoc ? null : findReportForHistoryRow(record, row);
    const hasRunningHours = updateDetail && updateDetail.runningHours != null && String(updateDetail.runningHours).trim() !== '';
    const runningHours = hasRunningHours ? Number(updateDetail.runningHours) : null;

    const maintenanceAndParts = getMaintenanceAndPartUpdates(record, row, rowIndex);
    const maintenanceAndPartsList = document.getElementById('history-report-maintenance-parts-list');

    // The encoded date, matching the table's Date Encoded column. The SMR date
    // has its own field below, so the two are never conflated.
    setReportViewText('history-report-date', formatDateDisplay(row.date));
    const refNo = report && report.refNo ? report.refNo : '-';
    setReportViewText('history-report-refno', refNo);
    const submittedSource = report && report.submittedBy
        ? report.submittedBy
        : (row.tech || 'Unknown User');
    const submittedParts = splitTechnicianNames(submittedSource);
    const submittedByForView = submittedParts[0] || normalizeTechnicianName(submittedSource) || 'Unknown User';

    setReportViewText('history-report-submitted-by', submittedByForView);
    setReportViewText('history-report-unit', record.unit || '-');
    setReportViewText('history-report-model', record.model || '-');
    setReportViewText('history-report-serial', record.serialNo || '-');
    if (isAdHoc) {
        setReportViewText('history-report-running-hours', '-');
        setReportViewText('history-report-status', '-');
    } else {
        setReportViewText('history-report-running-hours', hasRunningHours ? `${runningHours} hrs` : '-');
        const statusToShow = (updateDetail && updateDetail.status) ? updateDetail.status : (report && report.status ? report.status : '-');
        setReportViewText('history-report-status', statusToShow);
    }
    setReportViewText('history-report-smr-date', formatSmrDate(updateDetail.smrDate) || '-');

    if (maintenanceAndPartsList) {
        if (isPullOut) {
            maintenanceAndPartsList.innerHTML = '<li class="report-view-empty">-</li>';
        } else if (!maintenanceAndParts.length) {
            maintenanceAndPartsList.innerHTML = '<li class="report-view-empty">No maintenance or parts updates recorded.</li>';
        } else {
            maintenanceAndPartsList.innerHTML = maintenanceAndParts
                .map(item => `<li>${escapeHtml(item)}</li>`)
                .join('');
        }
    }

    if (report) {
        const submittedNames = splitTechnicianNames(report.submittedBy || '');
        const submittedPrimary = submittedNames[0] || '';
        const legacyTechnicians = submittedNames.slice(1);
        const savedTechnicians = Array.isArray(report.technicians)
            ? report.technicians.flatMap(name => splitTechnicianNames(name))
            : [];
        const allTechnicians = [submittedPrimary, ...legacyTechnicians, ...savedTechnicians]
            .filter(Boolean)
            .filter((name, idx, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === idx);
        const techniciansText = allTechnicians.join(', ');

        setReportViewText('history-report-technicians', techniciansText);
        setReportViewText('history-report-problem', report.problem || '-', { preserveBreaks: true });
        setReportViewText('history-report-action', report.action || '-', { preserveBreaks: true });
        setReportViewText('history-report-recommendation', report.recommendation || '-', { preserveBreaks: true });
    } else {
        const adHocTechs = Array.isArray(updateDetail.technicians)
            ? updateDetail.technicians.flatMap(name => splitTechnicianNames(name))
            : [];
        const submittedNames = splitTechnicianNames(row.tech || '');
        const submittedPrimary = submittedNames[0] || normalizeTechnicianName(row.tech || '') || 'Unknown User';
        const allTechnicians = [submittedPrimary, ...adHocTechs]
            .filter(Boolean)
            .filter((name, idx, arr) => arr.findIndex(v => v.toLowerCase() === name.toLowerCase()) === idx);
        const techniciansText = allTechnicians.join(', ');

        setReportViewText('history-report-technicians', techniciansText);
        // If there's no report and no explicit values provided, show '-' for these fields
        setReportViewText('history-report-problem', '-', { preserveBreaks: true });
        setReportViewText('history-report-action', '-', { preserveBreaks: true });
        setReportViewText('history-report-recommendation', '-', { preserveBreaks: true });
    }

    // The scanned paper report saved with this entry. Typed Problem / Action /
    // Recommendation only exist on reports saved before the image replaced
    // them, so those rows show only when one of them has text.
    const photo = !row.isOriginal && updateDetail.photo && updateDetail.photo.id ? updateDetail.photo : null;
    const photoEl = document.getElementById('history-report-photo');
    if (photoEl) {
        if (photo) {
            photoEl.classList.remove('report-view-empty');
            photoEl.innerHTML = `<a class="rv-photo-link" href="/client/photos/${encodeURIComponent(photo.id)}" target="_blank" rel="noopener">${escapeHtml(photo.name || 'View image')}</a>`;
        } else {
            setReportViewText('history-report-photo', '');
        }
    }
    const hasLegacyNotes = Boolean(report && [report.problem, report.action, report.recommendation]
        .some(value => String(value || '').trim()));
    const legacyNotes = document.getElementById('history-report-legacy-notes');
    if (legacyNotes) legacyNotes.hidden = !hasLegacyNotes;
    const photoRow = document.getElementById('history-report-photo-row');
    if (photoRow) photoRow.classList.toggle('rv-field-last', !hasLegacyNotes);

    // Stash what this view is showing so an admin-only edit feature (loaded
    // separately, only for admin sessions) can identify exactly which report
    // to correct without re-deriving the row/report lookup itself.
    window.currentServiceReportContext = {
        machineIndex,
        rowIndex,
        record,
        row,
        report,
        isAdHoc
    };

    if (historyReportPopup) {
        historyReportPopup.style.display = 'grid';
    }
}

if (closeHistoryReportPopup) {
    closeHistoryReportPopup.addEventListener('click', closeHistoryReportModal);
}

if (historyReportPopup) {
    historyReportPopup.addEventListener('click', (event) => {
        if (event.target === historyReportPopup) {
            closeHistoryReportModal();
        }
    });
}