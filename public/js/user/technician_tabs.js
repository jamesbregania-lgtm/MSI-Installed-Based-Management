/* ── TECHNICIAN VIEWS ──
   Two views on the technician home page, one at a time: My Schedule and Unit
   Search. The open view is kept in the URL hash (#schedule / #search) with
   replaceState, so Back from a unit page lands on the same view. Runs after
   unit_search.js, which has already restored or cleared the last search. */
(() => {
    const tabs = Array.from(document.querySelectorAll('.tech-tab[data-view]'));
    const panels = Array.from(document.querySelectorAll('[data-tech-view]'));
    if (!tabs.length || !panels.length) return;

    const VIEWS = ['schedule', 'search'];

    function show(view, { focus = false } = {}) {
        if (!VIEWS.includes(view)) view = 'schedule';
        tabs.forEach(tab => {
            const active = tab.dataset.view === view;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        panels.forEach(panel => { panel.hidden = panel.dataset.techView !== view; });
        if (location.hash !== `#${view}`) {
            try {
                history.replaceState(null, '', `${location.pathname}${location.search}#${view}`);
            } catch (e) { /* URL not updatable here; the view still switches */ }
        }
        if (focus && view === 'search') {
            const input = document.getElementById('unitSearchInput');
            if (input && !input.value) input.focus();
        }
        document.dispatchEvent(new CustomEvent('techview:shown', { detail: view }));
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            show(tab.dataset.view, { focus: true });
            window.scrollTo(0, 0);
        });
        // Arrow keys move between tabs, as in any tab list.
        tab.addEventListener('keydown', event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            show(next.dataset.view);
            next.focus();
        });
    });

    // Start on the view in the hash; otherwise on Unit Search when a search was
    // just restored (back from a unit), else on My Schedule.
    const fromHash = location.hash.replace('#', '');
    let restoredSearch = false;
    try { restoredSearch = Boolean(sessionStorage.getItem('unitSearch:last')); } catch (e) { /* no storage */ }
    show(VIEWS.includes(fromHash) ? fromHash : restoredSearch ? 'search' : 'schedule');
})();
