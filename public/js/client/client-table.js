const client = CLIENTS.find(c => c.id.toLowerCase() === decodeURIComponent(CLIENT_ID).toLowerCase());

function displayClientData() {
    if (!client) {
        document.title = 'Client not found \u2014 MSI';
        document.getElementById('page-title').textContent = 'Client not found';
        document.getElementById('profile-name').textContent = 'Client not found';
        document.getElementById('profile-location').textContent = '';
        document.getElementById('machine-tbody').innerHTML =
            `<tr><td colspan="8" class="loading-row">No client matched "${CLIENT_ID}".</td></tr>`;
        return;
    }

    document.title = `${client.name} \u2014 MSI`;
    document.getElementById('profile-name').textContent = client.name;
    document.getElementById('profile-location').textContent = client.location || 'N/A';
    document.getElementById('profile-avatar').textContent = client.name.charAt(0).toUpperCase();

    allMachines = orderMachinesNewestFirst(MACHINE_RECORDS);
    document.getElementById('machine-count').textContent = allMachines.length;
    filteredMachines = allMachines;
    currentPage = 1;
    try {
        renderTable(filteredMachines);
    } catch (error) {
        const tbody = document.getElementById('machine-tbody');
        tbody.innerHTML = `<tr><td colspan="8" class="loading-row">Failed to render records. Please refresh.</td></tr>`;
        console.error('Render table error:', error);
    }

    // Opened from the serial search: go straight to the unit's details.
    if (UNIT_ID && allMachines.length === 1) {
        showDetails(0);
    }

    refreshMachinesFromServer();
}

async function refreshMachinesFromServer() {
    if (!client) return;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        // A technician's page holds one unit; the server only returns that unit.
        const unitQuery = UNIT_ID ? `?unit=${encodeURIComponent(UNIT_ID)}` : '';
        const response = await fetch(`/client/${encodeURIComponent(CLIENT_ID)}/machines${unitQuery}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            return;
        }

        const payload = await response.json();
        if (!payload.ok || !Array.isArray(payload.machineRecords)) {
            return;
        }

        allMachines = orderMachinesNewestFirst(payload.machineRecords);
        filteredMachines = allMachines;
        currentPage = 1;
        document.getElementById('machine-count').textContent = allMachines.length;
        renderTable(filteredMachines);
    } catch (error) {
        // Keep preloaded rows when refresh fails.
        console.warn('Machine refresh failed; using preloaded records.', error);
    }
}

//  Pagination helpers 

function getTotalPages(records) {
    if (!records.length) return 1;
    const ordered = getOrderedRecords(records);
    return Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
}

function getPageSlice(records, page) {
    if (!records.length) return [];
    const ordered = getOrderedRecords(records);
    const start = (page - 1) * PAGE_SIZE;
    return ordered.slice(start, start + PAGE_SIZE);
}

function renderPagination(records) {
    const total = getTotalPages(records);
    const bar = document.getElementById('pagination-bar');
    const pages = document.getElementById('pagination-pages');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');

    if (records.length === 0) {
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= total;

    pages.innerHTML = '';
    const pageLabel = document.createElement('span');
    pageLabel.className = 'page-num-btn';
    pageLabel.textContent = currentPage;
    pages.appendChild(pageLabel);
}

function goToPage(p) {
    const total = getTotalPages(filteredMachines);
    currentPage = Math.max(1, Math.min(p, total));
    renderTable(filteredMachines);
}

window.changePage = function(delta) {
    goToPage(currentPage + delta);
};

//  Table rendering ΓöÇ

function renderTable(records) {
    const tbody = document.getElementById('machine-tbody');

    if (!records.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="loading-row">No records found.</td></tr>`;
        document.getElementById('pagination-bar').style.display = 'none';
        return;
    }

    records.forEach(r => {
        if (typeof r._runningSeconds === 'undefined') {
            r._runningSeconds = parseRunningHoursToSeconds(r.runningHours);
        }
    });

    const orderedRecords = getOrderedRecords(records);
    const pageRecords = getPageSlice(records, currentPage);
    const recordIndexMap = new Map();
    orderedRecords.forEach((record, idx) => {
        recordIndexMap.set(record, idx + 1);
    });

    tbody.innerHTML = pageRecords.map((r, i) => {
        const rowNumber = recordIndexMap.get(r) || (i + 1);
        const recordIndex = findMachineIndexByRecord(r);

        // Pass the full record so the calculation uses the correct anchor date
        const nextMaintenance = calculateNextMaintenance(r.dateInstalled, r._runningSeconds, r);
        const maintenanceStatus = getMaintenanceStatus(r.dateInstalled, r._runningSeconds, r, 30);
        const warn = maintenanceStatus.isOverdue || maintenanceStatus.isDueSoon;

        // The # cell shows a warning icon when maintenance is near or past due —
        // red once overdue, orange while still just due soon.
                const numCell = warn
                        ? `<td class="warn-cell">
                                 <span class="maintenance-warning" title="${maintenanceStatus.isOverdue ? 'Maintenance overdue' : 'Maintenance due soon'}" onclick="event.stopPropagation()">
                                     ${getMaintenanceWarningIcon(maintenanceStatus.isOverdue)}
                                 </span>
                             </td>`
                        : `<td>${rowNumber}</td>`;

        return `
            <tr class="clickable-row" onclick="showDetails(${recordIndex})">
                ${numCell}
                <td>${r.unit || '\u2014'}</td>
                <td>${r.model || '\u2014'}</td>
                <td>${r.serialNo || '\u2014'}</td>
                <td>${formatDateDisplay(r.dateInstalled)}</td>
                <td class="running-hours" data-index="${recordIndex}">${formatRunningHoursOnly(r._runningSeconds)}</td>
                <td>${r.status || '\u2014'}</td>
                <td class="${nextMaintenance === 'Overdue' ? 'overdue' : ''}">${nextMaintenance}</td>
            </tr>
        `;
    }).join('');

    renderPagination(records);
}

function filterSerial() {
    const q = document.getElementById('serialSearch').value.toLowerCase().trim();
    filteredMachines = allMachines.filter(r =>
        [r.unit, r.model, r.serialNo, r.dateInstalled, r.runningHours, r.status, r.description]
            .filter(Boolean)
            .some(v => String(v).toLowerCase().includes(q))
    );
    currentPage = 1;
    renderTable(filteredMachines);
}

// Show the page immediately using server-rendered PARTS_CATALOG
displayClientData();

// Refresh parts catalog silently in the background (keeps data fresh without blocking the page)
async function refreshPartsCatalogInBackground() {
    try {
        const response = await fetch('/client/api/parts-catalog');
        const payload = await response.json();
        if (payload.ok && payload.partsCatalog && Object.keys(payload.partsCatalog).length > 0) {
            window.PARTS_CATALOG = payload.partsCatalog;
        }
    } catch (e) {
        // Silent fail — server-rendered catalog is still available
        console.warn('Parts catalog background refresh failed.', e);
    }
}
refreshPartsCatalogInBackground();
