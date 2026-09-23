import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'facturato.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '',
    address TEXT DEFAULT '', siren TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', unit_price_cents INTEGER NOT NULL DEFAULT 0,
    default_quantity REAL NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL REFERENCES clients(id), status TEXT NOT NULL DEFAULT 'draft',
    issue_date TEXT NOT NULL, due_date TEXT, notes TEXT DEFAULT '', total_cents INTEGER NOT NULL DEFAULT 0,
    snapshot TEXT, archived_path TEXT, archive_sha256 TEXT, verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invoice_lines (
    id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, description TEXT NOT NULL,
    quantity REAL NOT NULL, unit_price_cents INTEGER NOT NULL, service_date TEXT, position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS archive_records (
    id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, path TEXT NOT NULL, sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL, verified_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const defaults = {
  owner: JSON.stringify({
    tradeName: 'GAY-HEUZEY', name: 'Valère GAY-HEUZEY', address: '10 rue Madelaine Chartier · POISSY 78300',
    siret: '924 695 661 00034', email: 'valere.gh@hotmail.fr', phone: '06 27 82 14 90',
    bank: 'Société Générale', iban: '',
    paymentTerms: 'Le paiement est dû au maximum 60 jours après émission de la facture.\nDes frais supplémentaires s’appliquent en cas de retard (40 € d’indemnités + pénalités légales).'
  }),
  sequence: '6'
};
for (const [key, value] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(key, value);

export function setting(key) { return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value; }
export function setSetting(key, value) { db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
export function owner() { return JSON.parse(setting('owner')); }
export function setOwner(value) { setSetting('owner', JSON.stringify(value)); }
export function nextNumber() {
  const current = Number(setting('sequence') || '1');
  setSetting('sequence', String(current + 1));
  return String(current).padStart(3, '0');
}
export function rows(sql, ...params) { return db.prepare(sql).all(...params); }
export function row(sql, ...params) { return db.prepare(sql).get(...params); }
export function run(sql, ...params) { return db.prepare(sql).run(...params); }
