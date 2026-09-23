import PDFDocument from 'pdfkit';

const BLUE = '#164B88';
const INK = '#243127';
const PAGE = { width: 595.28, height: 841.89, margin: 38 };

const euros = (cents = 0) => `${(Number(cents) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dateFr = (value) => value ? new Intl.DateTimeFormat('fr-FR').format(new Date(`${value}T12:00:00`)) : '—';
const short = (value, length) => String(value || '').length > length ? `${String(value).slice(0, length - 1)}…` : String(value || '');

function text(doc, value, x, y, options = {}) {
  doc.fillColor(options.color || INK).font(options.font || 'Helvetica').fontSize(options.size || 10)
    .text(value || '', x, y, { width: options.width, align: options.align || 'left', lineGap: options.lineGap || 1 });
}

function rule(doc, y, x1 = 30, x2 = 565, width = 1.35) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(BLUE).stroke();
}

function header(doc, invoice, owner, client, site) {
  doc.rect(0, 0, PAGE.width, 33).fill(BLUE);
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(21).text(owner.tradeName || owner.name, 40, 62, { width: 260 });
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(22).text('FACTURE', 397, 62, { width: 160, align: 'right' });
  text(doc, owner.name, 40, 120, { font: 'Helvetica-Bold', color: BLUE, size: 10.5, width: 245 });
  text(doc, owner.address, 40, 142, { font: 'Helvetica-Bold', color: BLUE, size: 9.5, width: 280 });

  const labelX = 370, valueX = 456;
  text(doc, 'SIRET', labelX, 98, { color: BLUE, size: 10, width: 100 });
  text(doc, owner.siret || 'À renseigner', valueX, 98, { size: 10, width: 105, align: 'right' });
  text(doc, 'N° facture', labelX, 115, { color: BLUE, size: 10, width: 100 });
  text(doc, invoice.number, valueX, 115, { size: 10, width: 105, align: 'right' });
  text(doc, 'Date d’émission', labelX, 132, { color: BLUE, size: 10, width: 105 });
  text(doc, dateFr(invoice.issue_date), valueX, 132, { size: 10, width: 105, align: 'right' });
  if (site) {
    text(doc, 'Lieu', labelX, 149, { color: BLUE, size: 10, width: 70 });
    text(doc, short(site.label, 24), 426, 149, { size: 9, width: 135, align: 'right' });
  }

  text(doc, 'Adresser à', 40, 184, { color: BLUE, size: 13.5, width: 220 });
  text(doc, client.contact || client.name, 40, 206, { size: 10.5, width: 220 });
  text(doc, client.name, 40, 223, { size: 10.5, width: 220 });
  if (client.address) text(doc, client.address, 40, 240, { size: 9, width: 250 });

  text(doc, 'Contact client', 40, 276, { color: BLUE, size: 12, width: 220 });
  let cy = 296;
  if (client.email) { text(doc, 'Email', 40, cy, { size: 9 }); text(doc, client.email, 100, cy, { size: 9, width: 170 }); cy += 16; }
  if (client.phone) { text(doc, 'Contact', 40, cy, { size: 9 }); text(doc, client.phone, 100, cy, { size: 9, width: 170 }); cy += 16; }
  if (client.siren) { text(doc, 'SIREN', 40, cy, { size: 9 }); text(doc, client.siren, 100, cy, { size: 9, width: 170 }); }

  text(doc, 'Coordonnées bancaires émetteur', 318, 276, { color: BLUE, size: 12, width: 235 });
  text(doc, `Banque   ${owner.bank || 'À renseigner'}`, 318, 296, { size: 9.5, width: 250 });
  text(doc, `IBAN     ${owner.iban || 'À renseigner'}`, 318, 313, { size: 9.5, width: 250 });
}

function tableHead(doc, y) {
  rule(doc, y, 28, 567);
  text(doc, 'Description', 37, y + 8, { size: 9.5, width: 154 });
  text(doc, 'Quantité', 199, y + 8, { size: 9.5, width: 62, align: 'center' });
  text(doc, 'Date', 270, y + 8, { size: 9.5, width: 74, align: 'center' });
  text(doc, 'Taux / unité', 353, y + 8, { size: 9.5, width: 95, align: 'center' });
  text(doc, 'Total TTC', 464, y + 8, { size: 9.5, width: 82, align: 'right' });
  rule(doc, y + 30, 28, 567);
  doc.moveTo(453, y).lineTo(453, y + 30).lineWidth(1.3).strokeColor(BLUE).stroke();
}

function footer(doc, y, invoice, owner) {
  const totalY = Math.max(y + 18, 595);
  rule(doc, totalY, 30, 565);
  text(doc, 'Total :', 406, totalY + 12, { size: 13, width: 70, align: 'right' });
  text(doc, euros(invoice.total_cents), 484, totalY + 12, { size: 13, width: 78, align: 'right' });
  rule(doc, totalY + 43, 30, 565);
  text(doc, 'Termes & Conditions', 30, totalY + 62, { size: 10.5, width: 210 });
  text(doc, owner.paymentTerms || 'Le paiement est dû au maximum 60 jours après émission de la facture.\nDes frais supplémentaires s’appliquent en cas de retard (40 € d’indemnités + pénalités légales).', 30, totalY + 80, { size: 8.5, width: 285, lineGap: 1 });
  text(doc, 'Signature', 395, totalY + 112, { color: BLUE, size: 13, width: 125, align: 'center' });
  text(doc, 'Statut micro-entreprise\nTVA non applicable, art. 293 B du CGI\nPaiement à effectuer par virement bancaire', 30, totalY + 152, { size: 8.5, width: 280, lineGap: 1 });
  const bottom = Math.min(totalY + 185, 780);
  rule(doc, bottom, 30, 565);
  text(doc, owner.email || '', 34, bottom + 7, { color: BLUE, size: 11.5, width: 240 });
  text(doc, `Téléphone : ${owner.phone || ''}`, 320, bottom + 7, { color: BLUE, size: 11.5, width: 240, align: 'right' });
  rule(doc, bottom + 28, 30, 565);
  doc.rect(0, 816, PAGE.width, 26).fill(BLUE);
}

export async function makeInvoicePdf(invoice, owner, client, lines, site = null) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Facture ${invoice.number}`, Author: owner.name || 'Facturo' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    header(doc, invoice, owner, client, site);
    let y = 344;
    tableHead(doc, y);
    y += 40;
    for (const line of lines) {
      if (y > 555) {
        doc.addPage();
        doc.rect(0, 0, PAGE.width, 22).fill(BLUE);
        text(doc, `FACTURE ${invoice.number} — suite`, 38, 46, { color: BLUE, font: 'Helvetica-Bold', size: 16, width: 500 });
        y = 82;
        tableHead(doc, y);
        y += 40;
      }
      const amount = Math.round(Number(line.quantity) * Number(line.unit_price_cents) * (line.tax_included === 0 || line.tax_included === false ? 1.2 : 1));
      text(doc, short(line.site_label ? `${line.site_label} — ${line.description}` : line.description, 34), 37, y, { size: 9.5, width: 154 });
      text(doc, String(line.quantity).replace('.', ','), 199, y, { size: 9.5, width: 62, align: 'center' });
      text(doc, dateFr(line.service_date), 270, y, { size: 9.5, width: 74, align: 'center' });
      text(doc, euros(line.unit_price_cents), 353, y, { size: 9.5, width: 95, align: 'center' });
      text(doc, euros(amount), 464, y, { size: 9.5, width: 82, align: 'right' });
      y += 18;
    }
    footer(doc, y, invoice, owner);
    doc.end();
  });
}
