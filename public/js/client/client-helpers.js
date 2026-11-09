// Format for date display
function formatDateDisplay(dateStr) {
    if (!dateStr) return '\u2014';
    const rawDate = String(dateStr).trim();
    const monthNames = [
        'January','February','March','April','May','June',
        'July','August','September','October','November','December'
    ];
    const ymdMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
        const year = parseInt(ymdMatch[1], 10);
        const month = parseInt(ymdMatch[2], 10);
        const day = parseInt(ymdMatch[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${monthNames[month - 1]} ${day}, ${year}`;
        }
    }
    const dmyMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
        const day = parseInt(dmyMatch[1], 10);
        const month = parseInt(dmyMatch[2], 10);
        const year = parseInt(dmyMatch[3], 10);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${monthNames[month - 1]} ${day}, ${year}`;
        }
    }
    const date = new Date(rawDate);
    if (!Number.isNaN(date.getTime())) {
        return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }
    return rawDate;
}

function parseRunningHoursToSeconds(value) {
    if (value == null || value === '') return 0;
    let text = String(value).trim();
    const colonParts = text.split(':').map(part => part.trim());
    if (colonParts.length >= 2 && colonParts.every(part => /^\d+$/.test(part))) {
        let seconds = 0;
        if (colonParts.length === 3) {
            seconds = Number(colonParts[0]) * 3600 + Number(colonParts[1]) * 60 + Number(colonParts[2]);
        } else if (colonParts.length === 2) {
            seconds = Number(colonParts[0]) * 60 + Number(colonParts[1]);
        }
        return seconds;
    }
    if (!Number.isNaN(Number(text))) {
        return Math.round(Number(text) * 3600);
    }
    return 0;
}

function formatRunningHoursOnly(seconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hrs = Math.floor(totalSeconds / 3600);
    return String(hrs);
}

// Helper: parse a date string (dd/mm/yyyy or yyyy-mm-dd) into a Date object
function parseDateStr(dateStr) {
    if (!dateStr) return null;
    const rawDate = String(dateStr).trim();
    const dmyMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
        const d = new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10));
        return isNaN(d.getTime()) ? null : d;
    }
    const ymdMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
        const d = new Date(parseInt(ymdMatch[1], 10), parseInt(ymdMatch[2], 10) - 1, parseInt(ymdMatch[3], 10));
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function getTodayDateString() {
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`;
}

// Helper function to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
        return c;
    });
}

function clonePartMap(map) {
    if (!map || typeof map !== 'object') return {};
    return { ...map };
}

function cloneReportEntry(report) {
    if (!report || typeof report !== 'object') return null;
    return {
        ...report,
        technicians: Array.isArray(report.technicians) ? report.technicians.map(name => String(name || '')) : []
    };
}

function cloneUpdateEntry(update) {
    if (!update || typeof update !== 'object') return {};
    return {
        ...update,
        partsUpdated: Array.isArray(update.partsUpdated) ? update.partsUpdated.map(name => String(name || '')) : [],
        partServiceDates: clonePartMap(update.partServiceDates),
        partServiceHours: clonePartMap(update.partServiceHours),
        report: cloneReportEntry(update.report),
        technicians: Array.isArray(update.technicians) ? update.technicians.map(name => String(name || '')) : []
    };
}

function normalizeTechnicianName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
}

function splitTechnicianNames(value) {
    return String(value || '')
        .split(',')
        .map(normalizeTechnicianName)
        .filter(Boolean);
}

function abbreviateTechnicianName(name) {
    const normalized = normalizeTechnicianName(name);
    if (!normalized) return '';

    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length < 2) {
        return normalized;
    }

    const firstInitial = parts[0].charAt(0).toUpperCase();
    const lastName = parts[parts.length - 1];
    return `${firstInitial}. ${lastName}`;
}

function formatTechnicianInline(techValue) {
    const names = String(techValue || '')
        .split(',')
        .map(normalizeTechnicianName)
        .filter(Boolean);

    if (!names.length) {
        return String(techValue || 'Unknown User');
    }

    if (names.length === 1) {
        return names[0];
    }

    return names.map(abbreviateTechnicianName).join(' ');
}

function formatTechnicianLines(techValue) {
    const names = String(techValue || '')
        .split(',')
        .map(normalizeTechnicianName)
        .filter(Boolean);

    if (!names.length) {
        return escapeHtml(String(techValue || 'Unknown User'));
    }

    if (names.length === 1) {
        return escapeHtml(names[0]);
    }

    return escapeHtml(names.map(abbreviateTechnicianName).join(' '));
}

function toDateKey(dateStr) {
    const raw = String(dateStr || '').trim();
    if (!raw) return '';

    const dmyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
        const day = String(parseInt(dmyMatch[1], 10)).padStart(2, '0');
        const month = String(parseInt(dmyMatch[2], 10)).padStart(2, '0');
        return `${dmyMatch[3]}-${month}-${day}`;
    }

    const ymdMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
        return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        const yyyy = parsed.getFullYear();
        const mm = String(parsed.getMonth() + 1).padStart(2, '0');
        const dd = String(parsed.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    return raw;
}

function getChangedPartNames(beforeDates, afterDates) {
    const before = beforeDates && typeof beforeDates === 'object' ? beforeDates : {};
    const after = afterDates && typeof afterDates === 'object' ? afterDates : {};

    return Object.keys(after).filter(name => String(after[name] || '') !== String(before[name] || ''));
}

/**
 * Wires up live Service Report Reference No. uniqueness checking on a text
 * input — the same algorithm as the serial-number check on the new-machine
 * form (debounced live lookup, inline "checking…"/"taken" states, blocks
 * submit via setCustomValidity), just pointed at reports instead of machines.
 *
 * `getExcludeParams()` (optional) returns { excludeMachineId,
 * excludeTargetType, excludeUpdateIndex } so re-saving a report's own
 * unchanged ref no isn't flagged as colliding with itself. Omit it for a
 * brand-new report, which has nothing to exclude.
 *
 * Returns { checkNow } — call it manually right before submit to make sure
 * a value typed and instantly submitted (faster than the debounce) is still
 * validated before the request goes out.
 */
function wireRefNoLiveCheck(inputEl, { getExcludeParams } = {}) {
    if (!inputEl) return { checkNow: async () => {} };

    let debounceTimer = null;
    let requestToken = 0;

    function setState(state, message) {
        const existingNote = inputEl.parentElement ? inputEl.parentElement.querySelector('.refno-check-note') : null;
        if (existingNote) existingNote.remove();
        inputEl.classList.remove('edit-input-invalid');
        inputEl.setCustomValidity(state === 'taken' ? message : '');

        if (state === 'ok' || !message) return;

        const note = document.createElement('span');
        note.className = 'refno-check-note ' + (state === 'checking' ? 'edit-field-checking' : 'edit-field-error');
        note.textContent = message;
        inputEl.insertAdjacentElement('afterend', note);

        if (state === 'taken') inputEl.classList.add('edit-input-invalid');
    }

    async function checkNow() {
        const refNo = inputEl.value.trim();
        if (!refNo) {
            setState('ok');
            return;
        }

        const myToken = ++requestToken;
        setState('checking', 'Checking reference number…');

        const params = new URLSearchParams({ refNo });
        if (getExcludeParams) {
            const extra = getExcludeParams() || {};
            Object.entries(extra).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
            });
        }

        try {
            const res = await fetch(`/client/api/check-refno?${params.toString()}`, {
                headers: { Accept: 'application/json' }
            });
            const payload = await res.json();
            if (myToken !== requestToken) return; // a newer keystroke superseded this

            if (payload && payload.available === false) {
                const owner = payload.clientName
                    ? ` — ${payload.clientName}${payload.serialNo ? ' (' + payload.serialNo + ')' : ''}`
                    : '';
                setState('taken', (payload.message || 'Already used') + owner);
            } else {
                setState('ok');
            }
        } catch {
            // Network hiccup — stay silent and let the server decide on submit.
            if (myToken === requestToken) setState('ok');
        }
    }

    inputEl.addEventListener('input', () => {
        inputEl.setCustomValidity('');
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(checkNow, 400);
    });

    inputEl.addEventListener('blur', () => {
        clearTimeout(debounceTimer);
        checkNow();
    });

    return { checkNow };
}

/* ── SMR date ──
   Stored as ISO yyyy-mm-dd: unambiguous and sortable. The legacy values this
   replaced were bare mm/dd/yyyy and dd/mm/yyyy mixed together, which made a
   chunk of them impossible to read back with certainty — hence ISO on disk and
   a formatted view, rather than storing whatever the display format is. */

function todayIsoDate() {
    // Local calendar date. toISOString() converts to UTC and returns tomorrow
    // for anyone east of Greenwich, Manila included.
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

/** ISO yyyy-mm-dd -> dd/mm/yyyy for display. Anything else passes through. */
function formatSmrDate(value) {
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : raw;
}

/** Wires a date input to reject future dates, natively and on submit. */
function guardFutureDate(inputEl, label) {
    if (!inputEl) return;
    inputEl.max = todayIsoDate();

    const validate = () => {
        const tooLate = inputEl.value && inputEl.value > todayIsoDate();
        inputEl.setCustomValidity(tooLate ? `${label} cannot be in the future.` : '');
        inputEl.classList.toggle('edit-input-invalid', Boolean(tooLate));
    };

    inputEl.addEventListener('input', validate);
    inputEl.addEventListener('change', validate);
    validate();
    return validate;
}

/**
 * Reads a fetch response as JSON without choking on an HTML error page
 * (a proxy, an expired session redirect or a server crash), which used to
 * surface as "Unexpected token '<'". When the body isn't JSON it returns
 * { ok: false, error } with a message the page can show as-is.
 */
async function readJsonResponse(response) {
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
        if (response.status === 413) return { ok: false, error: 'This record is too large to save. Please contact an admin.' };
        if (response.redirected || response.status === 401) return { ok: false, error: 'Your session has expired. Please log in again.' };
        return { ok: false, error: `Server error (${response.status}). Please try again.` };
    }
    try {
        return await response.json();
    } catch (_) {
        return { ok: false, error: 'Unexpected response from the server. Please try again.' };
    }
}
