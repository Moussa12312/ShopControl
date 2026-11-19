import { parseCsvRecords } from './imports.module';

describe('parseCsvRecords (Import CSV Lot 2)', () => {
  it('détecte le délimiteur point-virgule (Excel FR) et gère les guillemets', () => {
    const csv = 'nom;sku;prix_vente;stock_initial\n"Sucre ; 1kg";SUC-1KG;950;20\nRiz 5kg;RIZ-5KG;3200;15';
    const parsed = parseCsvRecords(csv);
    expect(parsed.headers).toEqual(['nom', 'sku', 'prix_vente', 'stock_initial']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].values.nom).toBe('Sucre ; 1kg');
    expect(parsed.rows[1].values.prix_vente).toBe('3200');
  });

  it('détecte le délimiteur virgule et ignore le BOM UTF-8', () => {
    const csv = '\uFEFFnom,telephone,plafond_credit\nMoussa,+22370001122,50000';
    const parsed = parseCsvRecords(csv);
    expect(parsed.headers).toEqual(['nom', 'telephone', 'plafond_credit']);
    expect(parsed.rows[0].values.nom).toBe('Moussa');
  });
});
