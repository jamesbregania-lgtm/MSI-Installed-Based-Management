// ── Confirm Dialog & Toast Notifications ──

const confirmOverlay = document.getElementById('confirmOverlay');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
let activeConfirmResolver = null;

function showConfirmDialog(options = {}) {
    const {
        title = 'Please Confirm',
        message = 'Are you sure?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        tone = 'default'
    } = options;

    if (!confirmOverlay || !confirmTitle || !confirmMessage || !confirmOkBtn || !confirmCancelBtn) {
        return Promise.resolve(window.confirm(message));
    }

    if (activeConfirmResolver) {
        activeConfirmResolver(false);
        activeConfirmResolver = null;
    }

    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmOkBtn.textContent = confirmText;
    confirmCancelBtn.textContent = cancelText;

    confirmOkBtn.classList.remove('is-warning', 'is-danger');
    if (tone === 'warning') confirmOkBtn.classList.add('is-warning');
    if (tone === 'danger') confirmOkBtn.classList.add('is-danger');

    confirmOverlay.style.display = 'grid';
    requestAnimationFrame(() => confirmOkBtn.focus());

    return new Promise((resolve) => {
        activeConfirmResolver = resolve;
    });
}

function resolveConfirmDialog(result) {
    if (!activeConfirmResolver) return;
    const resolver = activeConfirmResolver;
    activeConfirmResolver = null;
    confirmOverlay.style.display = 'none';
    resolver(result);
}

// ── Confirm dialog event listeners ──

if (confirmOkBtn) {
    confirmOkBtn.addEventListener('click', () => {
        resolveConfirmDialog(true);
    });
}

if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', () => {
        resolveConfirmDialog(false);
    });
}

if (confirmOverlay) {
    confirmOverlay.addEventListener('click', (e) => {
        if (e.target === confirmOverlay) {
            resolveConfirmDialog(false);
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (!confirmOverlay || confirmOverlay.style.display === 'none' || !activeConfirmResolver) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        resolveConfirmDialog(false);
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        resolveConfirmDialog(true);
    }
});

// ── Toast Notification ──

function showToast(message, type = 'success') {
    let toast = document.getElementById('update-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'update-toast';
        toast.style.cssText = `
            position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
            background: #1e7c3a; color: #fff; padding: 12px 24px;
            border-radius: 8px; font-size: 14px; font-weight: 600;
            box-shadow: 0 4px 16px rgba(0,0,0,0.18); z-index: 9999;
            transition: opacity 0.4s;
        `;
        document.body.appendChild(toast);
    }

    if (type === 'warning') {
        toast.style.background = '#b45309';
    } else if (type === 'info') {
        toast.style.background = '#2a6499';
    } else {
        toast.style.background = '#1e7c3a';
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 2800);
}
