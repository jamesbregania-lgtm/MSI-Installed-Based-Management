(() => {
    const form = document.getElementById('serialSearchForm');
    const input = document.getElementById('serialSearchInput');
    const submit = document.getElementById('serialSearchSubmit');
    const status = document.getElementById('serialSearchStatus');
    const results = document.getElementById('serialSearchResults');
    const rows = document.getElementById('serialSearchRows');
    const pagination = document.getElementById('serialSearchPagination');
    const previous = document.getElementById('serialSearchPrevious');
    const next = document.getElementById('serialSearchNext');
    let query = '';
    let page = 0;
    let requestVersion = 0;
    let detailVersion = 0;
    let lastHistoryTrigger = null;

    function announce(message, error = false) {
        status.textContent = message;
        status.classList.toggle('is-error', error);
    }

    function machineCells(machine) {
        return `<td class="mono">${escapeHtml(machine.serialNo)}</td>
            <td>${escapeHtml(machine.unit)}<small>${escapeHtml(machine.model)}</small></td>
            <td>${escapeHtml(machine.clientName)}<small>${escapeHtml(machine.location)}</small></td>
            <td>${escapeHtml(machine.status || '—')}${machine.disabledAt ? '<small>Disabled</small>' : ''}</td>
            <td><button type="button" class="btn btn-outline btn-sm" data-machine-id="${Number(machine.id)}">View records</button></td>`;
    }

    function updateHistoryCaption(machine) {
        let caption = document.getElementById('serialHistoryCaption');
        if (!caption) {
            caption = document.createElement('p');
            caption.id = 'serialHistoryCaption';
            caption.className = 'serial-history-caption';
            document.getElementById('historyList').closest('.popup-card').querySelector('h3').after(caption);
        }
        caption.textContent = `${machine.serialNo} · ${machine.unit} ${machine.model} · ${machine.clientName}${machine.disabledAt ? ' · Disabled' : ''}`;
    }

    async function getJson(url) {
        const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (response.redirected) throw new Error('Your session has expired. Please log in again.');
        const payload = await readJsonResponse(response);
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load records. Please try again.');
        return payload;
    }

    async function search(targetPage) {
        const version = ++requestVersion;
        ++detailVersion;
        rows.replaceChildren();
        results.hidden = true;
        pagination.hidden = true;
        submit.disabled = true;
        form.setAttribute('aria-busy', 'true');
        announce('Searching serial numbers…');
        try {
            const params = new URLSearchParams({ serial: query, page: targetPage });
            const data = await getJson(`/admin_account/serial-search?${params}`);
            if (version !== requestVersion) return;
            page = data.page;
            rows.innerHTML = data.machines.map(machine => `<tr>${machineCells(machine)}</tr>`).join('');
            results.hidden = !data.machines.length;
            pagination.hidden = page === 0 && !data.hasMore;
            previous.disabled = page === 0;
            next.disabled = !data.hasMore;
            document.getElementById('serialSearchPage').textContent = `Page ${page + 1}`;
            announce(data.machines.length
                ? `${data.machines.length} matching ${data.machines.length === 1 ? 'machine' : 'machines'} on this page. Select View records to open the full history.`
                : `No machines found for “${query}”.`);
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
        query = input.value.trim();
        if (!query) {
            input.setCustomValidity('Enter all or part of a serial number.');
            input.reportValidity();
            return;
        }
        search(0);
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    previous.addEventListener('click', () => search(page - 1));
    next.addEventListener('click', () => search(page + 1));

    rows.addEventListener('click', async event => {
        const button = event.target.closest('button[data-machine-id]');
        if (!button) return;
        const version = ++detailVersion;
        button.disabled = true;
        announce('Loading complete machine history…');
        try {
            const { machine } = await getJson(`/admin_account/serial-search/${button.dataset.machineId}`);
            if (version !== detailVersion) return;
            allMachines = [machine];
            updateHistoryCaption(machine);
            lastHistoryTrigger = button;
            openHistoryModal(0);
            document.getElementById('closeHistoryPopup').focus();
            announce('Full history loaded. Select a history entry to view its Service Report.');
        } catch (error) {
            if (version === detailVersion) announce(error.message, true);
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById('closeHistoryPopup').addEventListener('click', () => lastHistoryTrigger?.focus());
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (historyReportPopup.style.display === 'grid') {
            closeHistoryReportModal();
            document.getElementById('closeHistoryPopup').focus();
        } else if (historyPopup.style.display === 'grid') {
            historyPopup.style.display = 'none';
            lastHistoryTrigger?.focus();
        }
    });
})();
