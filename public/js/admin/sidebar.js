(() => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    const close = document.getElementById('sidebarClose');
    const backdrop = document.getElementById('sidebarBackdrop');
    const header = document.getElementById('mobileAdminHeader');
    const main = document.querySelector('.main-content');
    const mobile = window.matchMedia('(max-width: 820px)');
    let open = false;

    function setOpen(value, restoreFocus = true) {
        open = mobile.matches && value;
        sidebar.classList.toggle('is-open', open);
        document.body.classList.toggle('sidebar-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        backdrop.hidden = !open;
        sidebar.inert = mobile.matches && !open;
        main.inert = open;
        header.inert = open;
        if (mobile.matches && !open) sidebar.setAttribute('aria-hidden', 'true');
        else sidebar.removeAttribute('aria-hidden');
        if (open) {
            sidebar.setAttribute('role', 'dialog');
            sidebar.setAttribute('aria-modal', 'true');
            (sidebar.querySelector('.nav-item.active') || close).focus();
        } else {
            sidebar.removeAttribute('role');
            sidebar.removeAttribute('aria-modal');
            if (restoreFocus && mobile.matches) toggle.focus();
        }
    }

    toggle.addEventListener('click', () => setOpen(!open));
    close.addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    sidebar.querySelector('.sidebar-nav').addEventListener('click', event => {
        if (mobile.matches && event.target.closest('.nav-item')) {
            setOpen(false);
            window.scrollTo({ top: 0, behavior: 'instant' });
        }
    });
    document.addEventListener('keydown', event => {
        if (!open) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            setOpen(false);
        } else if (event.key === 'Tab') {
            const targets = [...sidebar.querySelectorAll('button:not([disabled]), a[href]')]
                .filter(element => element.getClientRects().length);
            const first = targets[0];
            const last = targets[targets.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    mobile.addEventListener('change', () => {
        const focusWasInSidebar = sidebar.contains(document.activeElement);
        setOpen(false, false);
        if (mobile.matches && focusWasInSidebar) toggle.focus();
        else if (!mobile.matches && document.activeElement === toggle) sidebar.querySelector('.nav-item.active')?.focus();
    });
    setOpen(false, false);
})();
