'use client';

import React, { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';

interface ClientLoyalty {
  currentPoints: number;
  tier: { name: string; discountPercent: number; badgeColor: string } | null;
}
interface LoyaltyOverview {
  rule: { isEnabled: boolean };
  rewards: Array<{ id: string; name: string; pointsCost: number; discountType: string; discountValue: number }>;
}

interface Props {
  shopId: string;
  clientId: string;
  methodCode: string;
  amountXof: number;
}

/**
 * Affiche le solde de points fidélité du client avec échange direct de récompense en caisse.
 * (Les intégrations automatisées de QR mobile money ont été retirées pour la v1 au profit d'un enregistrement direct).
 */
export function PosGrowthPanel({ shopId, clientId }: Props) {
  const [loyalty, setLoyalty] = useState<ClientLoyalty | null>(null);
  const [overview, setOverview] = useState<LoyaltyOverview | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setMsg('');
    if (!clientId) {
      setLoyalty(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      apiFetch<ClientLoyalty>(`/shops/${shopId}/loyalty/clients/${clientId}`, { shopId, requiresOnline: true }),
      apiFetch<LoyaltyOverview>(`/shops/${shopId}/loyalty`, { shopId, requiresOnline: true }),
    ])
      .then(([l, o]) => {
        if (cancelled) return;
        setLoyalty(l);
        setOverview(o);
      })
      .catch(() => !cancelled && setLoyalty(null));
    return () => {
      cancelled = true;
    };
  }, [shopId, clientId]);

  const redeem = async (rewardId: string) => {
    try {
      const r = await apiFetch<{ rewardName: string; discountType: string; discountValue: number; remainingPoints: number }>(
        `/shops/${shopId}/loyalty/clients/${clientId}/redeem`,
        { method: 'POST', shopId, body: { rewardId }, requiresOnline: true },
      );
      const value = r.discountType === 'PERCENT' ? `${r.discountValue}%` : `${r.discountValue} F`;
      setMsg(`« ${r.rewardName} » validée : appliquez ${value} de remise au panier. Points restants : ${r.remainingPoints}.`);
      setLoyalty((prev) => (prev ? { ...prev, currentPoints: r.remainingPoints } : prev));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Échange impossible.');
    }
  };

  const showLoyalty = Boolean(clientId && overview?.rule.isEnabled && loyalty);

  if (!showLoyalty || !loyalty) return null;

  return (
    <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
      <p className="flex items-center gap-2 text-xs font-extrabold text-violet-900">
        <Gift className="h-4 w-4" aria-hidden /> Fidélité : {loyalty.currentPoints} pts
        {loyalty.tier ? (
          <span className="rounded-full px-2 py-0.5 text-[10px] text-white" style={{ background: loyalty.tier.badgeColor }}>
            {loyalty.tier.name}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {overview?.rewards
          .filter((r) => r.pointsCost <= loyalty.currentPoints)
          .map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void redeem(r.id)}
              className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-bold text-white hover:bg-violet-700"
            >
              {r.name} ({r.pointsCost} pts)
            </button>
          ))}
      </div>
      {msg ? <p role="status" className="text-xs text-violet-900">{msg}</p> : null}
    </div>
  );
}
