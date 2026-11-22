import { computeCommissionXof, computeLoyaltyPoints, pickCommissionRule, promoPercentFor } from './growth.calc';

describe('growth.calc', () => {
  describe('computeLoyaltyPoints', () => {
    it('attribue des points par tranche de 100 FCFA', () => {
      expect(computeLoyaltyPoints(12_350, 1, 500)).toBe(123);
      expect(computeLoyaltyPoints(12_350, 2, 500)).toBe(246);
    });
    it('ne donne rien sous le minimum dâ€™achat', () => {
      expect(computeLoyaltyPoints(400, 1, 500)).toBe(0);
    });
  });

  describe('commissions', () => {
    const global = { agentUserId: null, percentBps: 200, minSaleXof: 0 };
    const agent = { agentUserId: 'a1', percentBps: 500, minSaleXof: 1000 };

    it('priorise la rÃ¨gle de lâ€™agent sur la rÃ¨gle globale', () => {
      expect(pickCommissionRule([global, agent], 'a1')).toBe(agent);
      expect(pickCommissionRule([global, agent], 'a2')).toBe(global);
    });
    it('retourne null sans rÃ¨gle applicable', () => {
      expect(pickCommissionRule([agent], 'a2')).toBeNull();
    });
    it('calcule la commission en arrondissant Ã  lâ€™infÃ©rieur', () => {
      expect(computeCommissionXof(10_000, agent)).toBe(500);
      expect(computeCommissionXof(1_999, global)).toBe(39);
    });
    it('ne verse rien sous le minimum de vente', () => {
      expect(computeCommissionXof(999, agent)).toBe(0);
    });
  });
});

describe('promoPercentFor', () => {
  const promos = [
    { discountPercent: 10, appliesToAll: true, productIds: [] },
    { discountPercent: 25, appliesToAll: false, productIds: ['p1'] },
  ];
  it('retient la meilleure remise sans cumul', () => {
    expect(promoPercentFor(promos, 'p1')).toBe(25);
    expect(promoPercentFor(promos, 'p2')).toBe(10);
  });
  it('retourne 0 sans promotion applicable', () => {
    expect(promoPercentFor([{ discountPercent: 25, appliesToAll: false, productIds: ['p1'] }], 'p2')).toBe(0);
  });
});

