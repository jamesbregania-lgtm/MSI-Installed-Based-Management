// Browser smoke test with synthetic records only. Requires Playwright in NODE_PATH.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { chromium } = require('playwright');

const record = {
  id: 1234, client_id: 'sample', client_name: 'Sample Client', location: 'Manila',
  unit: 'CIJ', model: '9750', serial_no: 'SN-1234', date_installed: '01/01/2025',
  status: 'Active', disabled_at: '2026-10-20T00:00:00Z', running_hours: 120,
  initial_running_hours: 0, initial_status: 'Active', submitted_by: 'Test Technician',
  updates: [{ date: '02/10/2026', smrDate: '2026-10-01', activityType: 'Repair', runningHours: 120, status: 'Active', submittedBy: 'Test Technician' },
    { date: '03/10/2026', activityType: 'Cannibalize', partsUpdated: ['Test part [SN-OTHER]'], submittedBy: 'Test Technician' }],
  reports: [{ updateIndex: null, refNo: 'INSTALL', problem: 'N/A' },
    { updateIndex: 0, refNo: 'SR-100', submittedBy: 'Test Technician', problem: 'Motor stopped\nSecond line', action: 'Repaired motor', recommendation: 'Monitor operation', technicians: ['Second Technician'] }]
};
const initialRecord = JSON.parse(JSON.stringify(record));
const savedCorrections = [];
const client = { id: 'sample', name: 'Sample Client', location: 'Manila', status: 'active' };
const client2 = {id:'other',name:'Other Client',location:'Cainta, Rizal',status:'active'};
const client3 = {id:'blank',name:'Blank Client',location:'',status:'active'};
client.location='Cabuyao, Laguna';
// Exercise the same assigned-client scope used by Sales on main.
for (const testClient of [client, client2, client3]) testClient.sales_username = 'preview';
record.updates[0].report = record.reports[1];
const database = {
  from(table) {
    let single = false;
    let match = '';
    let patch = null;
    const query = new Proxy({}, {
      get(target, key) {
        if (key === 'then') {
          if (patch && table === 'machines') Object.assign(record, patch);
          let data = table === 'machines' ? [record,{...record,id:1235,client_id:'other',client_name:'Other Client',serial_no:'SN-OTHER'}, {...record,id:1236,client_id:'blank',client_name:'Blank Client',serial_no:'SN-BLANK'}] : table === 'clients' ? [client,client2,client3] : table === 'accounts' ? [{ username: 'third', full_name: 'Third Technician', role: 'user', status: 'active' }] : [];
          if (match.includes('missing')) data = [];
          return (resolve, reject) => Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject);
        }
        return (...args) => {
          if (key === 'maybeSingle') single = true;
          if (key === 'ilike') match = args[1];
          if (key === 'update') patch = args[0];
          return query;
        };
      }
    });
    return query;
  }
};
const dbPath = require.resolve('../database/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path.endsWith('/machines/report/edit')) savedCorrections.push(req.body);
  next();
});
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use((req, res, next) => {
  req.session = { user: { username: 'preview', fullName: 'Preview User', role: req.headers['x-test-role'] || 'admin', department: 'Technical' } };
  res.locals.formatRoleLabel = role => role === 'user' ? 'Technician' : role;
  next();
});
app.use(express.static(path.join(__dirname, '../public')));
app.use('/admin_account', require('../routes/admin.routes'));
app.use('/client', require('../routes/client.routes'));
app.use('/user_account', require('../routes/asset.routes'));
app.use((error, req, res, next) => { console.error(error); res.status(500).send('Preview error'); });


(async () => {
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 let browser;
 try {
  browser=await chromium.launch({channel:'msedge',headless:true});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const errors=[];
  for(const role of ['admin','sales']) {
   const page=await browser.newPage({viewport:{width:1440,height:1000},extraHTTPHeaders:{'x-test-role':role}});
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/admin_account');
   await page.locator('[data-section="activity-log"]').click();
   const visible=page.locator('#monitorActivityBody .monitor-row:not([hidden])');
   const total=await visible.count();assert.ok(total>=9);
   assert.equal(await page.locator('#monitorActivityTable th').nth(3).textContent(),'Location');
   assert.equal(await page.locator('.monitor-row[data-client="Sample Client"] .monitor-client-location').first().textContent(),'Cabuyao, Laguna');
   assert.equal(await page.locator('.monitor-row[data-client="Blank Client"] .monitor-client-location').first().textContent(),'—');
   await page.locator('#monitorLocationFilter').fill('  cAbUyAo  ');
   const filtered=await visible.count();assert.ok(filtered>0 && filtered<total);
   for(const location of await visible.evaluateAll(rows=>rows.map(row=>row.dataset.location)))assert.equal(location,'Cabuyao, Laguna');
   await page.locator('#monitorClientFilter').fill('Other Client');
   assert.equal(await visible.count(),0);
   assert.equal(await page.locator('#monitorNoResults').isVisible(),true);
   await page.locator('#monitorClientFilter').fill('');
   assert.equal(await visible.count(),filtered);
   await page.locator('#monitorSortFilter').selectOption('date-asc');
   assert.equal(await visible.count(),filtered);
   const downloadPromise=page.waitForEvent('download');
   await page.getByRole('button',{name:'Export CSV',exact:true}).click();
   const download=await downloadPromise;
   const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);
   const csv=Buffer.concat(chunks).toString('utf8');
   assert.match(csv.split('\n')[0],/Client,Client Location,Unit/);
   assert.match(csv, /"Cabuyao, Laguna"/);
   assert.equal(csv.includes('Other Client'),false);
   assert.match(csv,/Repair/);assert.match(csv,/Motor stopped/);
   await page.locator('#monitorLocationFilter').fill('does-not-exist');assert.equal(await visible.count(),0);
   await page.locator('#monitorLocationFilter').fill('');assert.equal(await visible.count(),total);
   fs.mkdirSync(path.join(__dirname,'../outputs/activity-location'),{recursive:true});
   if(role==='admin')await page.screenshot({path:path.join(__dirname,'../outputs/activity-location/desktop.png')});
   await page.setViewportSize({width:390,height:844});
   await page.locator('#monitorLocationFilter').fill('rizal');
   assert.ok(await visible.count()>0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(role==='sales')await page.screenshot({path:path.join(__dirname,'../outputs/activity-location/mobile.png')});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: Admin/Sales location column, current-client address, missing locations, live partial filtering, combined filters, sorting, CSV content, empty state and mobile layout.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
