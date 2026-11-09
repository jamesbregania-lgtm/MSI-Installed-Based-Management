/* ── SECTION SWITCHING ── */
function switchSection(name, el) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('section-' + name).classList.add('active');
    el.classList.add('active');
}

/* ── MODAL HELPERS ── */
function openModal(id) {
    document.getElementById(id).classList.add('open');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

function closeOnOverlay(event, id) {
    if (event.target === event.currentTarget) closeModal(id);
}

/* ── EDIT EMPLOYEE ── */
function openEditEmployee(username, fullName, dept, branch) {
    document.getElementById('editEmpUsername').value = username;
    document.getElementById('editEmpFullName').value = fullName;
    document.getElementById('editEmpBranch').value   = branch;

    // Department is now a fixed Technical/Sales dropdown, but a few older
    // accounts still carry a different value typed in before this changed.
    // Drop that value in as a selected, clearly-marked option instead of
    // silently snapping it to "Technical Department" — editing someone's
    // name or branch shouldn't quietly rewrite their department too.
    const deptSelect = document.getElementById('editEmpDept');
    const previousLegacyOption = deptSelect.querySelector('option[data-legacy]');
    if (previousLegacyOption) previousLegacyOption.remove();

    deptSelect.value = dept;
    if (deptSelect.value !== dept) {
        const legacyOption = document.createElement('option');
        legacyOption.value = dept;
        legacyOption.textContent = `${dept} (current)`;
        legacyOption.dataset.legacy = 'true';
        deptSelect.insertBefore(legacyOption, deptSelect.firstChild);
        deptSelect.value = dept;
    }

    openModal('modal-edit-employee');
}

/* ── RESET PASSWORD ── */
function openResetPass(username) {
    document.getElementById('resetPassUsername').value      = username;
    document.getElementById('resetPassDisplay').textContent = username;
    const resetEmailInput = document.querySelector('#modal-reset-pass input[name="resetEmail"]');
    if (resetEmailInput) {
        resetEmailInput.value = '';
    }
    openModal('modal-reset-pass');
}

/* ── TOGGLE EMPLOYEE STATUS ── */
function toggleEmployee(username, status) {
    if (!confirm(`${status === 'inactive' ? 'Deactivate' : 'Reactivate'} account "${username}"?`)) return;
    document.getElementById('toggleEmpUsername').value = username;
    document.getElementById('toggleEmpStatus').value   = status;
    document.getElementById('form-toggle-emp').submit();
}

/* ── EDIT CLIENT ── */
function openEditClient(id, name, location) {
    document.getElementById('editClientId').value       = id;
    document.getElementById('editClientName').value     = name;
    document.getElementById('editClientLocation').value = location || '';
    openModal('modal-edit-client');
}

/* ── TOGGLE CLIENT STATUS ── */
function toggleClient(id, status) {
    if (!confirm(`${status === 'inactive' ? 'Deactivate' : 'Reactivate'} client "${id}"?`)) return;
    document.getElementById('toggleCliId').value     = id;
    document.getElementById('toggleCliStatus').value = status;
    document.getElementById('form-toggle-cli').submit();
}

/* ── EMPLOYEE TABLE FILTER ── */
let currentEmpStatusFilter = 'all';

function filterByStatus(status, el) {
    currentEmpStatusFilter = status;
    document.querySelectorAll('#section-employees .filter-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    applyEmpFilters();
}

function filterAccounts() { applyEmpFilters(); }

function applyEmpFilters() {
    const q = document.getElementById('accountSearch').value.toLowerCase().trim();
    document.querySelectorAll('#accountTableBodyTech .emp-row').forEach(row => {
        const matchQ = !q || row.innerText.toLowerCase().includes(q);
        const matchS = currentEmpStatusFilter === 'all' || row.dataset.status === currentEmpStatusFilter;
        row.style.display = matchQ && matchS ? '' : 'none';
    });
}

/* ── SALES TABLE FILTER ── */
let currentSalesStatusFilter = 'all';

function filterSalesByStatus(status, el) {
    currentSalesStatusFilter = status;
    // Find tabs only within the Sales card
    const cardToolbar = el.closest('.card-toolbar');
    if (cardToolbar) {
        cardToolbar.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    }
    el.classList.add('active');
    applySalesFilters();
}

function filterSalesAccounts() { applySalesFilters(); }

function applySalesFilters() {
    const q = document.getElementById('salesSearch').value.toLowerCase().trim();
    document.querySelectorAll('#accountTableBodySales .emp-row').forEach(row => {
        const matchQ = !q || row.innerText.toLowerCase().includes(q);
        const matchS = currentSalesStatusFilter === 'all' || row.dataset.status === currentSalesStatusFilter;
        row.style.display = matchQ && matchS ? '' : 'none';
    });
}

/* ── CLIENT TABLE FILTER ── */
let currentCliStatusFilter = 'all';

function filterClientsByStatus(status, el) {
    currentCliStatusFilter = status;
    document.querySelectorAll('#section-clients .filter-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    applyCliFilters();
}

function filterClients() { applyCliFilters(); }

function applyCliFilters() {
    const q = document.getElementById('clientSearch').value.toLowerCase().trim();
    // A suggestion picked from the list filters on that exact account; free
    // text filters on any sales name or username containing it.
    const salesPicked = document.getElementById('clientSalesFilter');
    const salesTyped = document.getElementById('clientSalesFilterInput');
    const salesFilter = salesPicked ? salesPicked.value : '';
    const salesText = salesTyped ? salesTyped.value.toLowerCase().trim() : '';
    document.querySelectorAll('.cli-row').forEach(row => {
        const matchQ = !q || row.innerText.toLowerCase().includes(q);
        const matchS = currentCliStatusFilter === 'all' || row.dataset.status === currentCliStatusFilter;
        const rowSales = row.dataset.sales || '';
        let matchSales = true;
        if (salesFilter) {
            matchSales = salesFilter === '__unassigned__' ? !rowSales : rowSales === salesFilter;
        } else if (salesText) {
            matchSales = `${row.dataset.salesName || ''} ${rowSales}`.toLowerCase().includes(salesText);
        }
        row.style.display = matchQ && matchS && matchSales ? '' : 'none';
    });
}

/* ── SALES ACCOUNT PICKERS (Client Management) ── */
function getSalesAccounts() {
    return Array.isArray(window.salesAccounts) ? window.salesAccounts : [];
}

/**
 * Type-to-search field with a suggestion list, in place of a dropdown that
 * grows with every sales account; suggestions appear only once at least one
 * character is typed. Options are { label, detail, value }. The
 * list is moved to <body> and placed under its field, so neither the clients
 * card nor the modal body can clip it.
 */
function wireSalesPicker({ input, list, getOptions, onPick, onType }) {
    if (!input || !list) return;
    document.body.appendChild(list);
    let shown = [];
    let focusedIndex = -1;

    const close = () => { list.classList.remove('open'); focusedIndex = -1; };
    const place = () => {
        // Line up with the visible box — the search pill around the filter field, or the field itself.
        const rect = (input.closest('.search-wrap') || input).getBoundingClientRect();
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const openUp = below < 180 && above > below;
        list.style.left = `${rect.left}px`;
        list.style.width = `${Math.max(rect.width, 300)}px`;
        list.style.maxHeight = `${Math.max(120, Math.min(260, openUp ? above : below))}px`;
        list.style.top = openUp ? '' : `${rect.bottom + 6}px`;
        list.style.bottom = openUp ? `${window.innerHeight - rect.top + 6}px` : '';
    };
    const render = () => {
        const query = input.value.trim().toLowerCase();
        // Nothing until something is typed — the full list would grow with every sales account.
        if (!query) {
            shown = [];
            close();
            return;
        }
        shown = getOptions().filter(option => `${option.label} ${option.detail || ''}`.toLowerCase().includes(query));
        list.innerHTML = shown.length
            ? shown.map((option, i) =>
                `<li class="sales-suggest-item${i === focusedIndex ? ' is-active' : ''}" data-index="${i}">` +
                `<span>${escapeHtml(option.label)}</span>` +
                (option.detail ? `<small>${escapeHtml(option.detail)}</small>` : '') +
                '</li>').join('')
            : '<li class="sales-suggest-empty">No sales account matches.</li>';
        place();
        list.classList.add('open');
        const active = list.querySelector('.is-active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    };
    const pick = option => {
        input.value = option.label;
        close();
        onPick(option);
    };

    list.addEventListener('mousedown', event => {
        event.preventDefault(); // keep focus in the field
        const item = event.target.closest('.sales-suggest-item');
        if (item) pick(shown[Number(item.dataset.index)]);
    });
    input.addEventListener('focus', render);
    input.addEventListener('blur', close);
    input.addEventListener('input', () => {
        focusedIndex = -1;
        if (onType) onType(input.value);
        render();
    });
    input.addEventListener('keydown', event => {
        if (!list.classList.contains('open')) {
            if (event.key === 'ArrowDown') { event.preventDefault(); render(); }
            return;
        }
        if (event.key === 'ArrowDown') { event.preventDefault(); focusedIndex = Math.min(focusedIndex + 1, shown.length - 1); render(); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); focusedIndex = Math.max(focusedIndex - 1, 0); render(); return; }
        if (event.key === 'Enter') {
            event.preventDefault();
            const option = shown[focusedIndex] || (shown.length === 1 ? shown[0] : null);
            if (option) pick(option);
            return;
        }
        if (event.key === 'Escape') close();
    });
    // The list is fixed on screen, so close it rather than let it drift when anything scrolls.
    window.addEventListener('scroll', event => { if (event.target !== list) close(); }, true);
    window.addEventListener('resize', close);
}

/** Sets the Client Management sales filter; an empty label and value show every client. */
function setSalesFilter(label, value) {
    document.getElementById('clientSalesFilterInput').value = label;
    document.getElementById('clientSalesFilter').value = value;
    document.getElementById('clientSalesFilterClear').hidden = !label;
    applyCliFilters();
}

(function initSalesFilter() {
    const input = document.getElementById('clientSalesFilterInput');
    if (!input) return;
    wireSalesPicker({
        input,
        list: document.getElementById('clientSalesFilterList'),
        getOptions: () => [{ label: 'Unassigned', detail: 'no sales account', value: '__unassigned__' }].concat(
            getSalesAccounts().map(account => ({
                label: account.fullName,
                detail: account.active ? account.username : `${account.username} · inactive`,
                value: account.username
            }))
        ),
        onPick: option => setSalesFilter(option.label, option.value),
        onType: text => {
            document.getElementById('clientSalesFilter').value = '';
            document.getElementById('clientSalesFilterClear').hidden = !text;
            applyCliFilters();
        }
    });
    document.getElementById('clientSalesFilterClear').addEventListener('click', () => setSalesFilter('', ''));
})();

/* ── ASSIGN SALES ACCOUNT TO CLIENT ── */
(function initAssignSalesPicker() {
    const input = document.getElementById('assignSalesInput');
    if (!input) return;
    const username = document.getElementById('assignSalesUsername');
    wireSalesPicker({
        input,
        list: document.getElementById('assignSalesList'),
        // Only active accounts can take a client; the server refuses the rest anyway.
        getOptions: () => getSalesAccounts()
            .filter(account => account.active)
            .map(account => ({ label: account.fullName, detail: account.username, value: account.username })),
        onPick: option => { username.value = option.value; input.setCustomValidity(''); },
        onType: () => { username.value = ''; input.setCustomValidity(''); }
    });
    document.getElementById('form-assign-sales').addEventListener('submit', event => {
        if (document.getElementById('assignSalesAction').value !== 'assign') return;
        if (!username.value) {
            // An exact name or username typed without picking from the list still counts.
            const typed = input.value.trim().toLowerCase();
            const match = getSalesAccounts().find(account => account.active
                && (account.fullName.toLowerCase() === typed || account.username === typed));
            if (match) username.value = match.username;
        }
        if (!username.value) {
            event.preventDefault();
            input.setCustomValidity('Pick a sales account from the suggestions.');
            input.reportValidity();
        }
    });
})();

function openAssignSales(btn) {
    const ds = btn.dataset;
    document.getElementById('assignSalesClientId').value = ds.clientId;
    document.getElementById('assignSalesClientName').textContent = ds.clientName;
    document.getElementById('assignSalesAction').value = 'assign';
    document.getElementById('assignSalesInput').value = '';
    document.getElementById('assignSalesInput').setCustomValidity('');
    document.getElementById('assignSalesUsername').value = '';

    const assigned = Boolean(ds.salesUsername);
    document.getElementById('assignSalesCurrent').style.display = assigned ? '' : 'none';
    document.getElementById('assignSalesCurrentName').textContent = ds.salesName || ds.salesUsername || '';
    // One client, one sales account: while assigned, the only option is to remove it.
    document.getElementById('assignSalesPicker').style.display = assigned ? 'none' : '';
    document.getElementById('assignSalesSubmitBtn').style.display = assigned ? 'none' : '';
    document.getElementById('assignSalesRemoveBtn').style.display = assigned ? '' : 'none';
    openModal('modal-assign-sales');
}

/** From the Sales accounts table: open Client Management showing only that account's clients. */
function viewSalesClients(username) {
    switchSection('clients', document.querySelector('.nav-item[data-section="clients"]'));
    document.getElementById('clientSearch').value = '';
    const account = getSalesAccounts().find(a => a.username === username);
    setSalesFilter(account ? account.fullName : username, username);
}

function submitUnassignSales() {
    if (!confirm('Remove the sales account from this client?')) return;
    document.getElementById('assignSalesAction').value = 'unassign';
    document.getElementById('form-assign-sales').submit();
}

/** The × beside a client's sales account in the table: unassign without opening the modal. */
function unassignSales(btn) {
    const ds = btn.dataset;
    if (!confirm(`Unassign ${ds.salesName} from ${ds.clientName}?`)) return;
    document.getElementById('assignSalesClientId').value = ds.clientId;
    document.getElementById('assignSalesAction').value = 'unassign';
    document.getElementById('form-assign-sales').submit();
}

/* ── MONITORING ACTIVITY LOG ── */
function getMonitoringRows() {
    return Array.from(document.querySelectorAll('#monitorActivityBody .monitor-row'));
}

function normalizeMonitoringText(value) {
    return String(value || '').trim().toLowerCase();
}

function rowMatchesTechnicianFilter(rowTechnicians, technicianFilter) {
    if (!technicianFilter) {
        return true;
    }

    return String(rowTechnicians || '')
        .split(',')
        .map(name => normalizeMonitoringText(name))
        .some(name => name.includes(technicianFilter));
}

function rowMatchesTypeFilter(row, typeFilter) {
    if (!typeFilter) {
        return true;
    }

    const tags = String(row?.dataset?.activityTags || row?.dataset?.type || '')
        .split(',')
        .map(normalizeMonitoringText)
        .filter(Boolean);

    return tags.includes(typeFilter);
}

function updateMonitoringResultsCount(visibleCount, totalCount) {
    const label = document.getElementById('monitorResultsCount');
    if (label) {
        label.textContent = `${visibleCount} of ${totalCount}`;
    }

    const empty = document.getElementById('monitorNoResults');
    if (empty) {
        empty.hidden = visibleCount !== 0;
    }
}

function applyMonitoringFilters() {
    const rows = getMonitoringRows();
    if (!rows.length) {
        updateMonitoringResultsCount(0, 0);
        return;
    }

    const serialFilter = normalizeMonitoringText(document.getElementById('monitorSerialSearch')?.value);
    const technicianFilter = normalizeMonitoringText(document.getElementById('monitorTechnicianFilter')?.value);
    const clientFilter = normalizeMonitoringText(document.getElementById('monitorClientFilter')?.value);
    const locationFilter = normalizeMonitoringText(document.getElementById('monitorLocationFilter')?.value);
    const unitFilter = normalizeMonitoringText(document.getElementById('monitorUnitFilter')?.value);
    const modelFilter = normalizeMonitoringText(document.getElementById('monitorModelFilter')?.value);
    const typeFilter = normalizeMonitoringText(document.getElementById('monitorTypeFilter')?.value);

    let visibleCount = 0;
    rows.forEach(row => {
        const rowSerial = normalizeMonitoringText(row.dataset.serialNo);
        const rowTechnicians = row.dataset.technicians || row.dataset.technician;
        const rowClient = normalizeMonitoringText(row.dataset.client);
        const rowUnit = normalizeMonitoringText(row.dataset.unit);
        const rowModel = normalizeMonitoringText(row.dataset.model);
        const matchesSerial = !serialFilter || rowSerial.includes(serialFilter);
        const matchesTechnician = rowMatchesTechnicianFilter(rowTechnicians, technicianFilter);
        const matchesClient = !clientFilter || rowClient.includes(clientFilter);
        const matchesLocation = !locationFilter || normalizeMonitoringText(row.dataset.location).includes(locationFilter);
        const matchesUnit = !unitFilter || rowUnit === unitFilter;
        const matchesModel = !modelFilter || rowModel.includes(modelFilter);
        const matchesType = rowMatchesTypeFilter(row, typeFilter);
        const visible = matchesSerial && matchesTechnician && matchesClient && matchesLocation && matchesUnit && matchesModel && matchesType;

        row.hidden = !visible;
        if (visible) {
            visibleCount += 1;
        }
    });

    updateMonitoringResultsCount(visibleCount, rows.length);
}

function sortMonitoringRows() {
    const tbody = document.getElementById('monitorActivityBody');
    const rows = getMonitoringRows();
    if (!tbody || !rows.length) {
        updateMonitoringResultsCount(0, 0);
        return;
    }

    const sortValue = document.getElementById('monitorSortFilter')?.value || 'date-desc';

    rows.sort((left, right) => {
        const leftDate = Number(left.dataset.dateSort || 0);
        const rightDate = Number(right.dataset.dateSort || 0);
        const leftTechnician = normalizeMonitoringText(left.dataset.technician);
        const rightTechnician = normalizeMonitoringText(right.dataset.technician);
        const leftClient = normalizeMonitoringText(left.dataset.client);
        const rightClient = normalizeMonitoringText(right.dataset.client);

        switch (sortValue) {
            case 'date-asc':
                return leftDate - rightDate || leftTechnician.localeCompare(rightTechnician) || leftClient.localeCompare(rightClient);
            case 'technician-asc':
                return leftTechnician.localeCompare(rightTechnician) || leftClient.localeCompare(rightClient) || leftDate - rightDate;
            case 'technician-desc':
                return rightTechnician.localeCompare(leftTechnician) || rightClient.localeCompare(leftClient) || rightDate - leftDate;
            case 'client-asc':
                return leftClient.localeCompare(rightClient) || leftTechnician.localeCompare(rightTechnician) || leftDate - rightDate;
            case 'client-desc':
                return rightClient.localeCompare(leftClient) || rightTechnician.localeCompare(leftTechnician) || rightDate - leftDate;
            case 'date-desc':
            default:
                return rightDate - leftDate || leftTechnician.localeCompare(rightTechnician) || leftClient.localeCompare(rightClient);
        }
    });

    rows.forEach(row => tbody.appendChild(row));
    applyMonitoringFilters();
}

function escapeCsvCell(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function syncMonitoringModelOptions() {
    const unitSelect = document.getElementById('monitorUnitFilter');
    const modelInput = document.getElementById('monitorModelFilter');
    const modelOptionsList = document.getElementById('monitorModelOptions');
    if (!unitSelect || !modelInput || !modelOptionsList) {
        return;
    }

    const unitValue = unitSelect.value || '';
    const currentModel = modelInput.value || '';
    const modelOptions = unitValue
        ? (window.monitoringUnitModelOptions && window.monitoringUnitModelOptions[unitValue]) || []
        : (window.monitoringModelOptions || []);

    modelOptionsList.replaceChildren();
    modelOptions.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        modelOptionsList.appendChild(option);
    });

    const normalizedCurrentModel = normalizeMonitoringText(currentModel);
    if (normalizedCurrentModel && !modelOptions.some(model => normalizeMonitoringText(model).includes(normalizedCurrentModel))) {
        modelInput.value = '';
    }
}

function handleMonitoringUnitFilterChange() {
    syncMonitoringModelOptions();
    applyMonitoringFilters();
}

function getCellText(row, index) {
    const cell = row.cells[index];
    return cell ? cell.textContent.replace(/\s+/g, ' ').trim() : '';
}

function getRowDataText(row, key) {
    const raw = String(row?.dataset?.[key] || '').trim();
    // For certain monitoring fields, show a dash when empty so missing input is visible
    const DASH_KEYS = new Set(['runningHours', 'status', 'serialNo', 'description', 'problem', 'action', 'recommendation', 'technicians', 'techniciansText', 'submittedBy']);
    if (!raw && DASH_KEYS.has(key)) return '-';
    return raw;
}

function getMonitoringActivityDetail(row) {
    const activityType = normalizeMonitoringText(row?.dataset?.type || '');

    if (activityType === 'pull_out') {
        return 'Entire unit pulled out';
    }

    if (activityType === 'cannibalize') {
        return getRowDataText(row, 'partsCsv') || getCellText(row, 7) || 'Selected parts for cannibalize';
    }

    if (activityType === 'maintenance_parts') {
        const parts = getRowDataText(row, 'partsCsv') || getCellText(row, 7) || 'Parts changed';
        return `Maintenance + Parts (${parts})`;
    }

    if (activityType === 'maintenance') {
        return 'Maintenance';
    }

    if (activityType === 'parts') {
        return getRowDataText(row, 'partsCsv') || getCellText(row, 7) || 'Parts changed';
    }

    if (activityType === 'installed') {
        return 'Installation';
    }

    return getCellText(row, 8) || '';
}

function exportMonitoringCsv() {
    const rows = getMonitoringRows().filter(row => !row.hidden);
    if (!rows.length) {
        alert('No monitoring rows match the current filters.');
        return;
    }

    const header = [
        'Date',
        'Submitted By',
        'Technicians',
        'Client',
        'Client Location',
        'Unit',
        'Model',
        'Serial No',
        'Running Hours',
        'Status',
        'Activity',
        'Activity Details',
        'Description',
        'Problem / Root Cause',
        'Action Taken',
        'Recommendation'
    ];
    const csvRows = rows.map(row => [
        getCellText(row, 0),
        getRowDataText(row, 'submittedBy'),
        getRowDataText(row, 'techniciansText') || getRowDataText(row, 'technicians'),
        getRowDataText(row, 'client'),
        getRowDataText(row, 'location'),
        getRowDataText(row, 'unit'),
        getRowDataText(row, 'model'),
        getRowDataText(row, 'serialNo'),
        getRowDataText(row, 'runningHours'),
        normalizeMonitoringText(row.dataset.status || row.dataset.machineStatus || ''),
        getCellText(row, 6),
        getMonitoringActivityDetail(row),
        getRowDataText(row, 'description'),
        getRowDataText(row, 'problem'),
        getRowDataText(row, 'action'),
        getRowDataText(row, 'recommendation')
    ]);

    const csv = [header, ...csvRows]
        .map(row => row.map(escapeCsvCell).join(','))
        .join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `monitoring-results-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/* ── TITLE-CASE: Edit Employee Full Name ── */
const editEmpFullName = document.getElementById('editEmpFullName');
if (editEmpFullName) {
    editEmpFullName.addEventListener('input', () => {
        const pos = editEmpFullName.selectionStart;
        editEmpFullName.value = editEmpFullName.value
            .toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());
        editEmpFullName.setSelectionRange(pos, pos);
    });
}

/* ── UPPERCASE: Edit Employee Dept (free text; invite dept is now a fixed-option select) ── */
const editEmpDeptInput = document.getElementById('editEmpDept');
if (editEmpDeptInput) {
    editEmpDeptInput.addEventListener('input', () => { editEmpDeptInput.value = editEmpDeptInput.value.toUpperCase(); });
}

/* ── FLASH AUTO-DISMISS ── */
const flashMsg = document.getElementById('flashMsg');
if (flashMsg) {
    setTimeout(() => {
        flashMsg.style.transition = 'opacity 0.5s';
        flashMsg.style.opacity    = '0';
        flashMsg.style.pointerEvents = 'none';
        setTimeout(() => { flashMsg.style.display = 'none'; }, 500);
    }, 4000);
}

/* ── CLOSE ALL MODALS ON LOAD (safety reset) ── */
document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));

/* ── URL HASH: jump to clients tab ── */
(function () {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'clients' || hash === 'monitoring' || hash === 'tech-history' || hash === 'unit-models' || hash === 'parts' || hash === 'unit-transfer' || hash === 'serial-search' || hash === 'scheduling') {
        const btn = document.querySelector(`[data-section="${hash}"]`);
        if (btn) switchSection(hash, btn);
    }
})();

sortMonitoringRows();
syncMonitoringModelOptions();

/* ── RESIZABLE TECHNICIAN ACTIVITY LOG ── */
const MONITOR_ACTIVITY_DEFAULT_HEIGHT = 520;
const MONITOR_ACTIVITY_MIN_HEIGHT = 420;
const MONITOR_ACTIVITY_HEIGHT_KEY = 'admin-monitor-activity-height';

function initMonitoringActivityResize() {
    const card = document.getElementById('monitorActivityCard');
    const handle = document.getElementById('monitorActivityResizeHandle');
    if (!card || !handle) return;

    const setHeight = value => {
        const height = Math.max(MONITOR_ACTIVITY_MIN_HEIGHT, Math.round(Number(value) || MONITOR_ACTIVITY_DEFAULT_HEIGHT));
        card.style.height = `${height}px`;
        handle.setAttribute('aria-valuenow', String(height));
        return height;
    };

    try {
        setHeight(window.localStorage.getItem(MONITOR_ACTIVITY_HEIGHT_KEY));
    } catch (_) {
        setHeight(MONITOR_ACTIVITY_DEFAULT_HEIGHT);
    }

    let drag = null;

    const finishResize = event => {
        if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
        drag = null;
        card.classList.remove('is-resizing');
        document.body.classList.remove('monitor-activity-resizing');
        try {
            window.localStorage.setItem(MONITOR_ACTIVITY_HEIGHT_KEY, String(Math.round(card.getBoundingClientRect().height)));
        } catch (_) {
            // Resizing still works when browser storage is unavailable.
        }
    };

    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        drag = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: card.getBoundingClientRect().height
        };
        handle.setPointerCapture(event.pointerId);
        card.classList.add('is-resizing');
        document.body.classList.add('monitor-activity-resizing');
        event.preventDefault();
    });

    handle.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        setHeight(drag.startHeight + event.clientY - drag.startY);
    });

    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);

    handle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home') return;
        event.preventDefault();
        const currentHeight = card.getBoundingClientRect().height;
        const nextHeight = event.key === 'Home'
            ? MONITOR_ACTIVITY_DEFAULT_HEIGHT
            : currentHeight + (event.key === 'ArrowDown' ? 40 : -40);
        const height = setHeight(nextHeight);
        try {
            window.localStorage.setItem(MONITOR_ACTIVITY_HEIGHT_KEY, String(height));
        } catch (_) {}
    });

    handle.addEventListener('dblclick', () => {
        const height = setHeight(MONITOR_ACTIVITY_DEFAULT_HEIGHT);
        try {
            window.localStorage.setItem(MONITOR_ACTIVITY_HEIGHT_KEY, String(height));
        } catch (_) {}
    });
}

initMonitoringActivityResize();

/* ── TOP 3 TECHNICIAN LEADERBOARD ── */

/* ══════════════════════════════════════
   MONITORING INTERACTIVITY
   ══════════════════════════════════════ */

// Cache latest monitoring data (initialised from server-rendered JSON)
let monitoringData = window.monitoringInitData || {};

/* ── KPI DETAIL MODAL ── */
const KPI_META = {
    pendingUnits: {
        title: 'Pending Units (maintenance)',
        desc: 'Units that still have outstanding maintenance, parts, or status warnings.',
        color: 'amber'
    },
    faultyUnits: {
        title: 'Pending Units (faulty)',
        desc: 'Units currently marked as Faulty fleet-wide.',
        color: 'amber'
    },
    unitsInstalled: {
        title: 'Units Installed',
        desc: 'Units whose installation date falls inside the selected period.',
        color: 'navy'
    },
    unitsDisabled: {
        title: 'Units Disabled',
        desc: 'Units an admin has disabled. They no longer count as installed or in use, and keep their serial and history.',
        color: 'amber'
    },
    techReports: {
        title: 'Tech Reports Log',
        desc: 'Every report logged in the selected period — installation, maintenance, parts change, repair, cannibalize and pull out all count as one report. A report listing several technicians appears under each of them, so these names add up to more than the total.',
        color: 'navy'
    },
    completionRate: {
        title: 'Completion Rate',
        desc: 'Percentage of tracked units that are warning-free.',
        color: 'green',
        isPercent: true
    }
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function openKpiDetail(kpiKey) {
    const meta = KPI_META[kpiKey];
    if (!meta) return;
    const d = monitoringData;

    document.getElementById('kpiDetailTitle').textContent = meta.title;
    const container = document.getElementById('kpiDetailContent');

    let html = '';

    // Contextual visualisation depending on KPI type
    if (kpiKey === 'pendingUnits') {
        const finished = d.completedUnits || 0;
        const pending = d.pendingUnits || 0;
        const total = finished + pending;
        const finPct = total > 0 ? Math.round((finished / total) * 100) : 0;
        const penPct = total > 0 ? Math.round((pending / total) * 100) : 0;

        // Donut chart like the reference image
        html += `<div class="kpi-donut-row">
            <div class="kpi-donut" style="background:conic-gradient(#0ea472 ${finPct}%, #d4910e ${finPct}% ${finPct + penPct}%, #e8eef7 ${finPct + penPct}%)">
                <div class="kpi-donut-inner">
                    <strong>${total}</strong>
                    <span>TOTAL</span>
                </div>
            </div>
            <div class="kpi-legend">
                <div class="kpi-legend-item">
                    <span class="kpi-legend-dot" style="background:#0ea472"></span>
                    Finished
                    <span class="kpi-legend-value">${finished} (${finPct}%)</span>
                </div>
                <div class="kpi-legend-item">
                    <span class="kpi-legend-dot" style="background:#d4910e"></span>
                    Pending
                    <span class="kpi-legend-value">${pending} (${penPct}%)</span>
                </div>
            </div>
        </div>`;

        // Fleet-wide pending clients — same list backing the "Clients Pending" KPI,
        // so this breakdown always agrees with the donut above it.
        const pendingClients = d.pendingClientsList || [];
        if (pendingClients.length) {
            html += `<div class="kpi-bar-chart">`;
            // Both segments, in the donut's own colours. A single bar coloured
            // by completion rate read as "this much is pending" — Phelps Dodge
            // showed a short amber bar for 1 of 19 finished, which looks like
            // one unit pending when in fact eighteen are.
            pendingClients.forEach(c => {
                const pct = c.completionRate || 0;
                const pendingPct = Math.max(0, 100 - pct);
                html += `<div class="kpi-bar-row">
                    <div class="kpi-bar-head">
                        <strong>${escapeHtml(c.clientName)}</strong>
                        <span>${c.finishedUnits} finished · ${c.pendingUnits} pending of ${c.units}</span>
                    </div>
                    <div class="kpi-bar-track kpi-bar-track-split">
                        <span class="kpi-bar-fill kpi-bar-fill-green" style="width:${pct}%"></span>
                        <span class="kpi-bar-fill kpi-bar-fill-amber" style="width:${pendingPct}%"></span>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }
    }
    else if (kpiKey === 'faultyUnits') {
        const faultyList = d.faultyUnitsList || [];
        const faultyCount = faultyList.length;

        if (faultyCount === 0) {
            html += `<p class="monitor-empty">No units are currently marked faulty!</p>`;
        } else {
            const clientCounts = {};
            faultyList.forEach(m => {
                if (!clientCounts[m.clientName]) {
                    clientCounts[m.clientName] = 0;
                }
                clientCounts[m.clientName]++;
            });
            const aggregated = Object.keys(clientCounts).map(name => ({
                clientName: name,
                count: clientCounts[name]
            }));
            aggregated.sort((a, b) => a.clientName.localeCompare(b.clientName));

            html += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px;">`;
            aggregated.forEach(c => {
                html += `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <strong style="margin-bottom: 4px; text-align: center; color: var(--navy); font-size: 13px;">${escapeHtml(c.clientName)}</strong>
                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">${c.count} ${c.count === 1 ? 'unit' : 'units'}</span>
                </div>`;
            });
            html += `</div>`;
        }
    }
    else if (kpiKey === 'techReports') {
        const techList = d.techReportLog || [];

        if (!techList.length) {
            html += `<p class="monitor-empty">No reports logged in this period.</p>`;
        } else {
            html += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px;">`;
            techList.forEach(t => {
                html += `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <strong style="margin-bottom: 4px; text-align: center; color: var(--navy); font-size: 13px;">${escapeHtml(t.name)}</strong>
                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">${t.total} ${t.total === 1 ? 'report' : 'reports'}</span>
                </div>`;
            });
            html += `</div>`;
        }
    }
    else if (kpiKey === 'unitsInstalled') {
        const installList = d.unitsInstalledByClient || [];

        if (!installList.length) {
            html += `<p class="monitor-empty">No units were installed in this period.</p>`;
        } else {
            html += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px;">`;
            installList.forEach(c => {
                html += `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <strong style="margin-bottom: 4px; text-align: center; color: var(--navy); font-size: 13px;">${escapeHtml(c.clientName)}</strong>
                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">${c.count} ${c.count === 1 ? 'unit' : 'units'}</span>
                </div>`;
            });
            html += `</div>`;
        }
    }
    else if (kpiKey === 'unitsDisabled') {
        const disabledList = d.unitsDisabledList || [];

        if (!disabledList.length) {
            html += `<p class="monitor-empty">No units are disabled.</p>`;
        } else {
            html += `<div class="table-wrap"><table><thead><tr><th>Serial No.</th><th>Unit / Model</th><th>Client</th><th>Disabled</th></tr></thead><tbody>`;
            disabledList.forEach(u => {
                const when = u.disabledAt ? new Date(u.disabledAt) : null;
                const whenText = when && !Number.isNaN(when.getTime())
                    ? when.toLocaleDateString('en-GB')
                    : '—';
                html += `<tr>
                    <td class="mono">${escapeHtml(u.serial)}</td>
                    <td>${escapeHtml([u.unit, u.model].filter(Boolean).join(' / ') || '—')}</td>
                    <td>${escapeHtml(u.clientName)}</td>
                    <td>${escapeHtml(whenText)}${u.disabledBy ? ' · ' + escapeHtml(u.disabledBy) : ''}</td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        }
    }
    else if (kpiKey === 'completionRate') {
        const rate = d.completionRate || 0;
        const finished = d.completedUnits || 0;
        const pending = d.pendingUnits || 0;
        const total = finished + pending;
        const finPct = total > 0 ? Math.round((finished / total) * 100) : 0;
        const penPct = total > 0 ? Math.round((pending / total) * 100) : 0;

        // Donut visualisation only — matching the reference image
        html += `<div class="kpi-donut-row">
            <div class="kpi-donut" style="background:conic-gradient(#0ea472 ${finPct}%, #d4910e ${finPct}% ${finPct + penPct}%, #e8eef7 ${finPct + penPct}%)">
                <div class="kpi-donut-inner">
                    <strong>${total}</strong>
                    <span>TOTAL</span>
                </div>
            </div>
            <div class="kpi-legend">
                <div class="kpi-legend-item">
                    <span class="kpi-legend-dot" style="background:#0ea472"></span>
                    Finished
                    <span class="kpi-legend-value">${finished} (${finPct}%)</span>
                </div>
                <div class="kpi-legend-item">
                    <span class="kpi-legend-dot" style="background:#d4910e"></span>
                    Pending
                    <span class="kpi-legend-value">${pending} (${penPct}%)</span>
                </div>
            </div>
        </div>`;

    }

    container.innerHTML = html;
    openModal('modal-kpi-detail');
}

/* ── CLIENT DETAIL MODAL ── */
function openClientDetail(name, units, finished, reports, updates, rate, isActive) {
    document.getElementById('clientDetailTitle').textContent = name;
    const container = document.getElementById('clientDetailContent');
    const pending = units - finished;

    let html = `<div class="kpi-detail-summary">
        <div class="kpi-detail-big">${rate}%</div>
        <div class="kpi-detail-desc">
            <strong>${name}</strong>
            ${isActive ? 'Active client' : 'Inactive client'} • ${units} tracked unit${units !== 1 ? 's' : ''}
        </div>
    </div>`;

    // Stat grid
    html += `<div class="client-detail-grid">
        <div class="client-detail-stat">
            <span class="stat-num">${finished}</span>
            <span class="stat-label">Units Finished</span>
        </div>
        <div class="client-detail-stat">
            <span class="stat-num">${pending}</span>
            <span class="stat-label">Pending Units</span>
        </div>
        <div class="client-detail-stat">
            <span class="stat-num">${reports}</span>
            <span class="stat-label">Reports This Period</span>
        </div>
        <div class="client-detail-stat">
            <span class="stat-num">${updates}</span>
            <span class="stat-label">Updates This Period</span>
        </div>
    </div>`;

    // Progress bar
    const pct = units > 0 ? Math.round((finished / units) * 100) : 0;
    html += `<div class="kpi-bar-chart">
        <div class="kpi-bar-row">
            <div class="kpi-bar-head">
                <strong>Completion Progress</strong>
                <span>${finished}/${units} (${pct}%)</span>
            </div>
            <div class="kpi-bar-track" style="height:14px">
                <span class="kpi-bar-fill kpi-bar-fill-${pct >= 100 ? 'green' : pct > 50 ? 'blue' : 'amber'}" style="width:${pct}%"></span>
            </div>
        </div>
    </div>`;

    // Donut
    html += `<div class="kpi-donut-row">
        <div class="kpi-donut" style="background:conic-gradient(#0ea472 ${pct}%, #d4910e ${pct}% ${pct + (100 - pct)}%, #e8eef7 100%)">
            <div class="kpi-donut-inner">
                <strong>${pct}%</strong>
                <span>done</span>
            </div>
        </div>
        <div class="kpi-legend">
            <div class="kpi-legend-item">
                <span class="kpi-legend-dot" style="background:#0ea472"></span>
                Finished
                <span class="kpi-legend-value">${finished}</span>
            </div>
            <div class="kpi-legend-item">
                <span class="kpi-legend-dot" style="background:#d4910e"></span>
                Pending
                <span class="kpi-legend-value">${pending}</span>
            </div>
            <div class="kpi-legend-item">
                <span class="kpi-legend-dot" style="background:var(--navy-mid)"></span>
                Reports
                <span class="kpi-legend-value">${reports}</span>
            </div>
            <div class="kpi-legend-item">
                <span class="kpi-legend-dot" style="background:#3b82f6"></span>
                Updates
                <span class="kpi-legend-value">${updates}</span>
            </div>
        </div>
    </div>`;

    container.innerHTML = html;
    openModal('modal-client-detail');
}

/* ── DATE RANGE FILTER ── */
let monitorRangeAbort = null;

function onMonitorRangeChange(range) {
    const customWrap = document.getElementById('monitorCustomRangeWrap');
    if (range === 'custom') {
        if (customWrap) customWrap.style.display = 'flex';
        const startInput = document.getElementById('monitorCustomStart');
        const endInput = document.getElementById('monitorCustomEnd');
        // Wait for the user to pick both dates and hit Apply before fetching.
        if (!(startInput && startInput.value && endInput && endInput.value)) return;
        applyCustomMonitorRange();
        return;
    }
    if (customWrap) customWrap.style.display = 'none';
    fetchMonitoringData(range);
}

function applyCustomMonitorRange() {
    const startInput = document.getElementById('monitorCustomStart');
    const endInput = document.getElementById('monitorCustomEnd');
    const start = startInput && startInput.value;
    const end = endInput && endInput.value;
    if (!start || !end) return;
    if (start > end) {
        alert('The start date must be before the end date.');
        return;
    }
    fetchMonitoringData('custom', { start, end });
}

function fetchMonitoringData(range, customBounds) {
    if (monitorRangeAbort) monitorRangeAbort.abort();
    monitorRangeAbort = new AbortController();

    const kpiRow = document.getElementById('monitorKpiRow');
    if (kpiRow) kpiRow.classList.add('monitor-kpis-loading');

    let url = `/admin_account/monitoring-data?range=${encodeURIComponent(range)}`;
    if (customBounds) {
        url += `&start=${encodeURIComponent(customBounds.start)}&end=${encodeURIComponent(customBounds.end)}`;
    }

    fetch(url, {
        signal: monitorRangeAbort.signal
    })
    .then(res => res.json())
    .then(data => {
        if (!data.ok) throw new Error(data.error || 'Failed');
        const m = data.monitoring;

        // Update local cache
        monitoringData = {
            completedUnits: m.completedUnits,
            pendingUnits: m.pendingUnits,
            faultyUnits: m.faultyUnits,
            faultyUnitsList: m.faultyUnitsList || [],
            completedClients: m.completedClients,
            pendingClientsList: m.pendingClientsList || [],
            reportEvents: m.reportEvents,
            updateEvents: m.updateEvents,
            completionRate: m.completionRate,
            totalUnits: m.totalUnits,
            installBaseShare: m.installBaseShare,
            installBaseTotalUnits: m.installBaseTotalUnits,
            installedUnitTypes: m.installedUnitTypes,
            catalogUnitTypes: m.catalogUnitTypes,
            clientHighlights: m.clientHighlights,
            techReports: m.techReports || [],
            unitsInstalledByClient: m.unitsInstalledByClient || [],
            unitsInstalledInRange: m.unitsInstalledInRange || 0,
            unitsDisabled: m.unitsDisabled || 0,
            unitsDisabledList: m.unitsDisabledList || [],
            techReportLog: m.techReportLog || [],
            reportsInRange: m.reportsInRange || 0
        };

        // Update KPI numbers
        updateKpiNum('kpi-pendingUnits', m.pendingUnits);
        updateKpiNum('kpi-faultyUnits', m.faultyUnits || 0);
        updateKpiNum('kpi-techReports', m.reportsInRange || 0);
        updateKpiNum('kpi-unitsInstalled', m.unitsInstalledInRange || 0);
        updateKpiNum('kpi-unitsDisabled', m.unitsDisabled || 0);
        updateKpiNum('kpi-completionRate', m.completionRate + '%');

        // Update install base profile card
        renderInstallBase(m);

        // Repair Parts Monitoring follows the selected range
        renderRepairParts(m.repairPartsUsage);

        // Update current-activity-by-type chart

        // Update the per-technician report log
        renderTechReportLog(m);


        if (kpiRow) kpiRow.classList.remove('monitor-kpis-loading');
    })
    .catch(err => {
        if (err.name === 'AbortError') return;
        console.error('[monitoring range]', err);
        if (kpiRow) kpiRow.classList.remove('monitor-kpis-loading');
    });
}

function updateKpiNum(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/* ── INSTALL BASE PROFILE ──
   Mirrors the server-rendered markup in admin_account.ejs so a range change
   redraws the card exactly the way the page first painted it. */

// Catalog entries past the 8 categorical hues share one neutral slot rather
// than getting a 9th hue nobody could tell apart.
function ibColorSuffix(row) {
    return row.colorIndex >= 0 ? row.colorIndex : 'x';
}

function ibBody(row) {
    return `${row.count} ${row.count === 1 ? 'unit' : 'units'} · ${row.percentage}% of fleet`;
}

function ibNote(row) {
    const models = (row.models || []).map(m => `${m.model} (${m.count})`).join(', ');
    return models ? `Top models: ${models}` : '';
}

function renderInstallBase(m) {
    const rows = m.installBaseShare || [];
    // The profile's own total — units installed in the selected period — not
    // totalUnits, which counts every machine touched in it.
    const total = m.installBaseTotalUnits || 0;

    const summary = document.getElementById('installBaseSummary');
    if (summary) {
        const inService = m.installedUnitTypes != null
            ? m.installedUnitTypes
            : rows.filter(row => row.count > 0).length;
        const catalog = m.catalogUnitTypes != null ? m.catalogUnitTypes : rows.length;
        summary.textContent = `${total} units · ${inService} of ${catalog} unit types in service`;
    }

    const active = rows.filter(row => row.count > 0);
    const segments = active.filter(row => row.colorIndex >= 0);
    const folded = active.filter(row => row.colorIndex < 0);
    if (folded.length) {
        segments.push({
            label: 'Other',
            colorIndex: -1,
            count: folded.reduce((sum, row) => sum + row.count, 0),
            percentage: folded.reduce((sum, row) => sum + row.percentage, 0),
            share: folded.reduce((sum, row) => sum + row.share, 0),
            // The grouped "Other" row already lists its models; other folded rows are listed by name.
            models: folded.flatMap(row => (row.isOther ? row.models : [{ model: row.label, count: row.count }]))
        });
    }

    const barSlot = document.getElementById('installBaseBarSlot');
    if (barSlot) {
        if (!segments.length) {
            barSlot.innerHTML = '<div class="ib-bar-empty" role="img" aria-label="No units installed"></div>';
        } else {
            const mix = segments.map(row => `${row.label} ${row.percentage} percent`).join(', ');
            let bar = `<div class="ib-bar" id="installBaseBar" role="img" aria-label="Unit type mix: ${escapeHtml(mix)}">`;
            segments.forEach(row => {
                // A label only goes inside a segment wide enough to hold it; the
                // list below carries every value either way.
                const label = row.share >= 14
                    ? `<span class="ib-seg-label">${escapeHtml(row.label)} ${row.percentage}%</span>`
                    : '';
                bar += `<span class="ib-seg ib-seg--${ibColorSuffix(row)}"
                              style="width: ${row.share.toFixed(2)}%"
                              data-tip-title="${escapeHtml(row.label)}"
                              data-tip-body="${escapeHtml(ibBody(row))}"
                              data-tip-note="${escapeHtml(ibNote(row))}">${label}</span>`;
            });
            barSlot.innerHTML = `${bar}</div>`;
        }
    }

    const list = document.getElementById('installBaseList');
    if (!list) return;

    const maxCount = rows.reduce((max, row) => Math.max(max, row.count), 0);
    let html = '';
    let dividerDone = false;
    rows.forEach(row => {
        if (!row.count && !dividerDone && active.length) {
            dividerDone = true;
            html += '<li class="ib-divider">Not in service</li>';
        }
        const suffix = ibColorSuffix(row);
        const width = maxCount > 0 ? ((row.count / maxCount) * 100).toFixed(2) : 0;
        const fill = row.count
            ? `<span class="ib-fill ib-fill--${suffix}" style="width: ${width}%"></span>`
            : '';
        html += `<li class="ib-row ${row.count ? '' : 'ib-row--idle'}"
                     data-tip-title="${escapeHtml(row.label)}"
                     data-tip-body="${escapeHtml(row.count ? ibBody(row) : 'No units installed')}"
                     data-tip-note="${escapeHtml(ibNote(row))}">
            <span class="ib-chip ib-chip--${suffix}"></span>
            <span class="ib-name">${escapeHtml(row.label)}</span>
            <span class="ib-track">${fill}</span>
            <span class="ib-count">${row.count}</span>
            <span class="ib-pct">${row.count ? row.percentage + '%' : '—'}</span>
        </li>`;
    });
    list.innerHTML = html;
}

/* ── INSTALL BASE HOVER DETAIL ──
   Built with textContent, never innerHTML: unit and model names come from
   machine records, so nothing in them may be read as markup. */
let installBaseTip = null;

function showInstallBaseTip(target) {
    const title = target.getAttribute('data-tip-title');
    if (!title) return;

    if (!installBaseTip) {
        installBaseTip = document.createElement('div');
        installBaseTip.className = 'ib-tip';
        document.body.appendChild(installBaseTip);
    }

    installBaseTip.textContent = '';
    const heading = document.createElement('strong');
    heading.textContent = title;
    installBaseTip.appendChild(heading);
    installBaseTip.appendChild(document.createTextNode(target.getAttribute('data-tip-body') || ''));

    const note = target.getAttribute('data-tip-note');
    if (note) {
        const models = document.createElement('em');
        models.textContent = note;
        installBaseTip.appendChild(models);
    }

    // Prefer sitting above the mark; flip below when there is no room there.
    installBaseTip.classList.add('is-open');
    const mark = target.getBoundingClientRect();
    const tip = installBaseTip.getBoundingClientRect();
    const left = Math.max(8, Math.min(
        mark.left + (mark.width / 2) - (tip.width / 2),
        window.innerWidth - tip.width - 8
    ));
    const above = mark.top - tip.height - 8;
    installBaseTip.style.left = `${left}px`;
    installBaseTip.style.top = `${above < 8 ? mark.bottom + 8 : above}px`;
}

function hideInstallBaseTip() {
    if (installBaseTip) installBaseTip.classList.remove('is-open');
}

// Delegated, so the listeners survive every re-render of the card.
function initInstallBaseTips() {
    const card = document.getElementById('installBaseCard');
    if (!card) return;

    card.addEventListener('mouseover', event => {
        const target = event.target.closest('[data-tip-title]');
        if (target && card.contains(target)) showInstallBaseTip(target);
    });
    card.addEventListener('mouseout', event => {
        if (event.target.closest('[data-tip-title]')) hideInstallBaseTip();
    });
    window.addEventListener('scroll', hideInstallBaseTip, true);
}

/* ── TECH REPORTS LOG ──
   One ranked bar per technician for the selected period, split into the
   installations and the service work behind the total. Mirrors the
   server-rendered markup in admin_account.ejs so a range change redraws the
   card exactly the way the page first painted it. */
function renderTechReportLog(m) {
    const rows = m.techReportLog || [];
    const total = m.reportsInRange != null
        ? m.reportsInRange
        : rows.reduce((sum, row) => sum + row.total, 0);

    const summary = document.getElementById('techReportLogSummary');
    if (summary) {
        const reportWord = total === 1 ? 'report' : 'reports';
        const techs = rows.length === 1 ? 'technician' : 'technicians';
        summary.textContent = `${total} ${reportWord} · ${rows.length} ${techs}`;
    }

    const wrap = document.getElementById('techReportLogWrap');
    if (!wrap) return;

    if (!rows.length) {
        wrap.innerHTML = '<p class="monitor-empty">No reports logged in this period.</p>';
        return;
    }

    const maxTotal = rows.reduce((max, row) => Math.max(max, row.total), 0);
    let html = '<div class="tech-report-chart" id="techReportLogChart">';
    rows.forEach((row, i) => {
        const pct = maxTotal > 0 ? ((row.total / maxTotal) * 100).toFixed(2) : 0;
        const resolved = row.resolved || 0;
        const unresolved = row.unresolved != null ? row.unresolved : row.total - resolved;
        html += `<div class="tech-report-row${i === 0 ? ' tech-report-row--top' : ''}">
            <div class="tech-report-head">
                <strong>${escapeHtml(row.name)}</strong>
                <span>
                    <span class="tech-report-split">
                        <span class="is-resolved" title="Resolved">${resolved} resolved</span>
                        <span class="is-unresolved" title="Unresolved">${unresolved} unresolved</span>
                    </span>
                    <span class="tech-report-total" title="${escapeHtml(row.name)} is named on ${row.total} of the ${total} reports">${row.total}</span>
                </span>
            </div>
            <div class="tech-report-track">
                <span class="tech-report-fill" style="width: ${pct}%">
                    <span class="tech-report-seg tech-report-seg--resolved" style="flex: ${resolved} 1 0"></span>
                    <span class="tech-report-seg tech-report-seg--unresolved" style="flex: ${unresolved} 1 0"></span>
                </span>
            </div>
        </div>`;
    });
    html += '</div>';
    wrap.innerHTML = html;
}


/* Repair Parts Monitoring: parts used on Repair activities in the selected
   range, ranked by use and grouped by unit type. Mirrors the server-rendered
   markup in admin_account.ejs. */
function renderRepairParts(usage) {
    const data = usage || { groups: [], repairs: 0, totalUsed: 0 };
    const groups = data.groups || [];
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    const summary = document.getElementById('repairPartsSummary');
    if (summary) summary.textContent = `${plural(data.totalUsed || 0, 'part', 'parts')} used · ${plural(data.repairs || 0, 'repair', 'repairs')}`;

    const list = document.getElementById('repairPartsList');
    if (!list) return;
    if (!groups.length) {
        list.innerHTML = '<p class="monitor-empty">No parts used on repairs in this period.</p>';
        return;
    }

    list.innerHTML = groups.map(group => {
        const max = group.parts.length ? group.parts[0].count : 0;
        const rows = group.parts.map((part, i) => {
            const models = (part.models || []).map(m => `${m.model} (${m.count})`).join(', ');
            const title = `${part.name}: used on ${plural(part.count, 'repair', 'repairs')}${models ? ` · ${models}` : ''}`;
            const pct = max > 0 ? ((part.count / max) * 100).toFixed(2) : 0;
            return `<li class="rp-row${i === 0 ? ' rp-row--top' : ''}" title="${escapeHtml(title)}">
                <span class="rp-rank">${i + 1}</span>
                <span class="rp-name">${escapeHtml(part.name)}</span>
                <span class="rp-track"><span class="rp-fill" style="width: ${pct}%"></span></span>
                <span class="rp-count">${part.count}</span>
            </li>`;
        }).join('');
        return `<section class="rp-group">
            <div class="rp-group-head">
                <h4>${escapeHtml(group.unit)} Parts Distribution</h4>
                <span>${group.total} used · ${plural(group.repairs, 'repair', 'repairs')}</span>
            </div>
            <ol class="rp-list">${rows}</ol>
        </section>`;
    }).join('');
}

// Sync the KPIs/charts to whichever range the dropdown defaults to on page load
// (server-rendered numbers are always "All Time" — this brings them in line).
(function initMonitorDefaultRange() {
    const sel = document.getElementById('monitorDateRange');
    if (sel) onMonitorRangeChange(sel.value);
})();

initInstallBaseTips();

/* ══════════════════════════════════════
   TECHNICIAN HISTORY
   ══════════════════════════════════════ */

let techHistory = window.technicianHistoryData || { rows: [], technicians: [] };
let techHistorySelected = null;
let techHistoryLoading = false;

function isTechHistoryOpen() {
    const section = document.getElementById('section-tech-history');
    return Boolean(section && section.classList.contains('active'));
}

// Pulls the latest records so edits made elsewhere (e.g. adding a technician to
// a report on a client page) appear without reloading the admin page.
async function refreshTechHistory() {
    if (techHistoryLoading) return;
    techHistoryLoading = true;
    try {
        const res = await fetch('/admin_account/tech-history-data', { headers: { Accept: 'application/json' } });
        const json = await res.json();
        if (!res.ok || !json.ok) return;

        techHistory = json.technicianHistory;
        document.getElementById('techHistoryTechCount').textContent = techHistory.technicians.length;
        document.getElementById('techHistoryRowCount').textContent = techHistory.rows.length;
        renderTechHistoryList();
        filterTechHistoryList();

        // Keep an open technician open, re-pointed at their refreshed entry.
        if (techHistorySelected) {
            const key = techHistorySelected.name.toLowerCase();
            const index = techHistory.technicians.findIndex(t => t.name.toLowerCase() === key);
            if (index >= 0) {
                techHistorySelected = techHistory.technicians[index];
                updateTechHistoryMeta(techHistorySelected);
                renderTechHistoryRows();
            } else {
                closeTechHistory();
            }
        }
    } catch (err) {
        console.error('[tech history refresh]', err);
    } finally {
        techHistoryLoading = false;
    }
}

document.querySelectorAll('[data-section="tech-history"]').forEach(btn => {
    btn.addEventListener('click', refreshTechHistory);
});

window.addEventListener('focus', () => {
    if (isTechHistoryOpen()) refreshTechHistory();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isTechHistoryOpen()) refreshTechHistory();
});

// Just the record count — no name, date or avatar, to keep the detail header
// simple; the name is already visible from the card you clicked to get here.
function updateTechHistoryMeta(tech) {
    const meta = document.getElementById('techHistoryMeta');
    if (meta) meta.textContent = `${tech.count} record${tech.count === 1 ? '' : 's'}`;
}

function renderTechHistoryList() {
    const grid = document.getElementById('techHistoryGrid');
    if (!grid) return;

    if (!techHistory.technicians.length) {
        grid.innerHTML = '<p class="monitor-empty-state">No technician work with an SMR date has been recorded yet.</p>';
        return;
    }

    grid.innerHTML = techHistory.technicians.map((tech, index) => `
        <button type="button" class="tech-history-card" data-name="${escapeHtml(tech.name.toLowerCase())}"
            onclick="openTechHistory(${index})">
            <div class="tech-history-card-body">
                <strong>${escapeHtml(tech.name)}</strong>
                <small>Latest: ${escapeHtml(tech.latestDate || '—')}</small>
            </div>
            <span class="tech-history-count">${tech.count}</span>
        </button>
    `).join('');
}

function filterTechHistoryList() {
    const query = normalizeMonitoringText(document.getElementById('techHistorySearch').value);
    let visible = 0;
    document.querySelectorAll('#techHistoryGrid .tech-history-card').forEach(card => {
        const match = !query || card.dataset.name.includes(query);
        card.hidden = !match;
        if (match) visible += 1;
    });
    document.getElementById('techHistoryNoTechs').hidden = visible > 0 || !techHistory.technicians.length;
}

function openTechHistory(index) {
    const tech = techHistory.technicians[index];
    if (!tech) return;
    techHistorySelected = tech;

    updateTechHistoryMeta(tech);
    document.getElementById('techHistoryRowSearch').value = '';

    document.getElementById('techHistoryListView').hidden = true;
    document.getElementById('techHistoryDetailView').hidden = false;
    renderTechHistoryRows();
    window.scrollTo({ top: 0 });
}

function closeTechHistory() {
    techHistorySelected = null;
    document.getElementById('techHistoryDetailView').hidden = true;
    document.getElementById('techHistoryListView').hidden = false;
}

function renderTechHistoryRows() {
    const body = document.getElementById('techHistoryBody');
    if (!body || !techHistorySelected) return;

    const query = normalizeMonitoringText(document.getElementById('techHistoryRowSearch').value);
    const selectedKey = techHistorySelected.name.toLowerCase();

    // rowIndexes are already newest-first: the server sorts by SMR date descending.
    const rows = techHistorySelected.rowIndexes
        .map(i => techHistory.rows[i])
        .filter(row => row && (!query || normalizeMonitoringText(
            [row.client, row.serialNo, row.unit, row.model, row.activity, row.parts, row.problem, row.action, row.notes].join(' ')
        ).includes(query)));

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="monitor-empty-state">No records match that search.</td></tr>';
        return;
    }

    body.innerHTML = rows.map(row => {
        const details = [
            row.parts ? `Parts: ${row.parts}` : '',
            row.problem ? `Problem: ${row.problem}` : '',
            row.action ? `Action: ${row.action}` : '',
            row.notes && row.notes !== 'Service update' ? row.notes : ''
        ].filter(Boolean).map(escapeHtml).join('<br>') || '—';
        const others = row.technicians.filter(name => name.toLowerCase() !== selectedKey);

        return `
            <tr>
                <td class="monitor-date">${escapeHtml(row.date)}</td>
                <td>
                    <div class="monitor-cell-stack">
                        <strong>${escapeHtml(row.client)}</strong>
                        <code class="mono monitor-serial-chip">${escapeHtml(row.serialNo)}</code>
                    </div>
                </td>
                <td>
                    <div class="monitor-cell-stack">
                        <strong>${escapeHtml(row.unit)}</strong>
                        <small>${escapeHtml(row.model)}</small>
                    </div>
                </td>
                <td><span class="monitor-type-pill">${escapeHtml(row.activity)}</span></td>
                <td class="monitor-parts-list">${details}</td>
                <td class="monitor-parts-list">${others.length ? others.map(escapeHtml).join(', ') : '—'}</td>
            </tr>
        `;
    }).join('');
}

renderTechHistoryList();

/* ══════════════════════════════════════
   UNITS & MODELS
   ══════════════════════════════════════ */

// Same keys the server uses (lib/unit-catalog.js): the check here is only a
// hint while typing, the server re-checks every submit.
function umUnitKey(value) {
    const upper = String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
    return upper === 'P & A' ? 'P&A' : upper;
}

function umModelKey(value) {
    return String(value || '').toUpperCase().replace(/[\s-]+/g, '');
}

function checkUnitModelInput() {
    const unitInput = document.getElementById('umUnit');
    const modelInput = document.getElementById('umModel');
    const check = document.getElementById('umCheck');
    const submit = document.getElementById('umSubmit');
    if (!unitInput || !modelInput || !check || !submit) return;

    const index = Array.isArray(window.unitModelIndex) ? window.unitModelIndex : [];
    const unit = unitInput.value.trim();
    const modelKey = umModelKey(modelInput.value);
    const knownUnit = Array.from(document.querySelectorAll('#umUnitList option'))
        .map(option => option.value)
        .find(name => umUnitKey(name) === umUnitKey(unit));

    let message = '';
    let blocked = false;

    if (modelKey) {
        const conflict = index.find(entry => umModelKey(entry.model) === modelKey);
        if (conflict) {
            message = `Model "${conflict.model}" already exists under ${conflict.unit}. Each model can only exist once in the system.`;
            blocked = true;
        } else if (unit) {
            message = knownUnit
                ? `Will add model ${modelInput.value.trim().toUpperCase()} to ${knownUnit}.`
                : `Will add new unit "${unit}" with model ${modelInput.value.trim().toUpperCase()}.`;
        }
    } else if (unit) {
        if (knownUnit) {
            message = `Unit "${knownUnit}" already exists. Enter a model to add to it.`;
            blocked = true;
        } else {
            message = `Will add new unit "${unit}" with no models yet.`;
        }
    }

    check.textContent = message;
    check.classList.toggle('um-check-error', blocked);
    submit.disabled = blocked;
}

function filterUnitModels() {
    const query = normalizeMonitoringText(document.getElementById('umSearch').value);
    let visible = 0;
    document.querySelectorAll('#umList .um-unit').forEach(unit => {
        const unitMatch = !query || unit.dataset.unit.includes(query);
        let modelMatches = 0;
        unit.querySelectorAll('.um-chip').forEach(chip => {
            const match = unitMatch || chip.dataset.model.includes(query);
            chip.hidden = !match;
            if (match) modelMatches += 1;
        });
        const show = unitMatch || modelMatches > 0;
        unit.hidden = !show;
        if (show) visible += 1;
    });
    const empty = document.getElementById('umNoResults');
    if (empty) empty.hidden = visible > 0;
}

['umUnit', 'umModel'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', checkUnitModelInput);
});

document.querySelectorAll('.um-inline-form[data-confirm]').forEach(form => {
    form.addEventListener('submit', event => {
        if (!confirm(form.dataset.confirm)) event.preventDefault();
    });
});

/* ══════════════════════════════════════
   PARTS (admin only)
   ══════════════════════════════════════ */

(function () {
    const form = document.getElementById('partsForm');
    if (!form) return;
    const idInput = document.getElementById('partsId');
    const unitInput = document.getElementById('partsUnit');
    const numberInput = document.getElementById('partsNumber');
    const descInput = document.getElementById('partsDescription');
    const submitBtn = document.getElementById('partsSubmit');
    const cancelBtn = document.getElementById('partsCancel');
    const search = document.getElementById('partsSearch');
    const unitFilter = document.getElementById('partsUnitFilter');
    const empty = document.getElementById('partsNoResults');
    const rows = Array.from(document.querySelectorAll('#partsList .parts-row'));

    function applyFilter() {
        const q = search.value.trim().toLowerCase();
        const unit = unitFilter.value;
        let visible = 0;
        rows.forEach(row => {
            const show = (!q || row.dataset.search.includes(q)) && (!unit || row.dataset.unit.toLowerCase() === unit);
            row.hidden = !show;
            if (show) visible += 1;
        });
        if (empty) {
            empty.hidden = visible > 0;
            empty.textContent = rows.length ? 'No part matches that search.' : 'No parts yet. Add the first one above.';
        }
    }

    function resetForm() {
        idInput.value = '';
        form.reset();
        submitBtn.textContent = 'Add Part';
        cancelBtn.hidden = true;
    }

    search.addEventListener('input', applyFilter);
    unitFilter.addEventListener('change', applyFilter);
    cancelBtn.addEventListener('click', resetForm);

    rows.forEach(row => {
        row.querySelector('.parts-edit-btn').addEventListener('click', () => {
            idInput.value = row.dataset.id;
            unitInput.value = row.dataset.unit;
            numberInput.value = row.dataset.number;
            descInput.value = row.dataset.description;
            submitBtn.textContent = 'Save Changes';
            cancelBtn.hidden = false;
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            numberInput.focus();
        });
        row.querySelector('.um-inline-form').addEventListener('submit', event => {
            if (!confirm(row.querySelector('.um-inline-form').dataset.confirm)) event.preventDefault();
        });
    });
})();

/* ══════════════════════════════════════
   TRANSFER UNIT (admin only)
   ══════════════════════════════════════ */

const transferUnits = Array.isArray(window.transferMachines) ? window.transferMachines : [];
const transferClientOptions = Array.isArray(window.transferClientOptions) ? window.transferClientOptions : [];
// Enough to find a unit by serial; narrowing the search shows the rest.
const TRANSFER_ROW_LIMIT = 100;

// A suggestion picked from the dropdown filters by this exact client. Typing
// without picking one (or editing the text afterward) falls back to matching
// the typed text against each unit's client name.
let transferSelectedClientId = '';

function renderTransferRows() {
    const body = document.getElementById('transferBody');
    if (!body) return;

    const query = normalizeMonitoringText(document.getElementById('transferSearch').value);
    const clientText = normalizeMonitoringText(document.getElementById('transferClientFilter').value);

    const matches = transferUnits.filter(machine => {
        if (transferSelectedClientId) {
            if (machine.clientId !== transferSelectedClientId) return false;
        } else if (clientText && !normalizeMonitoringText(machine.clientName).includes(clientText)) {
            return false;
        }
        if (!query) return true;
        return normalizeMonitoringText(machine.serialNo).includes(query);
    });
    const shown = matches.slice(0, TRANSFER_ROW_LIMIT);

    body.innerHTML = shown.map(machine => `
        <tr>
            <td class="mono">${escapeHtml(machine.serialNo || '—')}${machine.disabledAt ? ' <span class="badge badge-disabled">Disabled</span>' : ''}</td>
            <td>${escapeHtml([machine.unit, machine.model].filter(Boolean).join(' / ') || '—')}</td>
            <td>${escapeHtml(machine.clientName || '—')}</td>
            <td>${escapeHtml(machine.dateInstalled || '—')}</td>
            <td class="transfer-action">
                <button type="button" class="btn btn-ghost btn-sm" onclick="openUnitTransfer(${Number(machine.id)})">Transfer</button>
                <button type="button" class="btn btn-ghost btn-sm ${machine.disabledAt ? 'btn-enable' : 'btn-disable'}" onclick="submitUnitDisable(${Number(machine.id)})">${machine.disabledAt ? 'Enable' : 'Disable'}</button>
            </td>
        </tr>
    `).join('');

    document.getElementById('transferNoResults').hidden = matches.length > 0;
    const more = document.getElementById('transferMore');
    more.hidden = matches.length <= TRANSFER_ROW_LIMIT;
    more.textContent = `Showing ${TRANSFER_ROW_LIMIT} of ${matches.length} units. Type more of the serial number to narrow the list.`;
}

/* Transfer Unit — client filter autocomplete (text field, suggestions only
   while typing; clicking into an empty/unchanged field shows nothing). */
const transferClientInput = document.getElementById('transferClientFilter');
const transferClientDropdown = document.getElementById('transferClientDropdown');
let transferClientFocusedIndex = -1;

function closeTransferClientDropdown() {
    if (!transferClientDropdown) return;
    transferClientDropdown.classList.remove('open');
    transferClientFocusedIndex = -1;
}

function renderTransferClientDropdown() {
    if (!transferClientInput || !transferClientDropdown) return;

    const query = normalizeMonitoringText(transferClientInput.value);
    if (!query) {
        closeTransferClientDropdown();
        return;
    }

    const options = transferClientOptions
        .filter(client => normalizeMonitoringText(client.name).includes(query))
        .slice(0, 20);

    if (!options.length) {
        transferClientDropdown.innerHTML = '<li class="transfer-client-empty">No matching client.</li>';
        transferClientDropdown.classList.add('open');
        return;
    }

    transferClientDropdown.innerHTML = options.map((client, index) =>
        `<li class="transfer-client-item${index === transferClientFocusedIndex ? ' is-active' : ''}" data-id="${escapeHtml(client.id)}" data-name="${escapeHtml(client.name)}">${escapeHtml(client.name)}</li>`
    ).join('');
    transferClientDropdown.classList.add('open');

    transferClientDropdown.querySelectorAll('.transfer-client-item').forEach(item => {
        item.addEventListener('mousedown', event => {
            // mousedown (not click) fires before the input's blur, so the
            // selection lands before the dropdown would otherwise close.
            event.preventDefault();
            pickTransferClient(item.dataset.id, item.dataset.name);
        });
    });
}

function pickTransferClient(id, name) {
    transferSelectedClientId = id;
    transferClientInput.value = name;
    closeTransferClientDropdown();
    renderTransferRows();
}

if (transferClientInput) {
    transferClientInput.addEventListener('input', () => {
        // Any edit invalidates a prior exact selection — fall back to
        // substring matching until a suggestion is picked again.
        transferSelectedClientId = '';
        transferClientFocusedIndex = -1;
        renderTransferClientDropdown();
        renderTransferRows();
    });

    // Clicking into the field (no typing) must not show suggestions.
    transferClientInput.addEventListener('focus', () => {
        closeTransferClientDropdown();
    });

    transferClientInput.addEventListener('keydown', event => {
        if (!transferClientDropdown || !transferClientDropdown.classList.contains('open')) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                renderTransferClientDropdown();
            }
            return;
        }

        const items = Array.from(transferClientDropdown.querySelectorAll('.transfer-client-item'));
        if (!items.length) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            transferClientFocusedIndex = Math.min(transferClientFocusedIndex + 1, items.length - 1);
            renderTransferClientDropdown();
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            transferClientFocusedIndex = Math.max(transferClientFocusedIndex - 1, 0);
            renderTransferClientDropdown();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (transferClientFocusedIndex >= 0 && items[transferClientFocusedIndex]) {
                const picked = items[transferClientFocusedIndex];
                pickTransferClient(picked.dataset.id, picked.dataset.name);
            }
            return;
        }
        if (event.key === 'Escape') {
            closeTransferClientDropdown();
        }
    });
}

document.addEventListener('click', event => {
    if (!transferClientInput || !transferClientDropdown) return;
    if (!event.target.closest('.transfer-client-autocomplete')) {
        closeTransferClientDropdown();
    }
});

/* Disable / Enable a unit. A disabled unit keeps its serial and history but
   stops counting as installed; the server flips whichever state it is in. */
function submitUnitDisable(machineId) {
    const machine = transferUnits.find(m => Number(m.id) === machineId);
    if (!machine) return;

    const enabling = Boolean(machine.disabledAt);
    const label = machine.serialNo || 'this unit';
    const message = enabling
        ? `Enable ${label}? It will count as an installed unit again.`
        : `Disable ${label}? It will no longer count as an installed unit. Its history is kept and you can enable it again later.`;
    if (!confirm(message)) return;

    document.getElementById('unitDisableMachineId').value = machine.id;
    document.getElementById('unitDisableAction').value = enabling ? 'enable' : 'disable';
    document.getElementById('form-unit-disable').submit();
}

function openUnitTransfer(machineId) {
    const machine = transferUnits.find(m => Number(m.id) === machineId);
    if (!machine) return;

    document.getElementById('transferMachineId').value = machine.id;
    document.getElementById('transferFromClientId').value = machine.clientId;
    document.getElementById('transferSerial').textContent = machine.serialNo || '—';
    document.getElementById('transferUnitModel').textContent = [machine.unit, machine.model].filter(Boolean).join(' / ') || '—';
    document.getElementById('transferFromName').textContent = machine.clientName || '—';

    // The unit's own client is not a destination.
    const select = document.getElementById('transferToClient');
    select.value = '';
    Array.from(select.options).forEach(option => {
        option.disabled = Boolean(option.value) && option.value === machine.clientId;
    });

    updateTransferPreview();
    openModal('modal-unit-transfer');
}

function updateTransferPreview() {
    const select = document.getElementById('transferToClient');
    const preview = document.getElementById('transferPreview');
    const submit = document.getElementById('transferSubmit');
    const option = select.options[select.selectedIndex];
    const chosen = Boolean(select.value) && option && !option.disabled;

    preview.textContent = chosen
        ? `${document.getElementById('transferSerial').textContent} will move from ${document.getElementById('transferFromName').textContent} to ${option.textContent.trim()}.`
        : '';
    submit.disabled = !chosen;
}

const unitTransferForm = document.getElementById('unitTransferForm');
if (unitTransferForm) {
    unitTransferForm.addEventListener('submit', event => {
        const submit = document.getElementById('transferSubmit');
        if (submit.disabled) {
            event.preventDefault();
            return;
        }
        // One click, one move — the server also refuses a second move of the same row.
        submit.disabled = true;
        submit.textContent = 'Moving…';
    });
}

renderTransferRows();

/* ── SCHEDULING ── */
const scheduleRows = Array.isArray(window.scheduleRows) ? window.scheduleRows : [];
const scheduleClients = Array.isArray(window.scheduleClients) ? window.scheduleClients : [];
const SCHEDULE_STATUS_LABELS = { scheduled: 'Scheduled', done: 'Done', cancelled: 'Cancelled', closed: 'Closed' };
let scheduleFilter = 'upcoming';

// The browser's own date, so "today" matches the admin's calendar, not the server's.
function localIsoDate(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatScheduleDate(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return iso || '—';
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatScheduleTime(hhmm) {
    if (!hhmm) return '';
    const [h, min] = hhmm.split(':').map(Number);
    return new Date(2000, 0, 1, h, min).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderSchedules() {
    const body = document.getElementById('scheduleBody');
    if (!body) return;

    const today = localIsoDate();
    const query = normalizeMonitoringText(document.getElementById('scheduleSearch').value);

    document.getElementById('schedStatToday').textContent =
        scheduleRows.filter(row => row.date === today && row.status !== 'cancelled').length;
    document.getElementById('schedStatUpcoming').textContent =
        scheduleRows.filter(row => row.date > today && row.status === 'scheduled').length;
    document.getElementById('schedStatDone').textContent =
        scheduleRows.filter(row => row.status === 'done').length;

    let rows = scheduleRows.filter(row => {
        if (scheduleFilter === 'upcoming' && row.date < today) return false;
        if (scheduleFilter === 'past' && row.date >= today) return false;
        if (!query) return true;
        return [row.technicianName, row.clientName, row.location, row.description]
            .some(value => normalizeMonitoringText(value).includes(query));
    });
    // Past reads newest first; everything else soonest first (server order).
    if (scheduleFilter === 'past') rows = rows.slice().reverse();
    // Open work first (including Closed ones, which still need a look), then
    // Done, then Cancelled at the bottom. Array.sort is stable, so each group
    // keeps the date order above.
    const statusRank = { scheduled: 0, done: 1, cancelled: 2 };
    rows = rows.slice().sort((x, y) => (statusRank[x.status] ?? 0) - (statusRank[y.status] ?? 0));

    body.innerHTML = rows.map(row => {
        const id = Number(row.id);
        // A schedule still open after its day is Closed: the technician's log
        // is what completes it, and only on the day itself.
        const displayStatus = row.status === 'scheduled' && row.date < today ? 'closed' : row.status;
        const statusClass = displayStatus === 'done' ? 'badge-active'
            : displayStatus === 'cancelled' ? 'badge-inactive'
            : displayStatus === 'closed' ? 'badge-closed'
            : 'badge-scheduled';
        // A completed schedule is a record of finished work: delete is all that's left.
        const statusButtons = row.status === 'done' ? ''
            : row.status === 'scheduled'
            ? `<button type="button" class="btn btn-ghost btn-sm btn-enable" onclick="submitScheduleStatus(${id}, 'done')">Done</button>
               <button type="button" class="btn btn-ghost btn-sm btn-disable" onclick="submitScheduleStatus(${id}, 'cancelled')">Cancel</button>`
            : `<button type="button" class="btn btn-ghost btn-sm" onclick="submitScheduleStatus(${id}, 'scheduled')">Reopen</button>`;
        return `
        <tr class="${row.status === 'cancelled' ? 'schedule-row-cancelled' : ''}">
            <td class="schedule-when">
                <strong>${escapeHtml(formatScheduleDate(row.date))}</strong>
                <small>${escapeHtml(formatScheduleTime(row.time) || 'Any time')}${row.date === today ? ' <span class="badge badge-today">Today</span>' : ''}</small>
            </td>
            <td>${escapeHtml(row.technicianName)}</td>
            <td>
                <strong>${escapeHtml(row.clientName)}</strong>
                <small class="schedule-location">${escapeHtml(row.location || '—')}</small>
            </td>
            <td class="schedule-desc">${escapeHtml(row.description)}</td>
            <td><span class="badge ${statusClass}">${SCHEDULE_STATUS_LABELS[displayStatus] || escapeHtml(displayStatus)}</span></td>
            <td>
                <div class="action-btns schedule-actions">
                    ${row.status === 'done' ? '' : `<button type="button" class="icon-btn icon-edit" title="Edit" onclick="openScheduleForm(${id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>`}
                    ${statusButtons}
                    <button type="button" class="icon-btn icon-disable" title="Delete" onclick="submitScheduleDelete(${id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');

    const empty = document.getElementById('scheduleNoResults');
    empty.hidden = rows.length > 0;
    empty.textContent = query ? 'No schedule matches that search.'
        : scheduleFilter === 'past' ? 'No past schedules.'
        : 'Nothing scheduled yet. Use New Schedule to assign a technician.';
}

function setScheduleFilter(filter, el) {
    scheduleFilter = filter;
    document.querySelectorAll('#scheduleFilterTabs .filter-tab').forEach(tab => tab.classList.remove('active'));
    el.classList.add('active');
    renderSchedules();
}

/* Technician field: type to search, pick a name from the suggestions. Only a
   picked (or exactly typed) name fills the hidden username the server needs. */
const scheduleTechnicians = Array.isArray(window.scheduleTechnicians) ? window.scheduleTechnicians : [];
const SCHEDULE_TECH_SUGGESTION_LIMIT = 8;
let scheduleTechMatches = [];
let scheduleTechActiveIndex = -1;

function setScheduleTechnician(tech) {
    const input = document.getElementById('scheduleTechnician');
    input.value = tech ? tech.fullName : '';
    if (tech) input.dataset.lockedName = tech.fullName;
    else delete input.dataset.lockedName;
    document.getElementById('scheduleTechnicianUsername').value = tech ? tech.username : '';
    document.getElementById('scheduleTechnician').setCustomValidity('');
    document.getElementById('scheduleTechnicianHint').textContent = '';
    closeScheduleTechDropdown();
}

function closeScheduleTechDropdown() {
    const dropdown = document.getElementById('scheduleTechnicianDropdown');
    if (!dropdown) return;
    dropdown.classList.remove('open');
    document.getElementById('scheduleTechnician').setAttribute('aria-expanded', 'false');
    scheduleTechActiveIndex = -1;
}

function renderScheduleTechDropdown() {
    const input = document.getElementById('scheduleTechnician');
    const dropdown = document.getElementById('scheduleTechnicianDropdown');
    const query = normalizeMonitoringText(input.value);
    if (!query) {
        scheduleTechMatches = [];
        closeScheduleTechDropdown();
        return;
    }

    // Names that start with the query first, then any other name containing it.
    const startsWith = [];
    const contains = [];
    scheduleTechnicians.forEach(tech => {
        const name = normalizeMonitoringText(tech.fullName);
        if (name.startsWith(query) || name.split(/\s+/).some(part => part.startsWith(query))) startsWith.push(tech);
        else if (name.includes(query)) contains.push(tech);
    });
    scheduleTechMatches = startsWith.concat(contains).slice(0, SCHEDULE_TECH_SUGGESTION_LIMIT);

    dropdown.innerHTML = scheduleTechMatches.length
        ? scheduleTechMatches.map((tech, index) =>
            `<li class="transfer-client-item${index === scheduleTechActiveIndex ? ' is-active' : ''}" role="option" data-index="${index}">${escapeHtml(tech.fullName)}</li>`
        ).join('')
        : '<li class="transfer-client-empty">No technician matches that name.</li>';
    dropdown.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
}

function syncScheduleTechnician() {
    const input = document.getElementById('scheduleTechnician');
    const hidden = document.getElementById('scheduleTechnicianUsername');
    const key = normalizeMonitoringText(input.value);
    const exact = scheduleTechnicians.find(tech => normalizeMonitoringText(tech.fullName) === key);
    if (exact) hidden.value = exact.username;
    // Keep an edited schedule's original (possibly inactive) technician while
    // the name is untouched; any other text without a pick is invalid.
    const valid = Boolean(hidden.value) && (exact || input.dataset.lockedName === input.value);
    if (!valid) hidden.value = '';
    const invalid = Boolean(key) && !hidden.value;
    input.setCustomValidity(invalid ? 'Pick a technician from the list.' : '');
    document.getElementById('scheduleTechnicianHint').textContent = invalid ? 'Pick a technician from the list.' : '';
}

const scheduleTechInput = document.getElementById('scheduleTechnician');
if (scheduleTechInput) {
    const dropdown = document.getElementById('scheduleTechnicianDropdown');

    scheduleTechInput.addEventListener('input', () => {
        document.getElementById('scheduleTechnicianUsername').value = '';
        delete scheduleTechInput.dataset.lockedName;
        scheduleTechInput.setCustomValidity('');
        document.getElementById('scheduleTechnicianHint').textContent = '';
        scheduleTechActiveIndex = -1;
        renderScheduleTechDropdown();
    });

    scheduleTechInput.addEventListener('keydown', event => {
        const open = dropdown.classList.contains('open');
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!open) renderScheduleTechDropdown();
            if (!scheduleTechMatches.length) return;
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            scheduleTechActiveIndex = (scheduleTechActiveIndex + step + scheduleTechMatches.length) % scheduleTechMatches.length;
            renderScheduleTechDropdown();
        } else if (event.key === 'Enter' && open) {
            // Enter picks the highlighted (or only) suggestion instead of submitting.
            const pick = scheduleTechMatches[scheduleTechActiveIndex] || (scheduleTechMatches.length === 1 ? scheduleTechMatches[0] : null);
            if (pick) {
                event.preventDefault();
                setScheduleTechnician(pick);
            }
        } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            closeScheduleTechDropdown();
        }
    });

    // mousedown, not click: it fires before the input's blur closes the list.
    dropdown.addEventListener('mousedown', event => {
        const item = event.target.closest('[data-index]');
        if (!item) return;
        event.preventDefault();
        setScheduleTechnician(scheduleTechMatches[Number(item.dataset.index)]);
    });

    scheduleTechInput.addEventListener('blur', () => {
        closeScheduleTechDropdown();
        syncScheduleTechnician();
    });
}


function findScheduleClientByName(name) {
    const key = normalizeMonitoringText(name);
    return scheduleClients.find(client => normalizeMonitoringText(client.name) === key) || null;
}

// The client field is a searchable text box; only an exact match to a listed
// client fills the hidden id the server needs. Picking a client fills its
// usual location, which the admin can still change for a different site.
function syncScheduleClient() {
    const input = document.getElementById('scheduleClient');
    const hint = document.getElementById('scheduleClientHint');
    const idField = document.getElementById('scheduleClientId');
    const client = findScheduleClientByName(input.value);
    const previousId = idField.value;

    idField.value = client ? client.id : '';
    const invalid = Boolean(input.value.trim()) && !client;
    input.setCustomValidity(invalid ? 'Pick a client from the list.' : '');
    hint.textContent = invalid ? 'Pick a client from the list.' : '';

    if (client && client.id !== previousId) {
        document.getElementById('scheduleLocation').value = client.location || '';
    }
}

function openScheduleForm(id) {
    const row = id ? scheduleRows.find(r => Number(r.id) === Number(id)) : null;
    document.getElementById('scheduleForm').reset();

    document.getElementById('scheduleModalTitle').textContent = row ? 'Edit Schedule' : 'New Schedule';
    document.getElementById('scheduleId').value = row ? row.id : '';
    document.getElementById('scheduleClientId').value = row ? row.clientId : '';
    document.getElementById('scheduleClient').value = row ? row.clientName : '';
    document.getElementById('scheduleClient').setCustomValidity('');
    document.getElementById('scheduleClientHint').textContent = '';
    document.getElementById('scheduleLocation').value = row ? row.location : '';
    // No scheduling in the past: the picker starts at today. An existing
    // schedule already on a past date keeps that date selectable, so it can
    // still be edited without moving it (the server allows the same).
    const dateInput = document.getElementById('scheduleDate');
    const today = localIsoDate();
    dateInput.min = row && row.date < today ? row.date : today;
    dateInput.value = row ? row.date : today;
    dateInput.setCustomValidity('');
    document.getElementById('scheduleTime').value = row ? row.time : '';
    document.getElementById('scheduleDescription').value = row ? row.description : '';

    // Editing keeps the saved technician even if they have since been
    // deactivated; the server refuses the save and says so, rather than the
    // field silently blanking.
    setScheduleTechnician(row ? { username: row.technicianUsername, fullName: row.technicianName } : null);

    const submit = document.getElementById('scheduleSubmit');
    submit.disabled = false;
    submit.textContent = row ? 'Save Changes' : 'Save Schedule';
    openModal('modal-schedule');
}

function submitScheduleStatus(id, status) {
    const row = scheduleRows.find(r => Number(r.id) === Number(id));
    if (!row) return;
    if (status === 'cancelled' && !confirm(`Cancel ${row.technicianName}'s schedule at ${row.clientName} on ${formatScheduleDate(row.date)}?`)) return;
    document.getElementById('scheduleStatusId').value = id;
    document.getElementById('scheduleStatusValue').value = status;
    document.getElementById('form-schedule-status').submit();
}

function submitScheduleDelete(id) {
    const row = scheduleRows.find(r => Number(r.id) === Number(id));
    if (!row) return;
    if (!confirm(`Delete ${row.technicianName}'s schedule at ${row.clientName} on ${formatScheduleDate(row.date)}? This cannot be undone.`)) return;
    document.getElementById('scheduleDeleteId').value = id;
    document.getElementById('form-schedule-delete').submit();
}

const scheduleForm = document.getElementById('scheduleForm');
if (scheduleForm) {
    // A typed date can slip past the picker's minimum; say why it's refused.
    const scheduleDateInput = document.getElementById('scheduleDate');
    scheduleDateInput.addEventListener('input', () => {
        const tooEarly = Boolean(scheduleDateInput.value && scheduleDateInput.min && scheduleDateInput.value < scheduleDateInput.min);
        scheduleDateInput.setCustomValidity(tooEarly ? 'A schedule date cannot be in the past. Pick today or a later date.' : '');
    });

    scheduleForm.addEventListener('submit', event => {
        syncScheduleTechnician();
        if (!document.getElementById('scheduleTechnicianUsername').value) {
            event.preventDefault();
            const techInput = document.getElementById('scheduleTechnician');
            techInput.setCustomValidity('Pick a technician from the list.');
            techInput.reportValidity();
            return;
        }
        syncScheduleClient();
        if (!document.getElementById('scheduleClientId').value) {
            event.preventDefault();
            document.getElementById('scheduleClient').reportValidity();
            return;
        }
        const submit = document.getElementById('scheduleSubmit');
        submit.disabled = true;
        submit.textContent = 'Saving…';
    });
}

renderSchedules();
