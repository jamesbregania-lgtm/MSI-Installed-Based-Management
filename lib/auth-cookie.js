const crypto = require('crypto');

const AUTH_COOKIE_NAME = 'matsol_auth';
const AUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 8;

function normalizeUserRole(role, department) {
  const normalizedRole = String(role || 'user').trim().toLowerCase();
  const normalizedDept = String(department || '').trim().toLowerCase();
  if (normalizedRole === 'user' && normalizedDept === 'sales') return 'sales';
  return normalizedRole;
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object') return user;
  const normalizedRole = normalizeUserRole(user.role, user.department);
  if (normalizedRole === user.role) return user;
  return {
    ...user,
    role: normalizedRole
  };
}

function getAuthSecret() {
  return String(process.env.SESSION_SECRET || 'fallback_secret_change_me');
}

function safeBase64UrlEncode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function safeBase64UrlDecode(value) {
  return Buffer.from(String(value), 'base64url').toString('utf8');
}

function signPayload(payloadText) {
  return crypto
    .createHmac('sha256', getAuthSecret())
    .update(payloadText)
    .digest('base64url');
}

function serializeAuthUser(user) {
  const normalizedRole = normalizeUserRole(user.role, user.department);
  const payload = JSON.stringify({
    username: String(user.username || ''),
    role: String(normalizedRole || 'user'),
    fullName: String(user.fullName || ''),
    department: String(user.department || ''),
    branch: String(user.branch || '')
  });
  const encoded = safeBase64UrlEncode(payload);
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

function readCookieHeader(req) {
  return String(req && req.headers && req.headers.cookie || '');
}

function getCookieValue(req, cookieName) {
  const source = readCookieHeader(req);
  if (!source) {
    return '';
  }

  const pairs = source.split(';');
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index === -1) {
      continue;
    }

    const key = pair.slice(0, index).trim();
    if (key !== cookieName) {
      continue;
    }

    return pair.slice(index + 1).trim();
  }

  return '';
}

function deserializeAuthUser(cookieValue) {
  const raw = String(cookieValue || '').trim();
  if (!raw) {
    return null;
  }

  const parts = raw.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;
  const expectedSignature = signPayload(encodedPayload);

  if (signature.length !== expectedSignature.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(safeBase64UrlDecode(encodedPayload));
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    return normalizeUser({
      username: String(payload.username || '').trim().toLowerCase(),
      role: String(payload.role || 'user').trim().toLowerCase(),
      fullName: String(payload.fullName || ''),
      department: String(payload.department || ''),
      branch: String(payload.branch || '')
    });
  } catch {
    return null;
  }
}

function getAuthUserFromRequest(req) {
  if (req && req.session && req.session.user) {
    const normalized = normalizeUser(req.session.user);
    if (normalized && normalized !== req.session.user) {
      req.session.user = normalized;
    }
    return normalized;
  }

  return deserializeAuthUser(getCookieValue(req, AUTH_COOKIE_NAME));
}

function setAuthCookie(res, user) {
  if (!res || typeof res.cookie !== 'function' || !user) {
    return;
  }

  res.cookie(AUTH_COOKIE_NAME, serializeAuthUser(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && !process.env.APP_BASE_URL?.includes('localhost'),
    sameSite: 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: '/'
  });
}

function clearAuthCookie(res) {
  if (!res || typeof res.clearCookie !== 'function') {
    return;
  }

  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

module.exports = {
  getAuthUserFromRequest,
  setAuthCookie,
  clearAuthCookie
};