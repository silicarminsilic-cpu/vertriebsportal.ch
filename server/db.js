const { Pool } = require('pg');

const connectionString =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;

if (!connectionString) {
  console.warn(
    '[db] Keine Datenbank-Verbindung gefunden (NETLIFY_DATABASE_URL / DATABASE_URL fehlt in der Umgebung). ' +
    'Auf Netlify: `netlify db init` bzw. Netlify DB im Team-Dashboard aktivieren. Lokal: DATABASE_URL in .env setzen.'
  );
}

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: connectionString && !/localhost|127\.0\.0\.1/.test(connectionString) ? { rejectUnauthorized: false } : false,
      max: 3,
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

let migrationPromise = null;
function ensureSchema() {
  if (!migrationPromise) {
    migrationPromise = query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        branche TEXT DEFAULT '',
        typkunde TEXT DEFAULT '',
        street TEXT DEFAULT '',
        zip TEXT DEFAULT '',
        city TEXT DEFAULT '',
        country TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS street TEXT DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS zip TEXT DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        offer_number TEXT NOT NULL DEFAULT '',
        invoice_number TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Bestellung eingegangen',
        subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CHF',
        email_sent BOOLEAN NOT NULL DEFAULT false,
        billing_street TEXT NOT NULL DEFAULT '',
        billing_zip TEXT NOT NULL DEFAULT '',
        billing_city TEXT NOT NULL DEFAULT '',
        billing_country TEXT NOT NULL DEFAULT '',
        billing_phone TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_street TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_zip TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_city TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_country TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_phone TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        product_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price NUMERIC(10,2) NOT NULL,
        total NUMERIC(10,2) NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    `).catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

module.exports = { query, ensureSchema, getPool };
