const { getAuthUserFromRequest } = require('../lib/auth-cookie');

function wantsJson(req) {
  return Boolean(req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('application/json')));
}

function createRoleGuard(roles, { redirectTo } = {}) {
  const allowed = new Set((roles || []).map(role => String(role || '').trim().toLowerCase()));

  return (req, res, next) => {
    const user = getAuthUserFromRequest(req);
    if (!user) return res.redirect('/login');

    const role = String(user.role || '').trim().toLowerCase();
    if (allowed.has(role)) return next();

    if (wantsJson(req)) {
      return res.status(403).json({ ok: false, error: 'Access denied.' });
    }

    return res.redirect(redirectTo || '/user_account');
  };
}

const requireAdmin = createRoleGuard(['admin'], { redirectTo: '/user_account' });
const requireAdminOrSales = createRoleGuard(['admin', 'sales'], { redirectTo: '/user_account' });
const requireTechnicianOrAdmin = createRoleGuard(['user', 'admin', 'sales'], { redirectTo: '/admin_account' });

// The technician serial search covers every client, so Sales (scoped to their
// own clients) is kept out; admins may use it too.
const requireTechnicianSearch = createRoleGuard(['user', 'admin'], { redirectTo: '/admin_account' });

/**
 * Technicians ("user" role) reach a unit only through the serial search, never
 * by browsing a client's full unit list. Admin and Sales are unaffected.
 */
function isTechnician(user) {
  return String((user && user.role) || '').trim().toLowerCase() === 'user';
}

module.exports = { requireAdmin, requireAdminOrSales, requireTechnicianOrAdmin, requireTechnicianSearch, isTechnician };