import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceFooterFits, invoiceLineDescription, invoiceRowHeight, paginateInvoiceRows, totalEuros } from '../lib/pdf.js';

test('a long invoice description is preserved without ellipsis', () => {
  const description = 'Intervention de maintenance complète avec remplacement des composants usés et vérification approfondie.';

  assert.equal(invoiceLineDescription({ description }), description);
});

test('a wrapped description reserves enough vertical space', () => {
  assert.equal(invoiceRowHeight(12), 18);
  assert.equal(invoiceRowHeight(36), 40);
});

test('pagination fills the page body before reserving the footer', () => {
  const referenceRows = [32, 18, 32, 18, 18, 18, 32, 32, 32, 18, 18, 32, 32];
  const pages = paginateInvoiceRows(referenceRows);

  assert.equal(pages.length, 2);
  assert.equal(pages[0].rows.length, 12);
  assert.equal(pages[1].rows.length, 1);
  assert.equal(invoiceFooterFits(pages[1].endY), true);
  assert.equal(pages[0].endY > 596, true);
});

test('the invoice total uses a plain space and omits unnecessary cents', () => {
  assert.equal(totalEuros(435500), '4 355€');
  assert.equal(totalEuros(435550), '4 355,50€');
});
