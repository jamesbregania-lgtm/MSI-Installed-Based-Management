const session = require('express-session');

module.exports = session({
  secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
  proxy: true,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: 'auto',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
});