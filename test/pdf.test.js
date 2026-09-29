import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceLineDescription, invoiceRowHeight, totalEuros } from '../lib/pdf.js';

test('a long invoice description is preserved without ellipsis', () => {
  const description = 'Intervention de maintenance complète avec remplacement des composants usés et vérification approfondie.';

  assert.equal(invoiceLineDescription({ description }), description);
});

test('a wrapped description reserves enough vertical space', () => {
  assert.equal(invoiceRowHeight(12), 18);
  assert.equal(invoiceRowHeight(36), 40);
});

test('the invoice total uses a plain space and omits unnecessary cents', () => {
  assert.equal(totalEuros(435500), '4 355€');
  assert.equal(totalEuros(435550), '4 355,50€');
});
