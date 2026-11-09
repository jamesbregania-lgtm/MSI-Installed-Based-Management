require('dotenv').config();

const app = require('./app');
const { getDb, getDbConfigSummary } = require('./database/memory');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3000;

// On Vercel we export the app and never call listen(); everywhere else
// (Hostinger, npm start, npm run dev) it runs as a long-lived process.
if (!process.env.VERCEL) {
  const server = app.listen(PORT, HOST, () => {
    getDb().then(() => {
      const cfg = getDbConfigSummary();
      console.log(`Database: ${cfg.mode} → ${cfg.host}`);
      console.log(`Server running at port ${PORT}`);
    }).catch(error => {
      console.error('Failed to initialize database config:', error);
    });
  });

  server.on('error', (error) => {
    console.error('Server failed to start:', error);
    process.exit(1);
  });
}

module.exports = app;
