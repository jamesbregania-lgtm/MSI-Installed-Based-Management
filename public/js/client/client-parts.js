function getPartsCatalogLocation(record) {
    const catalog = window.PARTS_CATALOG || (typeof PARTS_CATALOG !== 'undefined' ? PARTS_CATALOG : {});
    const unitKey = Object.keys(catalog).find(
        key => key.toUpperCase() === (record?.unit || '').toUpperCase().trim()
    ) || '';
    
    // We don't filter by model anymore, just return unitKey
    return { unitKey, modelKey: '', modelMap: catalog[unitKey] || {} };
}

function getMaintenanceAnchorDate(dateInstalled, record) {
    let anchorDate = null;

    if (record?.maintenanceServiceDate) {
        anchorDate = parseDateStr(record.maintenanceServiceDate);
    }

    if (!anchorDate) {
        anchorDate = parseDateStr(dateInstalled);
    }

    return anchorDate;
}

function isAdHocActivity(record) {
    const type = String(record?.activityType || '').trim().toLowerCase();
    return type === 'pull out' || type === 'cannibalize';
}

// Mirror of LEGACY_INSTALL_CUTOFF in routes/admin.routes.js. Installs older than
// this have no service paperwork behind them, so their long-expired clock is
// treated as closed instead of warned about. Monitoring already counts them as
// complete; without the same rule here the row would contradict it with a
// warning icon. Keep both copies in step.
const LEGACY_INSTALL_CUTOFF = new Date(2026, 0, 1);

function isLegacyUndocumentedUnit(dateInstalled, record) {
    const installed = parseDateStr(dateInstalled);
    if (!installed || installed >= LEGACY_INSTALL_CUTOFF) {
        return false;
    }
    const serviced = parseDateStr(record?.maintenanceServiceDate);
    return !serviced || serviced < LEGACY_INSTALL_CUTOFF;
}

function calculateNextMaintenanceResult(dateInstalled, runningHoursSeconds, record, maintenanceIntervalDays = 750) {
    if (isAdHocActivity(record)) {
        return { label: '\u2014', date: null };
    }

    const anchorDate = getMaintenanceAnchorDate(dateInstalled, record);

    if (!anchorDate) {
        return { label: '\u2014', date: null };
    }

    // Calculate maintenance date from the most recent maintenance anchor.
    const maintenanceDate = new Date(anchorDate);
    maintenanceDate.setDate(anchorDate.getDate() + maintenanceIntervalDays);

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const label = `${monthNames[maintenanceDate.getMonth()]} ${maintenanceDate.getDate()}, ${maintenanceDate.getFullYear()}`;

    return { label, date: maintenanceDate };
}

function getMaintenanceStatus(dateInstalled, runningHoursSeconds, record, warningDays = 30) {
    if (isAdHocActivity(record)) {
        return {
            date: null,
            isOverdue: false,
            isDueSoon: false,
            label: '\u2014'
        };
    }

    const result = calculateNextMaintenanceResult(dateInstalled, runningHoursSeconds, record);
    if (!result.date) {
        return {
            date: null,
            isOverdue: false,
            isDueSoon: false,
            label: '\u2014'
        };
    }

    // The due date itself still shows — only the warning is withdrawn.
    if (isLegacyUndocumentedUnit(dateInstalled, record)) {
        return {
            date: result.date,
            isOverdue: false,
            isDueSoon: false,
            label: result.label
        };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((result.date - today) / (1000 * 60 * 60 * 24));

    return {
        date: result.date,
        isOverdue: diffDays < 0,
        isDueSoon: diffDays >= 0 && diffDays <= warningDays,
        label: result.label
    };
}

function calculateNextMaintenance(dateInstalled, runningHoursSeconds, record) {
    return calculateNextMaintenanceResult(dateInstalled, runningHoursSeconds, record).label;
}

// Returns true if maintenance is overdue or within the next 30 calendar days
// Fix: Use Math.floor instead of Math.ceil for more accurate "within 30 days" calculation
function isWithin30Days(dateInstalled, runningHoursSeconds, record) {
    const s = getMaintenanceStatus(dateInstalled, runningHoursSeconds, record, 30);
    return s.isOverdue || s.isDueSoon;
}

// Parts carry no due date or hour limit of their own: preventive maintenance
// (above) is the only clock on a unit. Parts Replacement just records which
// parts were swapped on a visit.

// Hardcoded catalog removed, it now comes dynamically from Supabase
