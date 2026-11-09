const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'public', 'manifest.webmanifest');

/**
 * Serves the web app manifest with related_applications pointing at the address
 * the page was loaded from. Chrome's getInstalledRelatedApps() only reports an
 * installed app when its manifest URL is listed there, so a hard-coded
 * production address meant a copy installed from localhost or a phone-test
 * address was never recognised as installed.
 */
function manifestHandler({ cache = false } = {}) {
  return (req, res, next) => {
    fs.readFile(MANIFEST_PATH, 'utf8', (err, text) => {
      if (err) return next();
      let manifest;
      try { manifest = JSON.parse(text); } catch (e) { return next(); }
      manifest.related_applications = [{
        platform: 'webapp',
        url: `${req.protocol}://${req.get('host')}/manifest.webmanifest`
      }];
      res.type('application/manifest+json');
      res.setHeader('Cache-Control', cache ? 'public, max-age=3600' : 'no-store');
      res.send(JSON.stringify(manifest));
    });
  };
}

module.exports = { manifestHandler };
