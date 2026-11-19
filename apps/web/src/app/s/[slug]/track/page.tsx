'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Package,
  Search,
  Store,
  XCircle,
} from 'lucide-react';
import {
  formatDateTimeInTimezone,
  formatXof,
  ONLINE_ORDER_STATUS_LABELS,
  OnlineOrderStatus,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';

interface FullTrackedOrder {
  shop: { name: string; slug: string; logoUrl: string | null; phone: string | null };
  order: {
    id: string;
    orderNumber: string;
    status: OnlineOrderStatus;
    fulfillmentMode: string;
    clientName: string;
    deliveryDistrict: string | null;
    deliveryAddress: string | null;
    subtotalXof: number;
    deliveryFeeXof: number;
    totalXof: number;
    canClientCancel: boolean;
    cancelOrRejectReason: string | null;
    lines: Array<{ id: string; productName: string; quantity: number; lineTotalXof: number }>;
    statusEvents: Array<{ toStatus: OnlineOrderStatus; reason: string | null; createdAt: string }>;
    createdAt: string;
  };
}

interface MinimalLookupOrder {
  orderNumber: string;
  status: OnlineOrderStatus;
  totalXof: number;
  updatedAt: string;
}

export default function PublicTrackOrderPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug || '';
  const token = searchParams.get('token') || '';

  const [fullData, setFullData] = useState<FullTrackedOrder | null>(null);
  const [minimalData, setMinimalData] = useState<MinimalLookupOrder | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [orderNumber, setOrderNumber] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  const loadByToken = useCallback(async () => {
    if (!token || !slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<FullTrackedOrder>(
        `/public/shops/${slug}/orders/track?token=${encodeURIComponent(token)}`,
        { requiresOnline: false },
      );
      setFullData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lien de suivi invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    if (token) void loadByToken();
  }, [token, loadByToken]);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMinimalData(null);
    try {
      const res = await apiFetch<MinimalLookupOrder>(
        `/public/shops/${slug}/orders/track-lookup`,
        {
          method: 'POST',
          body: { orderNumber: orderNumber.trim(), clientPhone: clientPhone.trim() },
        },
      );
      setMinimalData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Commande introuvable.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!token || !slug) return;
    setBusy(true);
    try {
      await apiFetch(`/public/shops/${slug}/orders/cancel-by-token`, {
        method: 'POST',
        body: { token, reason: 'Annulée par le client avant confirmation.' },
      });
      await loadByToken();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Annulation impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-porcelain-100">
      <header className="obsidian-hero px-4 py-5 text-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link
            href={`/s/${slug}`}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-200 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour à la vitrine
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-limeglow-400">
            <Store className="h-4 w-4" />
            Suivi commande sécurisé
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        {loading ? (
          <div className="sc-card p-8 text-center text-sm text-slate-500">
            Chargement de votre commande…
          </div>
        ) : fullData ? (
          <div className="sc-card space-y-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-brand-700">
                  {fullData.shop.name}
                </p>
                <h1 className="font-mono text-2xl font-black text-slate-950">
                  {fullData.order.orderNumber}
                </h1>
              </div>
              <span className="rounded-full bg-forest-900 px-3.5 py-1.5 text-xs font-extrabold text-limeglow-400">
                {ONLINE_ORDER_STATUS_LABELS[fullData.order.status]}
              </span>
            </div>

            {/* Frise chronologique */}
            <div className="space-y-2.5">
              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Suivi de l’avancement
              </p>
              {fullData.order.statusEvents.map((ev, idx) => (
                <div key={idx} className="flex items-start gap-3 text-xs">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <div>
                    <p className="font-bold text-slate-900">
                      {ONLINE_ORDER_STATUS_LABELS[ev.toStatus]}
                    </p>
                    {ev.reason ? <p className="text-slate-600">{ev.reason}</p> : null}
                    <p className="text-[11px] text-slate-400">
                      {formatDateTimeInTimezone(ev.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Détails articles */}
            <div className="rounded-2xl bg-porcelain-50 p-4 text-xs space-y-2">
              <p className="font-extrabold text-slate-800">Articles commandés</p>
              {fullData.order.lines.map((l) => (
                <div key={l.id} className="flex justify-between">
                  <span>
                    {l.quantity} × {l.productName}
                  </span>
                  <span className="font-bold tabular">{formatXof(l.lineTotalXof)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-black text-slate-950 tabular">
                <span>Total</span>
                <span>{formatXof(fullData.order.totalXof)}</span>
              </div>
            </div>

            {fullData.order.canClientCancel ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleCancelOrder}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
              >
                <XCircle className="h-4 w-4" />
                Annuler ma commande avant confirmation
              </button>
            ) : null}
          </div>
        ) : (
          <div className="sc-card space-y-5 p-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <Package className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-lg font-extrabold text-slate-900">Suivre ma commande</h1>
                <p className="text-xs text-slate-500">
                  Saisissez votre référence (ex. CMD-000001) et votre numéro de téléphone.
                </p>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleLookup} className="space-y-3">
              <input
                required
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="Référence commande (ex. CMD-000001)"
                className="sc-input font-mono"
              />
              <input
                required
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="Numéro de téléphone utilisé lors de la commande"
                className="sc-input"
              />
              <button type="submit" disabled={busy} className="sc-btn-primary w-full">
                <Search className="h-4 w-4" />
                {busy ? 'Recherche…' : 'Vérifier le statut'}
              </button>
            </form>

            {minimalData ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-black text-slate-900">
                    {minimalData.orderNumber}
                  </span>
                  <span className="rounded-full bg-forest-900 px-3 py-1 font-bold text-limeglow-400">
                    {ONLINE_ORDER_STATUS_LABELS[minimalData.status]}
                  </span>
                </div>
                <p className="mt-2 font-bold text-slate-800 tabular">
                  Montant : {formatXof(minimalData.totalXof)}
                </p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                  <Clock className="h-3 w-3" />
                  Dernière mise à jour : {formatDateTimeInTimezone(minimalData.updatedAt)}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
