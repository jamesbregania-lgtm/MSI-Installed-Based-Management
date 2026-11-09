(function () {
    const form = document.getElementById('resetForm');
    if (!form) {
        return;
    }

    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirmPassword');
    const submitBtn = document.getElementById('submitBtn');
    const strengthLabel = document.getElementById('strengthLabel');

    function setError(groupId, value) {
        const el = document.getElementById(groupId);
        if (el) {
            el.classList.toggle('has-error', value);
        }
    }

    function validatePasswordFormat(password) {
        return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password || '');
    }

    function renderStrength(password) {
        let score = 0;
        if (password.length >= 8) score += 1;
        if (/[A-Z]/.test(password)) score += 1;
        if (/\d/.test(password)) score += 1;
        if (/[^A-Za-z0-9]/.test(password)) score += 1;

        const classes = ['', 'fill-weak', 'fill-fair', 'fill-good', 'fill-strong'];
        const labels = ['Enter a password', 'Weak', 'Fair', 'Good', 'Strong'];

        for (let i = 1; i <= 4; i += 1) {
            const seg = document.getElementById(`seg${i}`);
            if (!seg) continue;
            seg.className = `strength-seg${i <= score ? ` ${classes[score]}` : ''}`;
        }

        if (strengthLabel) {
            strengthLabel.textContent = password.length ? labels[score] : labels[0];
        }
    }

    passwordInput.addEventListener('input', () => {
        renderStrength(passwordInput.value);
        setError('fg-password', !validatePasswordFormat(passwordInput.value));
        if (confirmInput.value) {
            setError('fg-confirm', confirmInput.value !== passwordInput.value);
        }
    });

    confirmInput.addEventListener('input', () => {
        setError('fg-confirm', confirmInput.value !== passwordInput.value);
    });

    document.querySelectorAll('.pw-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
        });
    });

    form.addEventListener('submit', (event) => {
        const password = passwordInput.value;
        const confirmPassword = confirmInput.value;

        const isPasswordValid = validatePasswordFormat(password);
        const isConfirmValid = password === confirmPassword;

        setError('fg-password', !isPasswordValid);
        setError('fg-confirm', !isConfirmValid);

        if (!isPasswordValid || !isConfirmValid) {
            event.preventDefault();
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating...';
    });
})();