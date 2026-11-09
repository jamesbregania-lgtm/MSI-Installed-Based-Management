const grid = document.getElementById('client-grid');

function renderClients(list) {
    const sorted = (list || []).slice().sort((a, b) => a.name.localeCompare(b.name));

    if (!sorted.length) {
        grid.innerHTML = `<div class="empty-state">No clients found.</div>`;
        return;
    }

    grid.innerHTML = sorted.map((client, i) => `
        <div class="client-row" onclick="goToClient('${encodeURIComponent(client.id)}')">
            <span class="col-num">${i + 1}</span>
            <span class="col-name">
                <span class="client-avatar">${client.name.charAt(0).toUpperCase()}</span>
                <span class="client-info">
                    <span class="client-name-text">${client.name}</span>
                </span>
            </span>
            <span class="col-badge">
                <span class="badge-location">${client.location || 'N/A'}</span>
            </span>
            <span class="col-arrow">→</span>
        </div>
    `).join('');
}

function goToClient(encodedId) {
    window.location.href = `/client/${encodedId}`;
}

function filterClients() {
    const query = document.getElementById('clientSearch').value.toLowerCase().trim();
    const filtered = CLIENTS.filter(client =>
        client.name.toLowerCase().includes(query) ||
        (client.location || '').toLowerCase().includes(query)
    );
    renderClients(filtered);
}

renderClients(CLIENTS);