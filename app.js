require('dotenv').config();
require('express-async-errors');
const express = require('express');
const path = require('path');
const { manifestHandler } = require('./lib/manifest');
const compression = require('compression');
const sessionMiddleware = require('./config/session');
const { getAuthUserFromRequest } = require('./lib/auth-cookie');

const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const userRoutes = require('./modules/user/user.routes');
const clientRoutes = require('./modules/client/client.routes');
const assetRoutes = require('./modules/asset/asset.routes');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Catch unhandled promise rejections so the serverless function doesn't hang.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason instanceof Error ? reason.stack : JSON.stringify(reason));
});

// The host runs behind a reverse proxy; trust it so secure cookies work.
app.set('trust proxy', 1);

app.use(compression());
// Machine saves no longer resend the full history, but correction and
// install payloads can still carry long text; 100kb (the default) was hit
// by machines with 120+ service updates.
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use((req, res, next) => {
  const authUser = getAuthUserFromRequest(req);
  if (authUser && !req.session.user) {
    req.session.user = authUser;
  }
  req.authUser = authUser || null;
  next();
});
// Before the static files so the manifest names the address it is served from.
app.get('/manifest.webmanifest', manifestHandler({ cache: isProd }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: isProd ? '1d' : 0,
    setHeaders: (res, filePath) => {
      // Phones must pick up a new service worker right away, not a day later.
      if (path.basename(filePath) === 'sw.js') {
        res.setHeader('Cache-Control', 'no-cache');
        return;
      }
      if (!isProd) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  })
);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Pages are cached in production. A local copy that also runs with
// NODE_ENV=production can set VIEW_CACHE=off in .env so edits to a page show on
// reload instead of needing a server restart.
if (isProd && process.env.VIEW_CACHE !== 'off') {
  app.set('view cache', true);
}

function formatRoleLabel(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'admin') return 'Admin';
  if (normalized === 'sales') return 'Sales';
  return 'Technician';
}

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || req.authUser || null;
  res.locals.formatRoleLabel = formatRoleLabel;
  next();
});

app.use('/', authRoutes);
app.use('/admin_account', adminRoutes);
app.use('/user_account', userRoutes);
app.use('/user_account', assetRoutes);
app.use('/client', clientRoutes);

// Global error handler — catches async route errors so the response doesn't hang.
// express-async-errors ensures ALL async route errors reach this handler.
app.use((err, req, res, next) => {
  console.error('Express error:', err && err.message ? err.message : JSON.stringify(err));
  if (res.headersSent) {
    return next(err);
  }

  // Body-parser errors carry a 4xx status (413 too large, 400 malformed JSON);
  // keep it rather than reporting every failure as a 500.
  const status = Number.isInteger(err && (err.status || err.statusCode))
    ? (err.status || err.statusCode)
    : 500;
  const clientMessages = {
    400: 'The request could not be read. Please try again.',
    413: 'This record is too large to save. Please contact an admin.'
  };
  const message = clientMessages[status] || 'Internal server error.';

  // JSON for API calls: anything that asked for JSON or sent JSON. fetch()
  // doesn't set Accept by default, so the request body type matters too —
  // otherwise the page got the login HTML and failed with "Unexpected token '<'".
  const wantsJson = req.xhr
    || (req.headers.accept && req.headers.accept.includes('application/json'))
    || req.is('application/json');
  if (wantsJson) {
    return res.status(status).json({ ok: false, error: message });
  }

  // For page requests, render login with error
  try {
    res.status(status).render('login', {
      error: 'Something went wrong. Please try again.'
    });
  } catch (renderErr) {
    res.status(500).send('Internal server error.');
  }
});

module.exports = app;