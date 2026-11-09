const togglePasswordBtn = document.getElementById('togglePasswordBtn');

if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
        const input = document.getElementById('password');
        const eyeIcon = document.getElementById('eye-icon');
        const isHidden = input.type === 'password';

        input.type = isHidden ? 'text' : 'password';

        eyeIcon.innerHTML = isHidden
            ? `<path d="M2 2l11 11M6.2 6.3A2 2 0 009.5 9.5M1 7.5S2.8 4 7.5 3M14 7.5c-.5 1-2 3.5-6.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`
            : `<path d="M1 7.5s2.5-4.5 6.5-4.5S14 7.5 14 7.5s-2.5 4.5-6.5 4.5S1 7.5 1 7.5z" stroke="currentColor" stroke-width="1.4"/><circle cx="7.5" cy="7.5" r="1.75" stroke="currentColor" stroke-width="1.4"/>`;
    });
}