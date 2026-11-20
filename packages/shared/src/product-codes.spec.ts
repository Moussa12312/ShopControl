import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEan13CheckDigit,
  encodeEan13Bits,
  generateProductBarcodeEan13,
  generateProductSku,
  isValidEan13,
} from './product-codes';

describe('product-codes', () => {
  it('génère un SKU normalisé en AAA-BBB-CCC-XXXX en ignorant les préfixes génériques boutique', () => {
    const sku = generateProductSku({
      shopName: 'Boutique Kadi',
      categoryName: 'Céréales, Sucre & Vrac',
      productName: 'Riz Parfumé 25kg',
      uniqueSeed: 4821,
    });
    assert.equal(sku, 'KAD-CER-RIZ-4821');
    assert.match(sku, /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}-\d{4}$/);
  });

  it('gère les valeurs manquantes ou courtes sans erreur', () => {
    const sku = generateProductSku({
      shopName: 'Boutique',
      categoryName: null,
      productName: 'A',
      uniqueSeed: 12,
    });
    assert.equal(sku, 'BOU-GEN-AXX-1012');
  });

  it('génère un code-barres EAN-13 valide avec clé de contrôle Mod-10 exacte', () => {
    const ean1 = generateProductBarcodeEan13({
      shopName: "Chakir'Shop",
      categoryName: 'Pommades & Crèmes',
      productName: 'Crème Karité 250ml',
      uniqueSeed: 1001,
    });
    const ean2 = generateProductBarcodeEan13({
      shopName: "Chakir'Shop",
      categoryName: 'Pommades & Crèmes',
      productName: 'Crème Karité 250ml',
      uniqueSeed: 1002,
    });

    assert.equal(ean1.length, 13);
    assert.ok(ean1.startsWith('20'));
    assert.equal(isValidEan13(ean1), true);
    assert.equal(isValidEan13(ean2), true);
    assert.notEqual(ean1, ean2);
    assert.equal(computeEan13CheckDigit('400638133393'), '1');
  });

  it('encode un code-barres EAN-13 en 95 modules binaires GS1 exacts (101...01010...101)', () => {
    const validEan = '4006381333931';
    const bits = encodeEan13Bits(validEan);
    assert.ok(bits);
    assert.equal(bits.length, 95);
    // Doit commencer et finir par le guard 101, et avoir le guard central 01010
    assert.ok(bits.startsWith('101'));
    assert.ok(bits.endsWith('101'));
    assert.equal(bits.slice(45, 50), '01010');
    assert.match(bits, /^[01]{95}$/);

    // Code invalide ou mal formé retourne null
    assert.equal(encodeEan13Bits('1234567890120'), null); // checksum invalide (devrait être 8)
    assert.equal(encodeEan13Bits('abc'), null);
    assert.equal(encodeEan13Bits(''), null);
  });
});
