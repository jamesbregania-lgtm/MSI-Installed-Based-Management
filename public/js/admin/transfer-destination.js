// Keep the original select as the validated form value and search its options.
(() => {
    const select = document.getElementById('transferToClient');
    if (!select) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'transfer-client-autocomplete';
    const input = document.createElement('input');
    input.id = 'transferDestinationSearch';
    input.type = 'text';
    input.placeholder = 'Type a client name…';
    input.autocomplete = 'off';
    input.style.width = '100%';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'transferDestinationOptions');
    input.setAttribute('aria-expanded', 'false');
    const list = document.createElement('ul');
    list.id = 'transferDestinationOptions';
    list.className = 'transfer-client-dropdown';
    list.setAttribute('role', 'listbox');
    select.before(wrapper);
    wrapper.append(input);
    document.body.append(list);
    list.style.position = 'fixed';
    list.style.zIndex = '1001';
    list.style.right = 'auto';
    select.hidden = true;
    select.removeAttribute('required');
    select.tabIndex = -1;
    document.querySelector('label[for="transferToClient"]').htmlFor = input.id;
    let matches = [];
    let active = -1;

    function close() {
        list.classList.remove('open');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    }
    function pick(option) {
        if (!option || option.disabled) return;
        select.value = option.value;
        input.value = option.textContent.trim();
        close();
        updateTransferPreview();
    }
    function render() {
        const query = input.value.trim().toLowerCase();
        if (!query) { close(); return; }
        matches = [...select.options].filter(option => option.value && !option.disabled
            && option.textContent.toLowerCase().includes(query)).slice(0, 20);
        list.replaceChildren();
        matches.forEach((option, index) => {
            const item = document.createElement('li');
            item.id = `transfer-destination-${index}`;
            item.className = 'transfer-client-item' + (index === active ? ' is-active' : '');
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(index === active));
            item.textContent = option.textContent;
            item.addEventListener('mousedown', event => event.preventDefault());
            item.addEventListener('click', () => pick(option));
            list.append(item);
        });
        if (!matches.length) {
            const empty = document.createElement('li');
            empty.className = 'transfer-client-empty';
            empty.textContent = 'No matching destination. Try another client name.';
            list.append(empty);
        }
        const rect = input.getBoundingClientRect();
        const below = innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const openUp = below < 160 && above > below;
        list.style.left = `${rect.left}px`;
        list.style.width = `${rect.width}px`;
        list.style.top = openUp ? 'auto' : `${rect.bottom + 6}px`;
        list.style.bottom = openUp ? `${innerHeight - rect.top + 6}px` : 'auto';
        list.style.maxHeight = `${Math.max(60, Math.min(240, openUp ? above : below))}px`;
        list.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
        if (active >= 0 && matches[active]) {
            input.setAttribute('aria-activedescendant', `transfer-destination-${active}`);
            list.children[active].scrollIntoView({ block: 'nearest' });
        } else input.removeAttribute('aria-activedescendant');
    }
    input.addEventListener('input', () => {
        select.value = '';
        active = -1;
        updateTransferPreview();
        render();
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Tab') { close(); return; }
        if (event.key === 'Escape') { close(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            active = event.key === 'ArrowDown' ? Math.min(active + 1, matches.length - 1) : Math.max(active - 1, 0);
            render();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (list.classList.contains('open')) pick(matches[active >= 0 ? active : 0]);
        }
    });
    document.addEventListener('click', event => { if (!wrapper.contains(event.target) && !list.contains(event.target)) close(); });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', event => { if (!list.contains(event.target)) close(); }, true);
    // openUnitTransfer resets the original select before showing each unit.
    new MutationObserver(() => {
        const modal = document.getElementById('modal-unit-transfer');
        close();
        if (modal.classList.contains('open')) {
            input.value = '';
            select.value = '';
            close();
            updateTransferPreview();
        }
    }).observe(document.getElementById('modal-unit-transfer'), { attributes: true, attributeFilter: ['class'] });
})();
