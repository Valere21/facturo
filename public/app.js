const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modal-content');
const state = { dashboard: null, clients: [], sites: [], services: [], invoices: [], owner: null, editor: null };

const euro = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100);
const date = value => value ? new Intl.DateTimeFormat('fr-FR').format(new Date(`${value}T12:00:00`)) : '—';
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const today = () => new Date().toISOString().slice(0, 10);
const cents = value => Math.round(Number(String(value).replace(',', '.')) * 100 || 0);
const decimal = value => Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const taxIncluded = value => ![false, 0, '0', 'false'].includes(value);
const lineAmount = line => Math.round(Number(line.quantity) * Number(line.unit_price_cents) * (taxIncluded(line.tax_included) ? 1 : 1.2));

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Une erreur est survenue.');
  return payload;
}

function toast(message, error = false) {
  const element = document.createElement('div'); element.className = `toast${error ? ' error' : ''}`; element.textContent = message;
  document.querySelector('#toasts').append(element); setTimeout(() => element.remove(), 4200);
}

function viewHeader(eyebrow, title, subhead, action = '') {
  return `<header class="view-header"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subhead">${subhead}</p></div>${action}</header>`;
}

function navActive(view) {
  document.querySelectorAll('[data-view]').forEach(link => link.classList.toggle('active', link.dataset.view === view));
  document.querySelector('.sidebar').classList.remove('open');
}

async function refresh() {
  const [dashboard, clients, sites, services, invoices, owner] = await Promise.all([
    api('/api/dashboard'), api('/api/clients'), api('/api/sites'), api('/api/services'), api('/api/invoices'), api('/api/settings/owner')
  ]);
  Object.assign(state, { dashboard, clients, sites, services, invoices, owner });
}

function invoiceBadge(invoice) {
  const overdue = invoice.status !== 'draft' && invoice.due_date && invoice.due_date < today();
  const label = overdue ? 'à relancer' : ({ draft:'brouillon', issued:'émise', sent:'envoyée' }[invoice.status] || invoice.status);
  return `<span class="badge ${overdue ? 'overdue' : invoice.status}">${label}</span>`;
}

function renderDashboard() {
  const d = state.dashboard, valid = d.archive.invalid.length === 0;
  const rows = d.recent.length ? d.recent.map(i => `<tr><td><strong>${esc(i.number)}</strong></td><td>${esc(i.client_name)}</td><td>${date(i.issue_date)}</td><td>${invoiceBadge(i)}</td><td class="money">${euro(i.total_cents)}</td><td class="actions"><button class="link-button" data-action="open-invoice" data-id="${i.id}">Ouvrir</button></td></tr>`).join('') : `<tr><td colspan="6" class="empty">Aucune facture pour le moment. Créez votre premier brouillon.</td></tr>`;
  app.innerHTML = `${viewHeader('Vue d’ensemble', 'Bonjour, Valère.', 'Le contrôle de votre activité, sans quitter votre poste.', '<button class="button" data-action="new-invoice">＋ Nouvelle facture</button>')}
    <section class="stat-grid">
      <article class="card stat"><p class="stat-label">Facturé</p><p class="stat-value">${euro(d.totals.invoiced_cents)}</p><p class="hint">${d.totals.issued} facture${d.totals.issued > 1 ? 's' : ''} émise${d.totals.issued > 1 ? 's' : ''}</p></article>
      <article class="card stat"><p class="stat-label">Brouillons</p><p class="stat-value">${d.totals.draft}</p><p class="hint">${euro(d.totals.draft_cents)} à finaliser</p></article>
      <article class="card stat ${d.totals.overdue ? 'alert' : ''}"><p class="stat-label">À relancer</p><p class="stat-value">${d.totals.overdue}</p><p class="hint">Échéances dépassées</p></article>
      <article class="card stat"><p class="stat-label">Archive vérifiée</p><p class="stat-value">${d.archive.valid}/${d.archive.checked}</p><p class="hint">Intégrité SHA-256</p></article>
    </section>
    <section class="dashboard-grid">
      <article class="card panel"><div class="panel-header"><h2>Factures récentes</h2><a href="#invoices">Voir tout</a></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Référence</th><th>Client</th><th>Émise le</th><th>Statut</th><th>Total</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></article>
      <aside class="card panel"><div class="panel-header"><h2>Archivage</h2></div><div class="health ${valid ? '' : 'bad'}"><i class="health-dot"></i><div><strong>${valid ? 'Archive intègre' : 'Vérification requise'}</strong><span>${valid ? `${d.archive.checked} PDF contrôlé${d.archive.checked > 1 ? 's' : ''} avec lecture retour.` : `${d.archive.invalid.length} fichier(s) à contrôler.`}</span></div></div><div class="notice"><strong>Copie durable</strong>Les PDF émis sont écrits puis relus immédiatement depuis <code>${esc(d.archive.directory)}</code>. Configurez ce chemin vers le disque de votre Raspberry Pi dans <code>.env</code>.</div></aside>
    </section>`;
}

function renderInvoices() {
  const rows = state.invoices.length ? state.invoices.map(i => `<tr><td><strong>${esc(i.number)}</strong><br><span class="subtle">${date(i.issue_date)}</span></td><td><div class="client-cell"><strong>${esc(i.client_name)}</strong><span>Échéance ${date(i.due_date)}</span></div></td><td>${invoiceBadge(i)}</td><td class="money">${euro(i.total_cents)}</td><td class="actions"><button class="link-button" data-action="pdf" data-id="${i.id}">PDF</button><button class="link-button" data-action="open-invoice" data-id="${i.id}">Ouvrir</button></td></tr>`).join('') : `<tr><td colspan="5" class="empty">Aucune facture. Vous pouvez créer un brouillon dès maintenant.</td></tr>`;
  app.innerHTML = `${viewHeader('Facturation', 'Vos factures', 'Les factures émises sont figées et archivées avec une empreinte de contrôle.', '<button class="button" data-action="new-invoice">＋ Nouvelle facture</button>')}
    <article class="card panel"><div class="filter-bar"><div><h2>Historique</h2><p class="helper">${state.invoices.length} document${state.invoices.length > 1 ? 's' : ''}</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Facture</th><th>Client</th><th>Statut</th><th>Total TTC</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

function renderClients() {
  const rows = state.clients.length ? state.clients.map(c => `<tr><td><div class="client-cell"><strong>${esc(c.name)}</strong><span>${esc(c.contact || 'Sans contact')}</span></div></td><td>${esc(c.email || '—')}</td><td>${esc(c.phone || '—')}</td><td>${esc(c.siren || '—')}</td><td class="actions"><button class="link-button" data-action="edit-client" data-id="${c.id}">Modifier</button><button class="link-button red" data-action="delete-client" data-id="${c.id}">Supprimer</button></td></tr>`).join('') : `<tr><td colspan="5" class="empty">Votre carnet client est vide.</td></tr>`;
  app.innerHTML = `${viewHeader('Répertoire', 'Clients', 'Coordonnées utilisées pour l’édition et l’envoi des factures.', '<button class="button" data-action="new-client">＋ Ajouter un client</button>')}
    <article class="card panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Client</th><th>E-mail</th><th>Téléphone</th><th>SIREN</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

function siteMap(site) {
  const latitude = Number(site.latitude), longitude = Number(site.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '<p class="helper">Renseignez une adresse puis utilisez « Localiser » pour afficher la carte.</p>';
  const span = 0.008, bbox = [longitude - span, latitude - span, longitude + span, latitude + span].join('%2C');
  const query = encodeURIComponent(site.address || `${latitude},${longitude}`);
  return `<div class="map-preview"><iframe title="Carte du site" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude}%2C${longitude}"></iframe><div><a href="https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}" target="_blank" rel="noreferrer">OpenStreetMap ↗</a><a href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noreferrer">Google Maps ↗</a></div></div>`;
}

function renderSites() {
  const rows = state.sites.length ? state.sites.map(s => `<tr><td><div class="client-cell"><strong>${esc(s.label)}</strong><span>${esc(s.address || 'Adresse non renseignée')}</span></div></td><td>${esc([s.reference_first_name, s.reference_last_name].filter(Boolean).join(' ') || '—')}</td><td>${esc(s.reference_phone || '—')}</td><td>${esc(s.reference_email || '—')}</td><td class="actions"><button class="link-button" data-action="edit-site" data-id="${s.id}">Modifier</button><button class="link-button red" data-action="delete-site" data-id="${s.id}">Supprimer</button></td></tr>`).join('') : `<tr><td colspan="5" class="empty">Ajoutez vos lieux de travail et leurs contacts sur place.</td></tr>`;
  app.innerHTML = `${viewHeader('Lieux', 'Sites', 'Vos lieux de mission et les coordonnées des personnes de référence.', '<button class="button" data-action="new-site">＋ Ajouter un site</button>')}
    <article class="card panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Site</th><th>Référent</th><th>Téléphone</th><th>E-mail</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

function renderServices() {
  const rows = state.services.length ? state.services.map(s => `<tr><td><div class="client-cell"><strong>${esc(s.name)}</strong><span>${esc(s.description || '—')}</span></div></td><td>${decimal(s.default_quantity)}</td><td class="money">${euro(s.unit_price_cents)}</td><td class="actions"><button class="link-button" data-action="edit-service" data-id="${s.id}">Modifier</button><button class="link-button red" data-action="delete-service" data-id="${s.id}">Supprimer</button></td></tr>`).join('') : `<tr><td colspan="4" class="empty">Ajoutez vos tarifs récurrents pour les retrouver dans les brouillons.</td></tr>`;
  app.innerHTML = `${viewHeader('Catalogue', 'Prestations', 'Des raccourcis tarifaires pour préparer les factures plus vite.', '<button class="button" data-action="new-service">＋ Ajouter une prestation</button>')}
    <article class="card panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Prestation</th><th>Qté par défaut</th><th>Tarif unitaire</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

function renderSettings() {
  const o = state.owner;
  app.innerHTML = `${viewHeader('Configuration', 'Vos informations', 'Elles sont reprises dans chaque PDF au moment de l’émission.')}
  <form class="card config-card" id="owner-form"><h2>Émetteur</h2><p class="subhead">Renseignez notamment le SIRET et l’IBAN avant votre première émission.</p><div class="form-grid">
    <div class="field"><label>Nom commercial *</label><input class="input" name="tradeName" required value="${esc(o.tradeName)}"></div><div class="field"><label>Nom complet *</label><input class="input" name="name" required value="${esc(o.name)}"></div>
    <div class="field full"><label>Adresse</label><input class="input" name="address" value="${esc(o.address)}"></div><div class="field"><label>SIRET</label><input class="input" name="siret" value="${esc(o.siret)}"></div><div class="field"><label>Téléphone</label><input class="input" name="phone" value="${esc(o.phone)}"></div>
    <div class="field"><label>E-mail</label><input class="input" type="email" name="email" value="${esc(o.email)}"></div><div class="field"><label>Banque</label><input class="input" name="bank" value="${esc(o.bank)}"></div><div class="field full"><label>IBAN</label><input class="input" name="iban" value="${esc(o.iban)}"></div>
    <div class="field full"><label>Conditions de paiement</label><textarea class="textarea" name="paymentTerms">${esc(o.paymentTerms)}</textarea><p class="helper">Le statut micro-entreprise et la mention « TVA non applicable, art. 293 B du CGI » figurent toujours sur le PDF.</p></div>
  </div><div class="form-actions"><button class="button" type="submit">Enregistrer les informations</button></div></form>`;
}

function freshLine() { return { description: '', quantity: 1, unit_price_cents: 0, tax_included: true, site_id: null, service_date: today() }; }

function renderEditor() {
  const e = state.editor, immutable = e.status !== 'draft', selectedClient = state.clients.find(c => c.id === Number(e.client_id)) || e.client;
  const clientOptions = state.clients.map(c => `<option value="${c.id}" ${c.id === Number(e.client_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const siteOptions = siteId => `<option value="">Aucun site</option>${state.sites.map(s => `<option value="${s.id}" ${s.id === Number(siteId) ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}`;
  const serviceOptions = state.services.map(s => `<option value="${s.id}">${esc(s.name)} · ${euro(s.unit_price_cents)}</option>`).join('');
  const lines = e.lines.length ? e.lines.map((line, index) => `<div class="line-grid"><select class="select site-line" data-line="${index}" data-key="site_id" ${immutable ? 'disabled' : ''}>${siteOptions(line.site_id)}</select><input class="input description" data-line="${index}" data-key="description" value="${esc(line.description)}" placeholder="Description" ${immutable ? 'disabled' : ''}><input class="input" data-line="${index}" data-key="quantity" type="number" step="1" min="1" value="${line.quantity}" ${immutable ? 'disabled' : ''}><input class="input date" data-line="${index}" data-key="service_date" type="date" value="${line.service_date || ''}" ${immutable ? 'disabled' : ''}><input class="input" data-line="${index}" data-key="unit_price" type="number" step="0.01" min="0" value="${(line.unit_price_cents / 100).toFixed(2)}" ${immutable ? 'disabled' : ''}><label class="tax-check"><input data-line="${index}" data-key="tax_included" type="checkbox" ${taxIncluded(line.tax_included) ? 'checked' : ''} ${immutable ? 'disabled' : ''}><span>TVA comprise</span></label><span class="line-total total">${euro(lineAmount(line))}</span>${immutable ? '<span></span>' : `<button class="remove-line" data-action="remove-line" data-index="${index}" title="Retirer">×</button>`}</div>`).join('') : '<p class="empty">Ajoutez une ligne de prestation.</p>';
  const total = e.lines.reduce((sum, l) => sum + lineAmount(l), 0);
  const archive = immutable ? `<button class="button secondary" data-action="check-archive" data-id="${e.id}">Vérifier l’archive</button><button class="button ghost" data-action="email" data-id="${e.id}">Envoyer par e-mail</button>` : '';
  const pendingEmail = !immutable ? '<button class="button ghost" disabled title="Disponible après l’archivage">Envoyer par e-mail</button>' : '';
  app.innerHTML = `<div class="editor"><header class="view-header"><div><p class="eyebrow">${immutable ? 'Document émis' : 'Brouillon'}</p><h1>Facture ${esc(e.number)}</h1><p class="subhead">${immutable ? 'Cette facture est verrouillée pour préserver l’archive.' : 'Préparez les lignes puis émettez le document une fois vérifié.'}</p></div><button class="button ghost" data-action="back-invoices">← Toutes les factures</button></header>
  <section class="invoice-top"><article class="card invoice-meta"><h2>Informations</h2><div class="form-grid"><div class="field"><label>Numéro</label><div class="invoice-number">${esc(e.number)}</div></div><div class="field"><label>Statut</label>${invoiceBadge(e)}</div><div class="field"><label>Date d’émission</label><input class="input" data-invoice="issue_date" type="date" value="${e.issue_date}" ${immutable ? 'disabled' : ''}></div><div class="field"><label>Échéance</label><input class="input" data-invoice="due_date" type="date" value="${e.due_date || ''}" ${immutable ? 'disabled' : ''}></div></div></article>
  <article class="card invoice-client"><h2>Destinataire</h2><div class="field"><div class="field-label"><label>Client</label>${!immutable ? '<button class="link-button" data-action="new-client-from-invoice">Nouveau client</button>' : ''}</div><select class="select" data-invoice="client_id" ${immutable ? 'disabled' : ''}>${clientOptions}</select></div>${selectedClient?.email ? `<p class="helper">${esc(selectedClient.contact || selectedClient.name)} · ${esc(selectedClient.email)}</p>` : '<p class="helper">Ajoutez un e-mail au client pour permettre l’envoi.</p>'}</article></section>
  <section class="card line-editor"><div class="line-tools"><h2>Prestations</h2>${!immutable ? `<div class="service-picker"><div class="field-label"><label>Prestation</label><button class="link-button" data-action="new-service-from-invoice">Nouvelle prestation</button></div><select class="select" id="service-preset"><option value="">Ajouter depuis le catalogue…</option>${serviceOptions}</select></div>` : ''}</div><div class="line-grid head"><span>Site / lieu</span><span>Description</span><span>Quantité</span><span>Date</span><span>Tarif</span><span>TVA</span><span>Total TTC</span><span></span></div>${lines}${!immutable ? '<div class="line-add-actions"><button class="button ghost small" data-action="add-line">＋ Ajouter une ligne</button><button class="button ghost small" data-action="new-site-from-invoice">⌖ Ajouter un site</button></div>' : ''}<p class="helper">TVA comprise : le tarif saisi est déjà TTC. Décochez pour appliquer 20 % au tarif HT.</p><div class="invoice-total"><span>Total TTC</span><strong>${euro(total)}</strong></div></section>
  <section class="card panel" style="margin-top:18px"><div class="field"><label>Note interne (non affichée sur le PDF)</label><textarea class="textarea" data-invoice="notes" ${immutable ? 'disabled' : ''}>${esc(e.notes || '')}</textarea></div></section>
  <div class="editor-actions"><button class="button ghost" data-action="delete-invoice" data-id="${e.id}" ${immutable ? 'disabled' : ''}>Supprimer le brouillon</button><div class="right"><button class="button ghost" data-action="pdf" data-id="${e.id}">Aperçu PDF</button>${archive}${!immutable ? `<button class="button secondary" data-action="save-invoice">Enregistrer</button><button class="button" data-action="issue-invoice" data-id="${e.id}">Archiver la facture</button>${pendingEmail}` : ''}</div></div></div>`;
}

function render(view) {
  navActive(view);
  if (view === 'dashboard') renderDashboard(); else if (view === 'invoices') renderInvoices(); else if (view === 'clients') renderClients(); else if (view === 'sites') renderSites(); else if (view === 'services') renderServices(); else if (view === 'settings') renderSettings(); else if (view.startsWith('invoice/')) renderEditor(); else location.hash = '#dashboard';
}

function clientModal(client = {}) {
  modalContent.innerHTML = `<form class="modal" id="client-form" data-id="${client.id || ''}"><h2>${client.id ? 'Modifier le client' : 'Nouveau client'}</h2><p class="subhead">Les coordonnées restent faciles à mettre à jour tant qu’aucune facture n’est émise.</p><div class="form-grid"><div class="field full"><label>Entreprise / nom *</label><input class="input" name="name" required value="${esc(client.name || '')}"></div><div class="field"><label>Contact</label><input class="input" name="contact" value="${esc(client.contact || '')}"></div><div class="field"><label>E-mail</label><input class="input" name="email" type="email" value="${esc(client.email || '')}"></div><div class="field"><label>Téléphone</label><input class="input" name="phone" value="${esc(client.phone || '')}"></div><div class="field"><label>SIREN</label><input class="input" name="siren" value="${esc(client.siren || '')}"></div><div class="field full"><label>Adresse</label><textarea class="textarea" name="address">${esc(client.address || '')}</textarea></div></div><div class="form-actions"><button class="button ghost" type="button" data-action="close-modal">Annuler</button><button class="button" type="submit">Enregistrer</button></div></form>`; modal.showModal();
}

function serviceModal(service = {}) {
  modalContent.innerHTML = `<form class="modal" id="service-form" data-id="${service.id || ''}"><h2>${service.id ? 'Modifier la prestation' : 'Nouvelle prestation'}</h2><p class="subhead">Un tarif par défaut : il reste modifiable dans chaque facture.</p><div class="form-grid"><div class="field full"><label>Nom *</label><input class="input" name="name" required value="${esc(service.name || '')}"></div><div class="field full"><label>Description suggérée</label><input class="input" name="description" value="${esc(service.description || '')}"></div><div class="field"><label>Tarif unitaire (€)</label><input class="input" name="unit_price" type="number" step="0.01" min="0" value="${service.id ? (service.unit_price_cents / 100).toFixed(2) : ''}" required></div><div class="field"><label>Quantité par défaut</label><input class="input" name="default_quantity" type="number" step="1" min="1" value="${esc(service.default_quantity || 1)}" required><p class="helper">Entier naturel uniquement.</p></div></div><div class="form-actions"><button class="button ghost" type="button" data-action="close-modal">Annuler</button><button class="button" type="submit">Enregistrer</button></div></form>`; modal.showModal();
}

function siteModal(site = {}) {
  modalContent.innerHTML = `<form class="modal" id="site-form" data-id="${site.id || ''}"><h2>${site.id ? 'Modifier le site' : 'Nouveau site'}</h2><p class="subhead">La localisation est facultative. Elle n’est recherchée qu’après votre clic sur « Localiser ».</p><div class="form-grid"><div class="field full"><label>Nom ou label personnalisé *</label><input class="input" name="label" required value="${esc(site.label || '')}" placeholder="Ex. Studio République"></div><div class="field full"><label>Adresse</label><textarea class="textarea" name="address" placeholder="Adresse complète pour la carte">${esc(site.address || '')}</textarea></div><div class="field full"><button class="button secondary small" type="button" data-action="locate-site">⌖ Localiser l’adresse</button><div id="site-map-holder">${siteMap(site)}</div><input name="latitude" type="hidden" value="${esc(site.latitude ?? '')}"><input name="longitude" type="hidden" value="${esc(site.longitude ?? '')}"></div><div class="field"><label>Prénom du référent</label><input class="input" name="reference_first_name" value="${esc(site.reference_first_name || '')}"></div><div class="field"><label>Nom du référent</label><input class="input" name="reference_last_name" value="${esc(site.reference_last_name || '')}"></div><div class="field"><label>Téléphone</label><input class="input" name="reference_phone" type="tel" value="${esc(site.reference_phone || '')}"></div><div class="field"><label>E-mail</label><input class="input" name="reference_email" type="email" value="${esc(site.reference_email || '')}"></div></div><div class="form-actions"><button class="button ghost" type="button" data-action="close-modal">Annuler</button><button class="button" type="submit">Enregistrer le site</button></div></form>`; modal.showModal();
}

async function openInvoice(id) {
  const invoice = await api(`/api/invoices/${id}`); state.editor = invoice; location.hash = `#invoice/${id}`;
}

async function newInvoice() {
  if (!state.clients.length) { toast('Ajoutez d’abord un client.', true); location.hash = '#clients'; return; }
  const invoice = await api('/api/invoices', { method:'POST', body:JSON.stringify({ client_id: state.clients[0].id, issue_date: today() }) });
  state.editor = { ...invoice, lines: [freshLine()] }; location.hash = `#invoice/${invoice.id}`;
}

function updateEditorFromInput(target) {
  if (target.dataset.invoice) {
    state.editor[target.dataset.invoice] = target.value;
    if (target.dataset.invoice === 'client_id') renderEditor();
    return;
  }
  const index = Number(target.dataset.line), key = target.dataset.key; if (!Number.isInteger(index) || !key) return;
  const line = state.editor.lines[index];
  if (key === 'quantity') line.quantity = Number(target.value || 0);
  else if (key === 'unit_price') line.unit_price_cents = cents(target.value);
  else if (key === 'tax_included') line.tax_included = target.checked;
  else if (key === 'site_id') line.site_id = target.value ? Number(target.value) : null;
  else line[key] = target.value;
  renderEditor();
}

async function saveInvoice(silent = false) {
  const e = state.editor;
  const payload = { client_id: Number(e.client_id), issue_date:e.issue_date, due_date:e.due_date, notes:e.notes, lines:e.lines };
  const invoice = await api(`/api/invoices/${e.id}`, { method:'PUT', body:JSON.stringify(payload) });
  state.editor = invoice;
  if (!silent) { toast('Brouillon enregistré.'); renderEditor(); }
  return invoice;
}

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const { action, id, index } = button.dataset;
  try {
    if (action === 'new-invoice') await newInvoice();
    if (action === 'open-invoice') await openInvoice(id);
    if (action === 'back-invoices') location.hash = '#invoices';
    if (action === 'new-client') clientModal();
    if (action === 'edit-client') clientModal(state.clients.find(c => c.id === Number(id)));
    if (action === 'new-client-from-invoice') { location.hash = '#clients'; toast('Ajoutez le client, puis rouvrez le brouillon.'); }
    if (action === 'new-site') siteModal();
    if (action === 'edit-site') siteModal(state.sites.find(s => s.id === Number(id)));
    if (action === 'new-site-from-invoice') siteModal();
    if (action === 'new-service') serviceModal();
    if (action === 'edit-service') serviceModal(state.services.find(s => s.id === Number(id)));
    if (action === 'new-service-from-invoice') { location.hash = '#services'; toast('Ajoutez la prestation, puis rouvrez le brouillon.'); }
    if (action === 'close-modal') modal.close();
    if (action === 'delete-client' && confirm('Supprimer ce client ?')) { await api(`/api/clients/${id}`, { method:'DELETE' }); await refresh(); render('clients'); toast('Client supprimé.'); }
    if (action === 'delete-site' && confirm('Supprimer ce site ?')) { await api(`/api/sites/${id}`, { method:'DELETE' }); await refresh(); render('sites'); toast('Site supprimé.'); }
    if (action === 'delete-service' && confirm('Supprimer cette prestation ?')) { await api(`/api/services/${id}`, { method:'DELETE' }); await refresh(); render('services'); toast('Prestation supprimée.'); }
    if (action === 'add-line') { state.editor.lines.push(freshLine()); renderEditor(); }
    if (action === 'remove-line') { state.editor.lines.splice(Number(index), 1); renderEditor(); }
    if (action === 'save-invoice') await saveInvoice();
    if (action === 'issue-invoice') { await saveInvoice(true); if (confirm('Archiver cette facture ? Elle sera figée. L’envoi par e-mail restera une action séparée.')) { const result = await api(`/api/invoices/${id}`, { method:'GET' }); state.editor = result; const issued = await api(`/api/invoices/${state.editor.id}/issue`, { method:'POST' }); state.editor = issued.invoice; await refresh(); renderEditor(); toast('Facture archivée et vérifiée.'); } }
    if (action === 'delete-invoice' && confirm('Supprimer ce brouillon ?')) { await api(`/api/invoices/${id}`, { method:'DELETE' }); await refresh(); location.hash = '#invoices'; toast('Brouillon supprimé.'); }
    if (action === 'pdf') {
      if (state.editor?.id === Number(id) && state.editor.status === 'draft') {
        await saveInvoice(true);
        toast('Brouillon enregistré avant génération du PDF.');
      }
      window.open(`/api/invoices/${id}/pdf`, '_blank', 'noopener');
    }
    if (action === 'check-archive') { const check = await api(`/api/invoices/${id}/archive-check`); toast(check.ok ? `Archive intègre · ${check.bytes} octets relus.` : check.reason, !check.ok); }
    if (action === 'email') { const to = prompt('Adresse e-mail du destinataire', state.editor.client?.email || ''); if (to !== null) { const result = await api(`/api/invoices/${id}/email`, { method:'POST', body:JSON.stringify({ to }) }); await refresh(); toast(`Facture envoyée à ${result.to}.`); } }
    if (action === 'locate-site') {
      const form = modalContent.querySelector('#site-form');
      const address = form.elements.address.value.trim();
      if (!address) throw new Error('Renseignez d’abord l’adresse du site.');
      button.disabled = true; button.textContent = 'Localisation…';
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`);
        const places = await response.json();
        if (!response.ok || !places.length) throw new Error('Adresse introuvable. Vérifiez-la ou renseignez-la plus précisément.');
        form.elements.latitude.value = places[0].lat; form.elements.longitude.value = places[0].lon;
        modalContent.querySelector('#site-map-holder').innerHTML = siteMap({ address, latitude: places[0].lat, longitude: places[0].lon });
        button.textContent = '⌖ Adresse localisée';
      } finally { button.disabled = false; }
    }
  } catch (error) { toast(error.message, true); }
});

app.addEventListener('change', event => {
  if (event.target.dataset.invoice || event.target.dataset.line) updateEditorFromInput(event.target);
  if (event.target.id === 'service-preset' && event.target.value) { const service = state.services.find(s => s.id === Number(event.target.value)); if (service) { state.editor.lines.push({ description:service.description || service.name, quantity:service.default_quantity, unit_price_cents:service.unit_price_cents, tax_included:true, site_id:null, service_date:today() }); renderEditor(); } }
});

document.addEventListener('submit', async event => {
  if (!event.target.matches('#client-form,#site-form,#service-form,#owner-form')) return;
  event.preventDefault(); const form = event.target, values = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'client-form') { const id = form.dataset.id; await api(id ? `/api/clients/${id}` : '/api/clients', { method:id ? 'PUT' : 'POST', body:JSON.stringify(values) }); modal.close(); await refresh(); render(location.hash.slice(1) || 'clients'); toast('Client enregistré.'); }
    if (form.id === 'site-form') { const id = form.dataset.id; await api(id ? `/api/sites/${id}` : '/api/sites', { method:id ? 'PUT' : 'POST', body:JSON.stringify(values) }); modal.close(); await refresh(); render(location.hash.slice(1) || 'sites'); toast('Site enregistré.'); }
    if (form.id === 'service-form') { const id = form.dataset.id; await api(id ? `/api/services/${id}` : '/api/services', { method:id ? 'PUT' : 'POST', body:JSON.stringify(values) }); modal.close(); await refresh(); render(location.hash.slice(1) || 'services'); toast('Prestation enregistrée.'); }
    if (form.id === 'owner-form') { const saved = await api('/api/settings/owner', { method:'PUT', body:JSON.stringify(values) }); state.owner = saved; toast('Informations enregistrées.'); }
  } catch (error) { toast(error.message, true); }
});

document.querySelector('#menu-toggle').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
window.addEventListener('hashchange', () => render(location.hash.slice(1) || 'dashboard'));

try { await refresh(); render(location.hash.slice(1) || 'dashboard'); } catch (error) { app.innerHTML = `<div class="card panel"><h2>Facturato ne démarre pas</h2><p class="subhead">${esc(error.message)}</p></div>`; }
