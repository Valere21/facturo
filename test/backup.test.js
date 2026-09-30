import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function makeBackup() {
  const owner = {
    tradeName: 'Émetteur de test',
    name: 'Facturo Test',
    address: '1 rue du Test',
    siret: '12345678900001',
    email: 'test@example.test',
    phone: '',
    bank: '',
    iban: '',
    paymentTerms: 'Paiement sous 30 jours.'
  };
  const client = {
    id: 7,
    name: 'Client migré',
    contact: 'Contact test',
    email: 'client@example.test',
    phone: '',
    address: '2 avenue du Client',
    siren: '987654321',
    created_at: '2026-01-01 10:00:00'
  };
  const site = {
    id: 8,
    label: 'Site migré',
    address: '3 place du Site',
    reference_first_name: 'Référent',
    reference_last_name: 'Test',
    reference_phone: '',
    reference_email: 'site@example.test',
    latitude: null,
    longitude: null,
    created_at: '2026-01-01 10:00:00'
  };
  const line = {
    id: 100,
    invoice_id: 10,
    description: 'Prestation archivée',
    quantity: 2,
    unit_price_cents: 5000,
    service_date: '2026-01-02',
    position: 0,
    tax_included: 1,
    site_id: 8
  };
  const archivedPdf = Buffer.from('%PDF-1.4 facturo backup integration test\n', 'utf8');
  const archivedDigest = digest(archivedPdf);
  const issuedInvoice = {
    id: 10,
    number: '001',
    client_id: 7,
    status: 'issued',
    issue_date: '2026-01-02',
    due_date: '2026-02-01',
    notes: '',
    total_cents: 10000,
    archived_path: 'storage/archive/2026/facture-001.pdf',
    archive_sha256: archivedDigest,
    verified_at: '2026-01-02T10:00:00.000Z',
    created_at: '2026-01-02 10:00:00',
    updated_at: '2026-01-02 10:00:00',
    site_id: null
  };
  const draftInvoice = {
    id: 11,
    number: '002',
    client_id: 7,
    status: 'draft',
    issue_date: '2026-01-03',
    due_date: '2026-02-02',
    notes: 'Brouillon restauré',
    total_cents: 2500,
    snapshot: null,
    archived_path: null,
    archive_sha256: null,
    verified_at: null,
    created_at: '2026-01-03 10:00:00',
    updated_at: '2026-01-03 10:00:00',
    site_id: null
  };
  issuedInvoice.snapshot = JSON.stringify({
    invoice: issuedInvoice,
    client,
    site,
    lines: [{ ...line, site_label: site.label }],
    owner
  });

  return {
    format: 'facturo-backup',
    version: 1,
    exported_at: '2026-01-03T10:00:00.000Z',
    data: {
      settings: [
        { key: 'owner', value: JSON.stringify(owner) },
        { key: 'sequence', value: '3' },
        { key: 'sequence_width', value: '3' }
      ],
      clients: [client],
      sites: [site],
      services: [{
        id: 9,
        name: 'Service migré',
        description: 'Service de test',
        unit_price_cents: 5000,
        default_quantity: 1,
        created_at: '2026-01-01 10:00:00'
      }],
      invoices: [issuedInvoice, draftInvoice],
      invoice_lines: [line, {
        id: 101,
        invoice_id: 11,
        description: 'Prestation en brouillon',
        quantity: 1,
        unit_price_cents: 2500,
        service_date: '2026-01-03',
        position: 0,
        tax_included: 1,
        site_id: 8
      }],
      archive_records: [{
        id: 90,
        invoice_id: 10,
        path: 'storage/archive/2026/facture-001.pdf',
        sha256: archivedDigest,
        bytes: archivedPdf.length,
        verified_at: '2026-01-02T10:00:00.000Z',
        created_at: '2026-01-02 10:00:00'
      }]
    },
    documents: [{ invoice_id: 10, sha256: archivedDigest, content_base64: archivedPdf.toString('base64') }],
    warnings: []
  };
}

async function waitForHttp(url, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Facturo s'est arrêté avant le démarrage : ${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Le serveur peut encore être en train d'ouvrir son port.
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Facturo n'a pas démarré : ${output()}`);
}

test('restores settings, clients, sites, drafts and archived PDFs on a fresh instance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'facturo-backup-test-'));
  const dataDir = path.join(root, 'data');
  const archiveDir = path.join(root, 'archive');
  const port = 32000 + (process.pid % 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      FACTURO_ENV_FILE: path.join(root, 'empty.env'),
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ARCHIVE_DIR: archiveDir,
      SIGNATURE_PATH: path.join(root, 'signature.png')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });

  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/dashboard`, child, () => logs);
    const backup = makeBackup();
    const imported = await fetch(`http://127.0.0.1:${port}/api/backup/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, backup })
    });
    assert.equal(imported.status, 200);
    assert.deepEqual((await imported.json()).restored, {
      clients: 1,
      sites: 1,
      services: 1,
      invoices: 2,
      documents: 1
    });

    const owner = await (await fetch(`http://127.0.0.1:${port}/api/settings/owner`)).json();
    const clients = await (await fetch(`http://127.0.0.1:${port}/api/clients`)).json();
    const sites = await (await fetch(`http://127.0.0.1:${port}/api/sites`)).json();
    const invoices = await (await fetch(`http://127.0.0.1:${port}/api/invoices`)).json();
    const draft = await (await fetch(`http://127.0.0.1:${port}/api/invoices/11`)).json();
    const dashboard = await (await fetch(`http://127.0.0.1:${port}/api/dashboard`)).json();
    const archiveCheck = await (await fetch(`http://127.0.0.1:${port}/api/invoices/10/archive-check`)).json();

    assert.equal(owner.tradeName, 'Émetteur de test');
    assert.equal(clients[0].name, 'Client migré');
    assert.equal(sites[0].label, 'Site migré');
    assert.deepEqual(invoices.map(invoice => invoice.status).sort(), ['draft', 'issued']);
    assert.equal(draft.lines.length, 1);
    assert.equal(draft.lines[0].description, 'Prestation en brouillon');
    assert.deepEqual({ draft: dashboard.totals.draft, issued: dashboard.totals.issued }, { draft: 1, issued: 1 });
    assert.deepEqual({ checked: dashboard.archive.checked, valid: dashboard.archive.valid }, { checked: 1, valid: 1 });
    assert.equal(archiveCheck.ok, true);
    assert.equal((await fs.stat(path.join(archiveDir, '2026', 'facture-001.pdf'))).size, Buffer.from('%PDF-1.4 facturo backup integration test\n').length);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
