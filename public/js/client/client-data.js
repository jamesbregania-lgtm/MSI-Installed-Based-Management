function ensureRunningSeconds(record) {
    if (record && typeof record._runningSeconds !== 'number') {
        record._runningSeconds = parseRunningHoursToSeconds(record.runningHours);
    }
    return record ? record._runningSeconds : 0;
}

// Maintenance date is the only trigger — parts expiry no longer flags a unit here.
function isWarningRecord(record) {
    if (!record || typeof record !== 'object') return false;
    ensureRunningSeconds(record);
    return isWithin30Days(record.dateInstalled, record._runningSeconds, record);
}

function splitRecordsByWarning(records) {
    const warnings = [];
    const normal = [];
    records.forEach(record => {
        if (isWarningRecord(record)) {
            warnings.push(record);
        } else {
            normal.push(record);
        }
    });
    return { warnings, normal };
}

function getOrderedRecords(records) {
    const { warnings, normal } = splitRecordsByWarning(records);
    return warnings.concat(normal);
}

function orderMachinesNewestFirst(records) {
    if (!Array.isArray(records)) return [];
    return records.slice().map(record => {
        ensureRunningSeconds(record);
        return record;
    }).sort((left, right) => {
        const leftWarning = isWarningRecord(left) ? 1 : 0;
        const rightWarning = isWarningRecord(right) ? 1 : 0;

        if (leftWarning !== rightWarning) {
            return rightWarning - leftWarning;
        }

        const leftSortValue = getMachineSortValue(left);
        const rightSortValue = getMachineSortValue(right);

        if (leftSortValue !== rightSortValue) {
            return rightSortValue - leftSortValue;
        }

        return String(right.serialNo || '').localeCompare(String(left.serialNo || ''));
    });
}

function getMachineSortValue(record) {
    if (!record || typeof record !== 'object') return 0;

    const updateDates = Array.isArray(record.updates)
        ? record.updates
            .map(update => parseDateStr(update && update.date))
            .filter(Boolean)
            .map(date => date.getTime())
        : [];
    const reportDates = Array.isArray(record.reports)
        ? record.reports
            .map(report => parseDateStr(report && report.date))
            .filter(Boolean)
            .map(date => date.getTime())
        : [];
    const installedDate = parseDateStr(record.dateInstalled);
    const allDates = updateDates.concat(reportDates);
    if (installedDate) {
        allDates.push(installedDate.getTime());
    }

    return allDates.length ? Math.max(...allDates) : 0;
}

function findMachineIndexByRecord(record) {
    if (!record || !Array.isArray(allMachines)) return -1;
    const idx = allMachines.findIndex(r =>
        (r.serialNo || '') === (record.serialNo || '') &&
        (r.model || '') === (record.model || '') &&
        (r.dateInstalled || '') === (record.dateInstalled || '')
    );
    return idx >= 0 ? idx : -1;
}
