const cds = require('@sap/cds');
const LOG = cds.log('order-service');
require('./srv/calm-push'); // pushes warnings/errors to SAP Cloud ALM (Raw Data Inbound Logs API), see srv/calm-push.js

// Same demo data as db/data/*.csv (loaded here because the production build may not ship the CSV files)
const SEED_PRODUCTS = [
  { ID: 'HT-1000', name: 'Notebook Basic 15',        category: 'Notebooks',   price: 956.00,  currency: 'EUR', stock: 25,  reorderLevel: 5,  packSize: 1,  maxOrderQty: 20,  discontinued: false },
  { ID: 'HT-1001', name: 'Notebook Basic 17',        category: 'Notebooks',   price: 1249.00, currency: 'EUR', stock: 10,  reorderLevel: 5,  packSize: 1,  maxOrderQty: 20,  discontinued: true, successor: 'HT-1000' },
  { ID: 'HT-1010', name: 'Notebook Professional 15', category: 'Notebooks',   price: 1999.00, currency: 'EUR', stock: 3,   reorderLevel: 5,  packSize: 1,  maxOrderQty: 10,  discontinued: false },
  { ID: 'HT-1063', name: 'Ergonomic Keyboard',       category: 'Accessories', price: 14.00,   currency: 'EUR', stock: 150, reorderLevel: 20, packSize: 10, maxOrderQty: 500, discontinued: false },
  { ID: 'HT-1068', name: 'Wireless Mouse',           category: 'Accessories', price: 9.00,    currency: 'EUR', stock: 0,   reorderLevel: 20, packSize: 1,  maxOrderQty: 500, discontinued: false },
  { ID: 'HT-9992', name: 'Flat Screen Monitor 24',   category: 'Monitors',    price: 234.00,  currency: 'EUR', stock: 40,  reorderLevel: 10, packSize: 1,  maxOrderQty: 20,  discontinued: false }
];

const SEED_CUSTOMERS = [
  { ID: 'C-1001', name: 'Cloudfulcrum Pvt Ltd',   city: 'Bengaluru', creditLimit: 25000.00,  currency: 'EUR', blocked: false },
  { ID: 'C-1002', name: 'SAP BTP',                city: 'Pune',      creditLimit: 50000.00,  currency: 'EUR', blocked: true, blockReason: 'Order block: invoices overdue more than 60 days' },
  { ID: 'C-1003', name: 'Dwp Global Corp',        city: 'Mysuru',    creditLimit: 100000.00, currency: 'EUR', blocked: false },
  { ID: 'C-1004', name: 'SAP CPI',                city: 'Mumbai',    creditLimit: 5000.00,   currency: 'EUR', blocked: false },
  { ID: 'C-1005', name: 'Release Owl',            city: 'Bengaluru', creditLimit: 40000.00,  currency: 'EUR', blocked: false }
];

// The app uses an in-memory SQLite DB (test app, no HANA needed).
// In production mode CAP does not create the tables automatically, so do it once at startup.
cds.on('served', async () => {
  const db = await cds.connect.to('db');
  await cds.deploy('*').to(db); // compiles the db model from source and creates the tables
  const { Products, Customers } = cds.entities('ro.sales');
  const p = await SELECT.one`count(*) as count`.from(Products);
  if (!p.count) await INSERT.into(Products).entries(SEED_PRODUCTS);
  const c = await SELECT.one`count(*) as count`.from(Customers);
  if (!c.count) await INSERT.into(Customers).entries(SEED_CUSTOMERS);
  LOG.info('In-memory database ready with demo products and customers');
});

module.exports = cds.server;
