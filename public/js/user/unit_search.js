// Technician home: find a unit by serial number and open only that unit.
// Same search as the admin's Serial Number Search (/admin_account/serial-search),
// served from /user_account/serial-search with just the fields shown here.
(() => {
    const form = document.getElementById('unitSearchForm');
    const input = document.getElementById('unitSearchInput');
    const submit = document.getElementById('unitSearchSubmit');
    const status = document.getElementById('unitSearchStatus');
    const results = document.getElementById('unitSearchResults');
    const rows = document.getElementById('unitSearchRows');
    const pagination = document.getElementById('unitSearchPagination');
    const previous = document.getElementById('unitSearchPrevious');
    const next = document.getElementById('unitSearchNext');
    const PAGE_SIZE = 25;
    // Remembers the last search for this tab, so Back from a unit returns to it.
    const STORAGE_KEY = 'unitSearch:last';
    let query = '';
    let page = 0;
    let requestVersion = 0;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function announce(message, error = false) {
        status.textContent = message;
        status.classList.toggle('is-error', error);
    }

    function remember() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ query, page }));
        } catch (e) { /* storage unavailable — nothing to restore later */ }
    }

    function unitHref(machine) {
        return `/client/${encodeURIComponent(machine.clientId)}?unit=${encodeURIComponent(machine.id)}`;
    }

    function renderRows(machines) {
        rows.innerHTML = machines.map((machine, i) => {
            const unitLine = [machine.unit, machine.model].filter(Boolean).join(' · ');
            const flags = [
                machine.status ? escapeHtml(machine.status) : '',
                machine.disabled ? 'Disabled' : ''
            ].filter(Boolean).join(' · ');
            const initial = (machine.unit || machine.serialNo || '?').charAt(0).toUpperCase();
            return `
                <a class="client-row unit-row" href="${unitHref(machine)}">
                    <span class="col-num">${page * PAGE_SIZE + i + 1}</span>
                    <span class="col-name">
                        <span class="client-avatar">${escapeHtml(initial)}</span>
                        <span class="client-info">
                            <span class="unit-serial">${escapeHtml(machine.serialNo)}</span>
                            <small class="unit-sub">${escapeHtml(unitLine)}${flags ? ` — ${flags}` : ''}</small>
                        </span>
                    </span>
                    <span class="col-client">${escapeHtml(machine.clientName)}</span>
                    <span class="col-badge">
                        <span class="badge-location">${escapeHtml(machine.location || 'N/A')}</span>
                    </span>
                    <span class="col-arrow" aria-hidden="true">→</span>
                </a>`;
        }).join('');
    }

    async function search(targetPage) {
        const version = ++requestVersion;
        rows.replaceChildren();
        results.hidden = true;
        pagination.hidden = true;
        submit.disabled = true;
        form.setAttribute('aria-busy', 'true');
        announce('Searching serial numbers…');
        try {
            const params = new URLSearchParams({ serial: query, page: targetPage });
            const response = await fetch(`/user_account/serial-search?${params}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });
            if (response.redirected) throw new Error('Your session has expired. Please log in again.');
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) throw new Error(data.error || 'Could not search serial numbers. Please try again.');
            if (version !== requestVersion) return;

            page = data.page;
            remember();
            renderRows(data.machines);
            results.hidden = !data.machines.length;
            pagination.hidden = page === 0 && !data.hasMore;
            previous.disabled = page === 0;
            next.disabled = !data.hasMore;
            document.getElementById('unitSearchPage').textContent = `Page ${page + 1}`;
            const count = data.machines.length;
            announce(count
                ? `${count} matching ${count === 1 ? 'unit' : 'units'}${pagination.hidden ? '' : ' on this page'}. Select a unit to open its records.`
                : `No units found for “${query}”.`);
        } catch (error) {
            if (version === requestVersion) announce(error.message, true);
        } finally {
            if (version === requestVersion) {
                submit.disabled = false;
                form.setAttribute('aria-busy', 'false');
            }
        }
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        const value = input.value.trim();
        if (value.length < MIN_SERIAL_SEARCH_LENGTH) {
            announce(`Enter at least ${MIN_SERIAL_SEARCH_LENGTH} characters of the serial number.`, true);
            input.focus();
            return;
        }
        query = value;
        search(0);
    });
    previous.addEventListener('click', () => search(page - 1));
    next.addEventListener('click', () => search(page + 1));

    // Bring the previous search back only when returning from a unit page —
    // the browser's Back button or the unit page's own back arrow. A fresh
    // visit or a reload starts with an empty search.
    function cameBackFromUnit() {
        const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
        if (nav && nav.type === 'back_forward') return true;
        try {
            const referrer = new URL(document.referrer);
            return referrer.origin === location.origin && referrer.pathname.startsWith('/client/')
                && (!nav || nav.type === 'navigate');
        } catch (e) {
            return false;
        }
    }

    try {
        if (!cameBackFromUnit()) {
            sessionStorage.removeItem(STORAGE_KEY);
        } else {
            const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
            if (saved && typeof saved.query === 'string' && saved.query.length >= MIN_SERIAL_SEARCH_LENGTH) {
                query = saved.query;
                input.value = saved.query;
                search(Number.isSafeInteger(saved.page) && saved.page >= 0 ? saved.page : 0);
            }
        }
    } catch (e) { /* storage unavailable — start empty */ }
})();
