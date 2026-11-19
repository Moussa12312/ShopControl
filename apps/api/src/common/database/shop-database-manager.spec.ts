import { ShopDatabaseManagerService } from './shop-database-manager.service';
import { ControlPrismaService } from './control-prisma.service';

describe('ShopDatabaseManagerService — isolation & sécurité des noms de BDD boutique', () => {
  const manager = new ShopDatabaseManagerService({} as ControlPrismaService);

  it('génère un nom de base PostgreSQL unique, valide et préfixé par boutique', () => {
    const dbA = manager.buildShopDatabaseName('11111111-2222-3333-4444-555555555555');
    const dbB = manager.buildShopDatabaseName('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

    expect(dbA).toMatch(/^shopcontrol_shop_[a-z0-9]{20}$/);
    expect(dbB).toMatch(/^shopcontrol_shop_[a-z0-9]{20}$/);
    expect(dbA).not.toBe(dbB);
    expect(dbA.length).toBeLessThanOrEqual(63);
  });

  it('rejette tout identifiant PostgreSQL dangereux (protection anti-injection SQL)', () => {
    expect(() => manager.assertSafeDatabaseName('shop; DROP DATABASE postgres;--')).toThrow();
    expect(() => manager.assertSafeDatabaseName('ShopUpperCase')).toThrow();
    expect(() => manager.assertSafeDatabaseName('a')).toThrow();
  });
});
