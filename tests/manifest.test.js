const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const http = require('node:http');
const express = require('express');
const { manifestHandler } = require('../lib/manifest');

// The installed-app check only works if the manifest names the address it was
// loaded from, whatever that is (production, localhost, a phone-test address).

// fetch() won't let a test choose the Host header, so use http directly.
function get(port, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/manifest.webmanifest', headers }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], json: JSON.parse(body) }));
    }).on('error', reject);
  });
}

let server;
let port;
before(async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/manifest.webmanifest', manifestHandler());
  server = await new Promise(resolve => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  port = server.address().port;
});
after(() => new Promise(resolve => server.close(resolve)));

test('related_applications names the address the manifest was loaded from', async () => {
  const response = await get(port, { Host: '192.168.0.71:3000' });
  assert.equal(response.status, 200);
  assert.match(response.type, /manifest\+json/);
  const manifest = response.json;
  assert.deepEqual(manifest.related_applications, [
    { platform: 'webapp', url: 'http://192.168.0.71:3000/manifest.webmanifest' }
  ]);
  assert.equal(manifest.start_url, '/user_account#schedule');
});

test('behind the HTTPS proxy it names the https address', async () => {
  const response = await get(port, { Host: 'matsoltechnical.com', 'X-Forwarded-Proto': 'https' });
  const manifest = response.json;
  assert.equal(manifest.related_applications[0].url, 'https://matsoltechnical.com/manifest.webmanifest');
});
