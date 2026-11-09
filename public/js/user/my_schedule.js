/* ── MY SCHEDULE ──
   Work an admin assigned to this technician (Admin > Scheduling), as compact
   rows: date, time, client/location and a short description. Tapping a row
   with a long description shows the rest. Wrapped so its helpers don't
   collide with unit_search.js on the same page. */
(() => {
    const list = document.getElementById('scheduleList');
    if (!list) return;
    const schedules = Array.isArray(window.MY_SCHEDULES) ? window.MY_SCHEDULES : [];

    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // The phone's own date, so "today" is the technician's today, not the server's.
    const localIsoDate = date => {
        const pad = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };

    const parseIsoDate = iso => {
        const [y, m, d] = String(iso || '').split('-').map(Number);
        return y && m && d ? new Date(y, m - 1, d) : null;
    };

    const formatTime = hhmm => {
        if (!hhmm) return 'Any time';
        const [h, min] = hhmm.split(':').map(Number);
        return new Date(2000, 0, 1, h, min).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    };

    // Which schedules are new or changed since this phone last showed the list:
    // id → updatedAt, kept per phone. The first visit marks nothing.
    const SEEN_KEY = 'mySchedule:seen';
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch (e) { /* no storage */ }
    const changeLabel = schedule => {
        if (!seen || typeof seen !== 'object' || schedule.status !== 'scheduled') return '';
        if (!(schedule.id in seen)) return 'New';
        return seen[schedule.id] !== schedule.updatedAt ? 'Updated' : '';
    };
    try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(schedules.map(s => [s.id, s.updatedAt]))));
    } catch (e) { /* no storage: nothing is marked */ }

    function scheduleRow(schedule, today, tomorrow) {
        const date = parseIsoDate(schedule.date);
        const dayLabel = schedule.date === today ? 'Today'
            : schedule.date === tomorrow ? 'Tomorrow'
            : date ? date.toLocaleDateString(undefined, { weekday: 'short' }) : '';
        const statusBadge = schedule.status === 'done' ? '<span class="sched-status sched-status-done">Done</span>'
            : schedule.status === 'cancelled' ? '<span class="sched-status sched-status-cancelled">Cancelled</span>'
            : '';
        const change = changeLabel(schedule);
        const changeBadge = change ? `<span class="sched-status sched-status-new">${change}</span>` : '';
        const place = [schedule.clientName, schedule.location].filter(Boolean).join(' · ');

        return `
        <li class="sched-row sched-${escapeHtml(schedule.status)}">
            <div class="sched-date" aria-hidden="true">
                <span class="sched-month">${date ? escapeHtml(date.toLocaleDateString(undefined, { month: 'short' })) : ''}</span>
                <span class="sched-day">${date ? date.getDate() : '?'}</span>
            </div>
            <div class="sched-main">
                <div class="sched-when">${escapeHtml(dayLabel)} · ${escapeHtml(formatTime(schedule.time))} ${statusBadge}${changeBadge}</div>
                <div class="sched-place">${escapeHtml(place)}</div>
                ${schedule.description ? `<p class="sched-desc">${escapeHtml(schedule.description)}</p>` : ''}
            </div>
        </li>`;
    }

    const now = new Date();
    const today = localIsoDate(now);
    const tomorrow = localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const current = schedules.filter(s => s.date >= today);
    const todays = current.filter(s => s.date === today);
    // Cancelled ones still show today so the technician knows not to go,
    // but are dropped from the days ahead.
    const upcoming = current.filter(s => s.date > today && s.status !== 'cancelled');

    const group = (title, items, emptyText) => `
        <div class="sched-group">
            <h3 class="sched-group-title">${title} <span class="sched-count">${items.length}</span></h3>
            ${items.length
                ? `<ul class="sched-list">${items.map(s => scheduleRow(s, today, tomorrow)).join('')}</ul>`
                : `<p class="sched-empty">${emptyText}</p>`}
        </div>`;

    list.innerHTML = group('Today', todays, 'Nothing scheduled for today.')
        + group('Upcoming', upcoming, 'No upcoming schedules.');

    // Descriptions are clamped to two lines; only rows that actually overflow
    // become tappable to show the rest. Overflow can't be measured while the
    // My Schedule view is hidden, so this re-runs whenever it is shown.
    function markExpandableRows() {
        list.querySelectorAll('.sched-row:not(.is-expandable)').forEach(row => {
            const desc = row.querySelector('.sched-desc');
            if (!desc || !desc.clientHeight || desc.scrollHeight <= desc.clientHeight + 1) return;
            row.classList.add('is-expandable');
            row.tabIndex = 0;
            row.setAttribute('role', 'button');
            row.setAttribute('aria-expanded', 'false');
        });
    }

    function toggleRow(row) {
        if (!row || !row.classList.contains('is-expandable')) return;
        const open = row.classList.toggle('is-open');
        row.setAttribute('aria-expanded', String(open));
    }

    list.addEventListener('click', event => toggleRow(event.target.closest('.sched-row')));
    list.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const row = event.target.closest('.sched-row.is-expandable');
        if (!row) return;
        event.preventDefault();
        toggleRow(row);
    });
    markExpandableRows();
    document.addEventListener('techview:shown', event => {
        if (event.detail === 'schedule') markExpandableRows();
    });

    // Today's unfinished count on the My Schedule tab: only schedules still
    // waiting on a log. Done and cancelled ones need no visit, and past ones
    // (Closed) are never listed here.
    const badge = document.getElementById('techTabScheduleCount');
    if (badge) {
        const due = todays.filter(s => s.status === 'scheduled').length;
        badge.textContent = due;
        badge.hidden = due === 0;
    }
})();
