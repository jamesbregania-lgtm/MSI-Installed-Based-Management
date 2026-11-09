const express = require('express');
const bcrypt = require('bcryptjs');
const {
  findAccountByUsername,
  findActiveAccountByUsername,
  usernameExists,
  createUserAccount,
  resetUserPassword
} = require('../database/accounts.store');
const { findInviteByToken, updateInvite } = require('../database/invites.store');
const {
  findPasswordResetByToken,
  updatePasswordReset
} = require('../database/password-resets.store');
const { getDbConfigSummary } = require('../database/memory');
const { setAuthCookie, clearAuthCookie } = require('../lib/auth-cookie');

const router = express.Router();
const fullNameRegex = /^[A-Za-z\s.-]{2,120}$/;
const usernameRegex = /^[a-z0-9_]{3,20}$/;
const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function mapInviteRole(inviteRole) {
  const role = String(inviteRole || '').trim().toLowerCase();
  if (role === 'admin') return 'admin';
  if (role === 'sales') return 'sales';
  return 'user';
}

function isAdminLike(role) {
  return role === 'admin' || role === 'sales';
}

function properCase(value = '') {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function hostedEphemeralFileStorage() {
  const onEphemeralHost = Boolean(process.env.FLY_APP_NAME || process.env.VERCEL);
  return onEphemeralHost && getDbConfigSummary().mode === 'local-file';
}

function inviteNotFoundMessage() {
  if (hostedEphemeralFileStorage()) {
    return 'This invite was not found. On serverless hosts the app should use Redis storage, or invites can be lost when the instance restarts. Add KV_REST_API_URL and KV_REST_API_TOKEN from Upstash, redeploy, then ask an admin to send a new invite.';
  }
  return 'This invite link is invalid or has expired.';
}

function passwordResetNotFoundMessage() {
  if (hostedEphemeralFileStorage()) {
    return 'This reset link was not found. If a serverless instance restarted without Redis (KV_REST_API_URL + KV_REST_API_TOKEN), old links stop working. Configure Upstash Redis, redeploy, then request a new reset link.';
  }
  return 'This password reset link is invalid or has expired.';
}

router.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return isAdminLike(req.session.user.role)
    ? res.redirect('/admin_account')
    : res.redirect('/user_account');
});

router.get('/login', (req, res) => {
  if (req.session.user) {
    return isAdminLike(req.session.user.role)
      ? res.redirect('/admin_account')
      : res.redirect('/user_account');
  }

  res.render('login', { error: null });
});

router.get('/account_setup', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const emptyFormData = {
    fullName: '',
    username: ''
  };

  if (!token) {
    return res.status(400).render('account_setup', {
      invite: null,
      error: 'Missing invite token.',
      formData: emptyFormData
    });
  }

  const invite = await findInviteByToken(token);

  if (!invite) {
    return res.status(404).render('account_setup', {
      invite: null,
      error: inviteNotFoundMessage(),
      formData: emptyFormData
    });
  }

  const expiresAt = new Date(invite.expiresAt || 0);
  if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    await updateInvite(token, { status: 'expired' });
    return res.status(410).render('account_setup', {
      invite: null,
      error: 'This invite link has expired.',
      formData: emptyFormData
    });
  }

  if (invite.status !== 'pending') {
    return res.status(410).render('account_setup', {
      invite: null,
      error: 'This invite link has already been used.',
      formData: emptyFormData
    });
  }

  return res.render('account_setup', {
    invite,
    error: null,
    formData: {
      fullName: '',
      username: ''
    }
  });
});

router.get('/reset_password', async (req, res) => {
  const token = String(req.query.token || '').trim();

  if (!token) {
    return res.status(400).render('reset_password', {
      resetRequest: null,
      error: 'Missing password reset token.',
      success: null
    });
  }

  const resetRequest = await findPasswordResetByToken(token);

  if (!resetRequest) {
    return res.status(404).render('reset_password', {
      resetRequest: null,
      error: passwordResetNotFoundMessage(),
      success: null
    });
  }

  const expiresAt = new Date(resetRequest.expiresAt || 0);
  if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    await updatePasswordReset(token, { status: 'expired' });
    return res.status(410).render('reset_password', {
      resetRequest: null,
      error: 'This password reset link has expired.',
      success: null
    });
  }

  if (resetRequest.status !== 'pending') {
    return res.status(410).render('reset_password', {
      resetRequest: null,
      error: 'This password reset link has already been used.',
      success: null
    });
  }

  const account = await findAccountByUsername(resetRequest.username);
  if (!account) {
    return res.status(404).render('reset_password', {
      resetRequest: null,
      error: 'Account not found for this reset request.',
      success: null
    });
  }

  return res.render('reset_password', {
    resetRequest,
    error: null,
    success: null
  });
});

router.post('/reset_password', async (req, res) => {
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  const renderWithError = (status, message) => {
    return res.status(status).render('reset_password', {
      resetRequest: token ? { token } : null,
      error: message,
      success: null
    });
  };

  if (!token) {
    return renderWithError(400, 'Missing password reset token.');
  }

  const resetRequest = await findPasswordResetByToken(token);
  if (!resetRequest) {
    return renderWithError(404, passwordResetNotFoundMessage());
  }

  const expiresAt = new Date(resetRequest.expiresAt || 0);
  if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    await updatePasswordReset(token, { status: 'expired' });
    return renderWithError(410, 'This password reset link has expired.');
  }

  if (resetRequest.status !== 'pending') {
    return renderWithError(410, 'This password reset link has already been used.');
  }

  if (!passwordRegex.test(password)) {
    return renderWithError(400, 'Password must be at least 8 characters and include both letters and numbers.');
  }

  if (password !== confirmPassword) {
    return renderWithError(400, 'Passwords do not match.');
  }

  const account = await findAccountByUsername(resetRequest.username);
  if (!account) {
    return renderWithError(404, 'Account not found for this reset request.');
  }

  await resetUserPassword(resetRequest.username, await bcrypt.hash(password, 10));
  await updatePasswordReset(token, {
    status: 'used',
    usedAt: new Date().toISOString()
  });

  return res.render('reset_password', {
    resetRequest: null,
    error: null,
    success: 'Password updated successfully. You can now log in with your new password.'
  });
});

router.post('/account_setup', async (req, res) => {
  const token = String(req.body.token || '').trim();
  const fullNameInput = String(req.body.fullName || '');
  const usernameInput = String(req.body.username || '');
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  const fullName = properCase(fullNameInput);
  const username = usernameInput.trim().toLowerCase();

  const renderWithError = async (status, invite, errorMessage) => {
    return res.status(status).render('account_setup', {
      invite,
      error: errorMessage,
      formData: {
        fullName,
        username
      }
    });
  };

  if (!token) {
    return res.status(400).render('account_setup', {
      invite: null,
      error: 'Missing invite token.',
      formData: {
        fullName,
        username
      }
    });
  }

  const invite = await findInviteByToken(token);

  if (!invite) {
    return res.status(404).render('account_setup', {
      invite: null,
      error: inviteNotFoundMessage(),
      formData: {
        fullName,
        username
      }
    });
  }

  const expiresAt = new Date(invite.expiresAt || 0);
  if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    await updateInvite(token, { status: 'expired' });
    return renderWithError(410, null, 'This invite link has expired.');
  }

  if (invite.status !== 'pending') {
    return renderWithError(410, null, 'This invite link has already been used.');
  }

  if (!fullNameRegex.test(fullName)) {
    return renderWithError(400, invite, 'Please enter a valid full name.');
  }

  if (!usernameRegex.test(username)) {
    return renderWithError(400, invite, 'Username must be 3-20 characters using lowercase letters, numbers, or underscore.');
  }

  if (!passwordRegex.test(password)) {
    return renderWithError(400, invite, 'Password must be at least 8 characters and include both letters and numbers.');
  }

  if (password !== confirmPassword) {
    return renderWithError(400, invite, 'Passwords do not match.');
  }

  if (await usernameExists(username)) {
    return renderWithError(409, invite, 'That username is already taken. Please choose another one.');
  }

  const mappedRole = mapInviteRole(invite.role);
  const created = await createUserAccount({
    username,
    email: String(invite.email || '').trim().toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    role: mappedRole,
    fullName,
    department: String(invite.department || '').trim().toUpperCase(),
    branch: String(invite.branch || '').trim(),
    status: 'active'
  });

  if (!created) {
    return renderWithError(409, invite, 'That username is already taken. Please choose another one.');
  }

  await updateInvite(token, {
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
    acceptedUsername: username
  });

  req.session.user = {
    username,
    role: mappedRole,
    fullName,
    department: String(invite.department || '').trim().toUpperCase(),
    branch: String(invite.branch || '').trim()
  };
  setAuthCookie(res, req.session.user);

  await new Promise((resolve, reject) => {
    req.session.save(err => (err ? reject(err) : resolve()));
  });

  return isAdminLike(mappedRole)
    ? res.redirect('/admin_account')
    : res.redirect('/user_account');
});

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const found = await findActiveAccountByUsername(username);

    if (!found) {
      return res.render('login', { error: 'Invalid credentials or account is inactive.' });
    }

    const isMatch = await bcrypt.compare(password, found.passwordHash);

    if (!isMatch) {
      return res.render('login', { error: 'Invalid credentials or account is inactive.' });
    }

    req.session.user = {
      username: found.username,
      role: found.role,
      fullName: found.fullName,
      department: found.department,
      branch: found.branch
    };
    setAuthCookie(res, req.session.user);

    await new Promise((resolve, reject) => {
      req.session.save(err => (err ? reject(err) : resolve()));
    });

    return isAdminLike(found.role)
      ? res.redirect('/admin_account')
      : res.redirect('/user_account');
  } catch (error) {
    console.error('Login error:', error);
    return res.render('login', { error: 'Login failed. Please try again.' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    clearAuthCookie(res);
    res.redirect('/login');
  });
});

module.exports = router;