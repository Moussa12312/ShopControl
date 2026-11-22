'use client';

import React, { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';

interface QrPayload {
  qrDataUrl: string;
  label: string;
  payload: string;
}
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
 * Affiche, sous le choix du paiement : le QR Wave / Orange Money du montant à encaisser
 * et le solde de points fidélité du client avec échange de récompense.
 */
export function PosGrowthPanel({ shopId, clientId, methodCode, amountXof }: Props) {
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [qrError, setQrError] = useState('');
  const [loyalty, setLoyalty] = useState<ClientLoyalty | null>(null);
  const [overview, setOverview] = useState<LoyaltyOverview | null>(null);
  const [msg, setMsg] = useState('');

  const isMobileMoney = methodCode === 'WAVE' || methodCode === 'ORANGE_MONEY';

  useEffect(() => {
    if (!isMobileMoney || amountXof <= 0) {
      setQr(null);
      setQrError('');
      return;
    }
    let cancelled = false;
    apiFetch<QrPayload>(`/shops/${shopId}/payments/mobile-money/qr?method=${methodCode}&amount=${Math.round(amountXof)}`, {
      shopId,
      requiresOnline: true,
    })
      .then((r) => !cancelled && (setQr(r), setQrError('')))
      .catch((e) => {
        if (cancelled) return;
        setQr(null);
        setQrError(e instanceof ApiError ? e.message : 'QR indisponible hors ligne.');
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, methodCode, amountXof, isMobileMoney]);

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

  if (!isMobileMoney && !showLoyalty) return null;

  return (
    <div className="space-y-3">
      {isMobileMoney && (qr || qrError) ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center">
          {qr ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.qrDataUrl} alt={`QR de paiement ${methodCode === 'WAVE' ? 'Wave' : 'Orange Money'}`} className="h-40 w-40" />
              <p className="text-xs font-semibold text-slate-700">
                Le client scanne pour payer {Math.round(amountXof).toLocaleString('fr-FR')} F ({qr.label})
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-800">{qrError} Configurez-le dans Croissance &amp; Compta.</p>
          )}
        </div>
      ) : null}

      {showLoyalty && loyalty ? (
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
      ) : null}
    </div>
  );
}
