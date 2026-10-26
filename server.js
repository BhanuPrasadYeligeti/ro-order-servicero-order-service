const cds = require('@sap/cds');
const LOG = cds.log('order-service');

const SEED_PRODUCTS = [
  { ID: 'HT-1000', name: 'Notebook Basic 15',        category: 'Notebooks',   price: 956.00,  currency: 'EUR', stock: 25 },
  { ID: 'HT-1001', name: 'Notebook Basic 17',        category: 'Notebooks',   price: 1249.00, currency: 'EUR', stock: 10 },
  { ID: 'HT-1010', name: 'Notebook Professional 15', category: 'Notebooks',   price: 1999.00, currency: 'EUR', stock: 3 },
  { ID: 'HT-1063', name: 'Ergonomic Keyboard',       category: 'Accessories', price: 14.00,   currency: 'EUR', stock: 150 },
  { ID: 'HT-1068', name: 'Wireless Mouse',           category: 'Accessories', price: 9.00,    currency: 'EUR', stock: 0 },
  { ID: 'HT-9992', name: 'Flat Screen Monitor 24',   category: 'Monitors',    price: 234.00,  currency: 'EUR', stock: 40 }
];

// The app uses an in-memory SQLite DB (test app, no HANA needed).
// In production mode CAP does not create the tables automatically, so do it once at startup.
cds.on('served', async () => {
  const db = await cds.connect.to('db');
  await cds.deploy('*').to(db); // compiles the db model from source and creates the tables
  const { Products } = cds.entities('ro.sales');
  const { count } = await SELECT.one`count(*) as count`.from(Products);
  if (!count) await INSERT.into(Products).entries(SEED_PRODUCTS);
  LOG.info('In-memory database ready with demo products');
});

module.exports = cds.server;
