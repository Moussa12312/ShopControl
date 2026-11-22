export interface CommissionRuleLike {
  agentUserId: string | null;
  percentBps: number;
  minSaleXof: number;
}

/** Points gagnés : 1 tranche de 100 FCFA = `pointsPer100Xof` points, sous réserve d'un achat minimum. */
export function computeLoyaltyPoints(totalXof: number, pointsPer100Xof: number, minSaleXof: number): number {
  if (totalXof < minSaleXof) return 0;
  return Math.max(0, Math.floor(totalXof / 100) * pointsPer100Xof);
}

/** La règle propre à l'agent prime sur la règle globale ; aucune règle applicable = null. */
export function pickCommissionRule<T extends CommissionRuleLike>(rules: T[], agentUserId: string): T | null {
  return rules.find((r) => r.agentUserId === agentUserId) ?? rules.find((r) => r.agentUserId === null) ?? null;
}

/** Commission en FCFA (arrondie à l'inférieur) ; 0 si la vente est sous le minimum de la règle. */
export function computeCommissionXof(totalXof: number, rule: CommissionRuleLike): number {
  if (totalXof < rule.minSaleXof) return 0;
  return Math.floor((totalXof * rule.percentBps) / 10_000);
}
