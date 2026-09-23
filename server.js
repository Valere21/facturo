import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import nodemailer from 'nodemailer';
import { db, owner, setOwner, nextNumber, advanceSequenceFromNumber, row, rows, run } from './lib/database.js';
import { makeInvoicePdf } from './lib/pdf.js';

const app = express();
const port = Number(process.env.PORT || 3030);
const archiveDir = path.resolve(process.env.ARCHIVE_DIR || './storage/archive');
const today = () => new Date().toISOString().slice(0, 10);
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const cents = value => Math.round(Number(value || 0) * 100);
const clean = value => String(value ?? '').trim();
const optionalNumber = value => clean(value) === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const taxIncluded = value => ![false, 0, '0', 'false'].includes(value);

app.use(express.json({ limit: '25mb' }));
app.use(express.static('public'));

function clientById(id) {
  return row('SELECT * FROM clients WHERE id = ?', Number(id));
}

function siteById(id) {
  return row('SELECT * FROM sites WHERE id = ?', Number(id));
}

function liveInvoice(id) {
  const invoice = row('SELECT * FROM invoices WHERE id = ?', Number(id));
  if (!invoice) return null;
  const client = clientById(invoice.client_id);
  const site = invoice.site_id ? siteById(invoice.site_id) : null;
  const lines = rows('SELECT l.*, s.label AS site_label FROM invoice_lines l LEFT JOIN sites s ON s.id=l.site_id WHERE l.invoice_id = ? ORDER BY l.position, l.id', invoice.id);
  return { invoice, client, site, lines, owner: owner() };
}

function materializedInvoice(id) {
  const live = liveInvoice(id);
  if (!live) return null;
  if (!live.invoice.snapshot) return live;
  const saved = JSON.parse(live.invoice.snapshot);
  return { ...saved, invoice: { ...saved.invoice, ...live.invoice, total_cents: saved.invoice.total_cents } };
}

function publicInvoice(value) {
  return { ...value.invoice, client: value.client, site: value.site, lines: value.lines, owner: value.owner };
}

function lineTotal(line) {
  return Math.round(Number(line.quantity) * Number(line.unit_price_cents) * (taxIncluded(line.tax_included) ? 1 : 1.2));
}

function invoiceTotal(lines) {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

function normaliseLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Ajoutez au moins une prestation.');
  return lines.map((line, position) => {
    const description = clean(line.description);
    const quantity = Number(line.quantity);
    const unitPrice = line.unit_price_cents !== undefined ? Math.round(Number(line.unit_price_cents)) : cents(line.unit_price);
    if (!description) throw new Error(`La ligne ${position + 1} doit avoir une description.`);
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`La quantité de la ligne ${position + 1} doit être un entier naturel.`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Le tarif de la ligne ${position + 1} est invalide.`);
    const tax_included = taxIncluded(line.tax_included);
    const site_id = line.site_id ? Number(line.site_id) : null;
    if (site_id && !siteById(site_id)) throw new Error(`Le site de la ligne ${position + 1} est introuvable.`);
    return { description, quantity, unit_price_cents: unitPrice, tax_included, site_id, service_date: clean(line.service_date) || null, position };
  });
}

async function archive(invoiceId) {
  const material = materializedInvoice(invoiceId);
  if (!material) throw new Error('Facture introuvable.');
  const pdf = await makeInvoicePdf(material.invoice, material.owner, material.client, material.lines, material.site);
  const digest = sha256(pdf);
  const year = material.invoice.issue_date.slice(0, 4);
  const targetDir = path.join(archiveDir, year);
  const filename = `facture-${material.invoice.number}.pdf`;
  const target = path.join(targetDir, filename);
  await fs.mkdir(targetDir, { recursive: true });
  const temporary = path.join(targetDir, `.${filename}.${process.pid}.tmp`);
  await fs.writeFile(temporary, pdf, { mode: 0o640 });
  await fs.rename(temporary, target);
  const readBack = await fs.readFile(target);
  if (sha256(readBack) !== digest || readBack.length !== pdf.length) throw new Error('Échec de la vérification après archivage.');
  const relative = path.relative(process.cwd(), target);
  run('UPDATE invoices SET archived_path=?, archive_sha256=?, verified_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', relative, digest, new Date().toISOString(), invoiceId);
  run('INSERT INTO archive_records(invoice_id,path,sha256,bytes,verified_at) VALUES (?,?,?,?,?)', invoiceId, relative, digest, pdf.length, new Date().toISOString());
  return { pdf, digest, path: relative, bytes: pdf.length };
}

async function verifyArchive(invoice) {
  if (!invoice.archived_path || !invoice.archive_sha256) return { ok: false, reason: 'Aucun PDF archivé' };
  try {
    const file = await fs.readFile(path.resolve(invoice.archived_path));
    return { ok: sha256(file) === invoice.archive_sha256, bytes: file.length, path: invoice.archived_path };
  } catch { return { ok: false, reason: 'Fichier absent ou illisible', path: invoice.archived_path }; }
}

function archiveFilePath(relativePath) {
  const root = path.resolve(archiveDir);
  const file = path.resolve(relativePath || '');
  if (!relativePath || (file !== root && !file.startsWith(`${root}${path.sep}`))) throw new Error('Chemin d’archive invalide dans la sauvegarde.');
  return file;
}

async function createBackup() {
  const data = {
    settings: rows('SELECT key,value FROM settings ORDER BY key'),
    clients: rows('SELECT * FROM clients ORDER BY id'),
    sites: rows('SELECT * FROM sites ORDER BY id'),
    services: rows('SELECT * FROM services ORDER BY id'),
    invoices: rows('SELECT * FROM invoices ORDER BY id'),
    invoice_lines: rows('SELECT * FROM invoice_lines ORDER BY id'),
    archive_records: rows('SELECT * FROM archive_records ORDER BY id')
  };
  const documents = [], warnings = [];
  for (const invoice of data.invoices.filter(item => item.archived_path)) {
    try {
      const content = await fs.readFile(archiveFilePath(invoice.archived_path));
      if (invoice.archive_sha256 && sha256(content) !== invoice.archive_sha256) throw new Error('empreinte différente');
      documents.push({ invoice_id: invoice.id, sha256: sha256(content), content_base64: content.toString('base64') });
    } catch (error) { warnings.push(`Facture ${invoice.number} : PDF non joint (${error.message}).`); }
  }
  return { format: 'facturato-backup', version: 1, exported_at: new Date().toISOString(), data, documents, warnings };
}

function requireBackupData(backup) {
  if (!backup || backup.format !== 'facturato-backup' || backup.version !== 1 || !backup.data) throw new Error('Fichier de sauvegarde Facturato invalide.');
  for (const table of ['settings', 'clients', 'sites', 'services', 'invoices', 'invoice_lines', 'archive_records']) {
    if (!Array.isArray(backup.data[table])) throw new Error(`Sauvegarde invalide : table ${table} absente.`);
  }
}

function insertRows(table, fields, values) {
  const sql = `INSERT INTO ${table}(${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`;
  for (const value of values) run(sql, ...fields.map(field => value[field] ?? null));
}

async function restoreBackup(backup) {
  requireBackupData(backup);
  const invoiceById = new Map(backup.data.invoices.map(invoice => [Number(invoice.id), invoice]));
  const documents = Array.isArray(backup.documents) ? backup.documents : [];
  const documentsByInvoice = new Map(documents.map(document => [Number(document.invoice_id), document]));
  const requiredDocuments = backup.data.invoices.filter(invoice => invoice.archived_path);
  if (documentsByInvoice.size !== requiredDocuments.length || requiredDocuments.some(invoice => !documentsByInvoice.has(Number(invoice.id)))) throw new Error('La sauvegarde ne contient pas tous les PDF archivés.');
  for (const invoice of requiredDocuments) {
    const document = documentsByInvoice.get(Number(invoice.id));
    if (!invoice?.archived_path || typeof document.content_base64 !== 'string') throw new Error('Document PDF invalide dans la sauvegarde.');
    const content = Buffer.from(document.content_base64, 'base64');
    const digest = sha256(content);
    if (digest !== document.sha256 || (invoice.archive_sha256 && digest !== invoice.archive_sha256)) throw new Error(`PDF de la facture ${invoice.number} corrompu.`);
    const target = archiveFilePath(invoice.archived_path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.restore`;
    await fs.writeFile(temporary, content, { mode: 0o640 });
    await fs.rename(temporary, target);
  }
  db.exec('BEGIN');
  try {
    for (const table of ['archive_records', 'invoice_lines', 'invoices', 'services', 'sites', 'clients', 'settings']) db.exec(`DELETE FROM ${table}`);
    insertRows('settings', ['key', 'value'], backup.data.settings);
    insertRows('clients', ['id', 'name', 'contact', 'email', 'phone', 'address', 'siren', 'created_at'], backup.data.clients);
    insertRows('sites', ['id', 'label', 'address', 'reference_first_name', 'reference_last_name', 'reference_phone', 'reference_email', 'latitude', 'longitude', 'created_at'], backup.data.sites);
    insertRows('services', ['id', 'name', 'description', 'unit_price_cents', 'default_quantity', 'created_at'], backup.data.services);
    insertRows('invoices', ['id', 'number', 'client_id', 'status', 'issue_date', 'due_date', 'notes', 'total_cents', 'snapshot', 'archived_path', 'archive_sha256', 'verified_at', 'created_at', 'updated_at', 'site_id'], backup.data.invoices);
    insertRows('invoice_lines', ['id', 'invoice_id', 'description', 'quantity', 'unit_price_cents', 'service_date', 'position', 'tax_included', 'site_id'], backup.data.invoice_lines);
    insertRows('archive_records', ['id', 'invoice_id', 'path', 'sha256', 'bytes', 'verified_at', 'created_at'], backup.data.archive_records);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { clients: backup.data.clients.length, sites: backup.data.sites.length, services: backup.data.services.length, invoices: backup.data.invoices.length, documents: documents.length };
}

async function sendInvoiceEmail(material, pdf, requestedRecipient = '') {
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) throw new Error('Configurez SMTP_HOST et MAIL_FROM dans .env pour activer l’envoi.');
  const recipient = clean(requestedRecipient) || material.client.email;
  if (!recipient) throw new Error('Aucun e-mail destinataire.');
  const attachment = pdf || await fs.readFile(path.resolve(material.invoice.archived_path));
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  await transport.sendMail({ from: process.env.MAIL_FROM, to: recipient, subject: `Facture ${material.invoice.number}`, text: `Bonjour,\n\nVeuillez trouver ci-joint la facture ${material.invoice.number}.\n\nCordialement,`, attachments: [{ filename: `facture-${material.invoice.number}.pdf`, content: attachment }] });
  return recipient;
}

async function archiveOnServer(invoiceId) {
  const live = liveInvoice(invoiceId);
  if (!live) throw new Error('Facture introuvable.');
  if (live.invoice.status === 'draft') {
    if (!live.lines.length) throw new Error('Ajoutez au moins une prestation avant l’archivage.');
    run("UPDATE invoices SET status='issued', snapshot=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", JSON.stringify(live), live.invoice.id);
  }
  const current = row('SELECT * FROM invoices WHERE id=?', live.invoice.id);
  const archiveResult = current.archived_path ? null : await archive(live.invoice.id);
  const archived = archiveResult ? { digest: archiveResult.digest, path: archiveResult.path, bytes: archiveResult.bytes } : await verifyArchive(current);
  return { invoice: publicInvoice(materializedInvoice(live.invoice.id)), archive: archived };
}

function dueDate(issueDate) {
  const date = new Date(`${issueDate}T12:00:00`);
  date.setDate(date.getDate() + 60);
  return date.toISOString().slice(0, 10);
}

app.get('/api/dashboard', async (_req, res, next) => {
  try {
    const invoices = rows(`SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id=i.client_id ORDER BY i.issue_date DESC, i.id DESC`);
    const issued = invoices.filter(i => i.status !== 'draft');
    const checks = await Promise.all(issued.filter(i => i.archived_path).map(async i => ({ id: i.id, ...(await verifyArchive(i)) })));
    const status = { draft: invoices.filter(i => i.status === 'draft').length, issued: issued.length, overdue: issued.filter(i => i.due_date && i.due_date < today()).length };
    res.json({
      totals: { invoiced_cents: issued.reduce((sum, i) => sum + i.total_cents, 0), draft_cents: invoices.filter(i => i.status === 'draft').reduce((sum, i) => sum + i.total_cents, 0), ...status },
      archive: { directory: archiveDir, checked: checks.length, valid: checks.filter(c => c.ok).length, invalid: checks.filter(c => !c.ok) },
      recent: invoices.slice(0, 6),
      warnings: checks.filter(c => !c.ok)
    });
  } catch (error) { next(error); }
});

app.get('/api/backup/export', async (_req, res, next) => {
  try {
    const backup = await createBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="facturato-sauvegarde-${stamp}.json"` }).send(JSON.stringify(backup));
  } catch (error) { next(error); }
});
app.post('/api/backup/import', async (req, res, next) => {
  try {
    if (req.body?.confirm !== true) throw new Error('Confirmez la restauration de la sauvegarde.');
    const restored = await restoreBackup(req.body.backup);
    res.json({ ok: true, restored });
  } catch (error) { next(error); }
});

app.get('/api/settings/owner', (_req, res) => res.json(owner()));
app.put('/api/settings/owner', (req, res, next) => {
  try {
    const value = { ...owner(), ...req.body };
    if (!clean(value.name) || !clean(value.tradeName)) throw new Error('Le nom et la raison commerciale sont requis.');
    setOwner(value);
    res.json(value);
  } catch (error) { next(error); }
});

app.get('/api/clients', (_req, res) => res.json(rows('SELECT * FROM clients ORDER BY name COLLATE NOCASE')));
app.post('/api/clients', (req, res, next) => {
  try {
    const b = req.body;
    if (!clean(b.name)) throw new Error('Le nom du client est requis.');
    const result = run('INSERT INTO clients(name,contact,email,phone,address,siren) VALUES (?,?,?,?,?,?)', clean(b.name), clean(b.contact), clean(b.email), clean(b.phone), clean(b.address), clean(b.siren));
    res.status(201).json(clientById(result.lastInsertRowid));
  } catch (error) { next(error); }
});
app.put('/api/clients/:id', (req, res, next) => {
  try {
    const b = req.body;
    if (!clean(b.name)) throw new Error('Le nom du client est requis.');
    run('UPDATE clients SET name=?,contact=?,email=?,phone=?,address=?,siren=? WHERE id=?', clean(b.name), clean(b.contact), clean(b.email), clean(b.phone), clean(b.address), clean(b.siren), Number(req.params.id));
    const saved = clientById(req.params.id); if (!saved) return res.status(404).json({ error: 'Client introuvable.' });
    res.json(saved);
  } catch (error) { next(error); }
});
app.delete('/api/clients/:id', (req, res, next) => {
  try {
    const used = row('SELECT 1 FROM invoices WHERE client_id=? LIMIT 1', Number(req.params.id));
    if (used) return res.status(409).json({ error: 'Ce client est utilisé par une facture et ne peut pas être supprimé.' });
    run('DELETE FROM clients WHERE id=?', Number(req.params.id));
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/sites', (_req, res) => res.json(rows('SELECT * FROM sites ORDER BY label COLLATE NOCASE')));
app.post('/api/sites', (req, res, next) => {
  try {
    const b = req.body;
    if (!clean(b.label)) throw new Error('Le label du site est requis.');
    const result = run('INSERT INTO sites(label,address,reference_first_name,reference_last_name,reference_phone,reference_email,latitude,longitude) VALUES (?,?,?,?,?,?,?,?)', clean(b.label), clean(b.address), clean(b.reference_first_name), clean(b.reference_last_name), clean(b.reference_phone), clean(b.reference_email), optionalNumber(b.latitude), optionalNumber(b.longitude));
    res.status(201).json(siteById(result.lastInsertRowid));
  } catch (error) { next(error); }
});
app.put('/api/sites/:id', (req, res, next) => {
  try {
    const b = req.body;
    if (!clean(b.label)) throw new Error('Le label du site est requis.');
    run('UPDATE sites SET label=?,address=?,reference_first_name=?,reference_last_name=?,reference_phone=?,reference_email=?,latitude=?,longitude=? WHERE id=?', clean(b.label), clean(b.address), clean(b.reference_first_name), clean(b.reference_last_name), clean(b.reference_phone), clean(b.reference_email), optionalNumber(b.latitude), optionalNumber(b.longitude), Number(req.params.id));
    const saved = siteById(req.params.id); if (!saved) return res.status(404).json({ error: 'Site introuvable.' });
    res.json(saved);
  } catch (error) { next(error); }
});
app.delete('/api/sites/:id', (req, res, next) => {
  try {
    const used = row('SELECT 1 FROM invoices WHERE site_id=? UNION SELECT 1 FROM invoice_lines WHERE site_id=? LIMIT 1', Number(req.params.id), Number(req.params.id));
    if (used) return res.status(409).json({ error: 'Ce site est utilisé par une facture et ne peut pas être supprimé.' });
    run('DELETE FROM sites WHERE id=?', Number(req.params.id));
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/services', (_req, res) => res.json(rows('SELECT * FROM services ORDER BY name COLLATE NOCASE')));
app.post('/api/services', (req, res, next) => {
  try {
    const b = req.body; if (!clean(b.name)) throw new Error('Le nom du service est requis.');
    const quantity = Number(b.default_quantity || 1); if (!Number.isInteger(quantity) || quantity < 1) throw new Error('La quantité par défaut doit être un entier naturel.');
    const result = run('INSERT INTO services(name,description,unit_price_cents,default_quantity) VALUES (?,?,?,?)', clean(b.name), clean(b.description), cents(b.unit_price), quantity);
    res.status(201).json(row('SELECT * FROM services WHERE id=?', result.lastInsertRowid));
  } catch (error) { next(error); }
});
app.put('/api/services/:id', (req, res, next) => {
  try {
    const b = req.body; if (!clean(b.name)) throw new Error('Le nom du service est requis.');
    const quantity = Number(b.default_quantity || 1); if (!Number.isInteger(quantity) || quantity < 1) throw new Error('La quantité par défaut doit être un entier naturel.');
    run('UPDATE services SET name=?,description=?,unit_price_cents=?,default_quantity=? WHERE id=?', clean(b.name), clean(b.description), cents(b.unit_price), quantity, Number(req.params.id));
    const saved = row('SELECT * FROM services WHERE id=?', Number(req.params.id)); if (!saved) return res.status(404).json({ error: 'Service introuvable.' });
    res.json(saved);
  } catch (error) { next(error); }
});
app.delete('/api/services/:id', (req, res, next) => { try { run('DELETE FROM services WHERE id=?', Number(req.params.id)); res.status(204).end(); } catch (error) { next(error); } });

app.get('/api/invoices', (_req, res) => {
  res.json(rows(`SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id=i.client_id ORDER BY i.issue_date DESC, i.id DESC`));
});
app.get('/api/invoices/:id', (req, res) => {
  const value = materializedInvoice(req.params.id);
  if (!value) return res.status(404).json({ error: 'Facture introuvable.' });
  res.json(publicInvoice(value));
});
app.post('/api/invoices', (req, res, next) => {
  try {
    const b = req.body;
    const client = clientById(b.client_id);
    if (!client) return res.status(400).json({ error: 'Sélectionnez un client.' });
    const issueDate = clean(b.issue_date) || today();
    const site = b.site_id ? siteById(b.site_id) : null;
    if (b.site_id && !site) return res.status(400).json({ error: 'Sélectionnez un site valide.' });
    const result = run('INSERT INTO invoices(number,client_id,site_id,issue_date,due_date,notes) VALUES (?,?,?,?,?,?)', nextNumber(), client.id, site?.id || null, issueDate, clean(b.due_date) || dueDate(issueDate), clean(b.notes));
    res.status(201).json(publicInvoice(liveInvoice(result.lastInsertRowid)));
  } catch (error) { next(error); }
});
app.put('/api/invoices/:id', (req, res, next) => {
  try {
    const existing = liveInvoice(req.params.id); if (!existing) return res.status(404).json({ error: 'Facture introuvable.' });
    if (existing.invoice.status !== 'draft') return res.status(409).json({ error: 'Une facture émise est figée. Créez un avoir ou une nouvelle facture.' });
    const b = req.body, client = clientById(b.client_id);
    if (!client) return res.status(400).json({ error: 'Sélectionnez un client.' });
    const number = clean(b.number || existing.invoice.number);
    if (!/^\d+$/.test(number) || Number(number) < 1) throw new Error('Le numéro de facture doit être un entier positif.');
    const duplicate = row('SELECT id FROM invoices WHERE number=? AND id<>?', number, existing.invoice.id);
    if (duplicate) throw new Error('Ce numéro de facture est déjà utilisé.');
    const lines = normaliseLines(b.lines);
    db.exec('BEGIN');
    try {
      run('UPDATE invoices SET number=?,client_id=?,issue_date=?,due_date=?,notes=?,total_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', number, client.id, clean(b.issue_date) || today(), clean(b.due_date) || dueDate(clean(b.issue_date) || today()), clean(b.notes), invoiceTotal(lines), existing.invoice.id);
      if (number !== existing.invoice.number) advanceSequenceFromNumber(number);
      run('DELETE FROM invoice_lines WHERE invoice_id=?', existing.invoice.id);
      for (const line of lines) run('INSERT INTO invoice_lines(invoice_id,description,quantity,unit_price_cents,tax_included,site_id,service_date,position) VALUES (?,?,?,?,?,?,?,?)', existing.invoice.id, line.description, line.quantity, line.unit_price_cents, line.tax_included ? 1 : 0, line.site_id, line.service_date, line.position);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json(publicInvoice(liveInvoice(existing.invoice.id)));
  } catch (error) { next(error); }
});
app.delete('/api/invoices/:id', (req, res, next) => {
  try {
    const invoice = liveInvoice(req.params.id); if (!invoice) return res.status(404).json({ error: 'Facture introuvable.' });
    if (invoice.invoice.status !== 'draft') return res.status(409).json({ error: 'Une facture émise ne peut pas être supprimée.' });
    run('DELETE FROM invoices WHERE id=?', invoice.invoice.id); res.status(204).end();
  } catch (error) { next(error); }
});
app.post('/api/invoices/:id/issue', async (req, res, next) => {
  try {
    res.json(await archiveOnServer(req.params.id));
  } catch (error) { next(error); }
});
app.post('/api/invoices/:id/archive', async (req, res, next) => {
  try { res.json(await archiveOnServer(req.params.id)); } catch (error) { next(error); }
});
app.get('/api/invoices/:id/pdf', async (req, res, next) => {
  try {
    const material = materializedInvoice(req.params.id); if (!material) return res.status(404).json({ error: 'Facture introuvable.' });
    let pdf;
    if (material.invoice.archived_path) pdf = await fs.readFile(path.resolve(material.invoice.archived_path));
    else pdf = await makeInvoicePdf(material.invoice, material.owner, material.client, material.lines, material.site);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="facture-${material.invoice.number}.pdf"` }).send(pdf);
  } catch (error) { next(error); }
});
app.get('/api/invoices/:id/archive-check', async (req, res, next) => {
  try {
    const invoice = row('SELECT * FROM invoices WHERE id=?', Number(req.params.id)); if (!invoice) return res.status(404).json({ error: 'Facture introuvable.' });
    res.json(await verifyArchive(invoice));
  } catch (error) { next(error); }
});
app.post('/api/invoices/:id/email', async (req, res, next) => {
  try {
    const material = materializedInvoice(req.params.id); if (!material) return res.status(404).json({ error: 'Facture introuvable.' });
    if (material.invoice.status === 'draft') return res.status(409).json({ error: 'Émettez la facture avant de l’envoyer.' });
    const recipient = await sendInvoiceEmail(material, null, req.body.to);
    run("UPDATE invoices SET status='sent', updated_at=CURRENT_TIMESTAMP WHERE id=?", material.invoice.id);
    res.json({ ok: true, to: recipient });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(400).json({ error: error.message || 'Une erreur est survenue.' });
});

app.listen(port, () => console.log(`Facturato prêt sur http://localhost:${port}`));
