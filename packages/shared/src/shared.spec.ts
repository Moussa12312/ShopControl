import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultAgentPermissions,
  formatXof,
  normalizePermissionMap,
  slugifyShopName,
  createShopSchema,
  createSupportAccessSchema,
} from './index';

describe('@shopcontrol/shared', () => {
  it('désactive finance:read_margins et les actions sensibles par défaut pour un Agent', () => {
    const perms = createDefaultAgentPermissions();
    assert.equal(perms['finance:read_margins'], false);
    assert.equal(perms['sales:cancel'], false);
    assert.equal(perms['sales:refund'], false);
    assert.equal(perms['sales:create'], true);
  });

  it('normalise proprement une carte de permissions partielle', () => {
    const normalized = normalizePermissionMap({ 'sales:discount': true });
    assert.equal(normalized['sales:discount'], true);
    assert.equal(normalized['finance:read_margins'], false);
  });

  it('formate les montants en XOF sans décimales', () => {
    const formatted = formatXof(12500);
    assert.match(formatted, /12[\s\u00a0\u202f]500 FCFA/);
  });

  it('génère un slug URL-safe à partir d’un nom accentué', () => {
    assert.equal(slugifyShopName('Boutique Étoile — Bamako 2!'), 'boutique-etoile-bamako-2');
  });

  it('valide les schémas boutique et accès support borné à 120 minutes max', () => {
    const shop = createShopSchema.parse({ name: 'Boutique Kalaban' });
    assert.equal(shop.currency, 'XOF');
    assert.equal(shop.timezone, 'Africa/Bamako');
    assert.equal(shop.taxMode, 'NONE');

    assert.throws(() =>
      createSupportAccessSchema.parse({
        merchantId: '00000000-0000-0000-0000-000000000000',
        reason: 'Assistance technique demandée par le client',
        durationMinutes: 180,
      }),
    );
  });
});
