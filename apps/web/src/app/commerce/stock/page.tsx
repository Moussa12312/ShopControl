'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import {
  formatDateTimeInTimezone,
  STOCK_MOVEMENT_LABELS,
  StockMovementType,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface StockAlert {
  productId: string;
  name: string;
  sku: string;
  physicalQty: number;
  availableQty: number;
  alertThreshold: number;
  severity: 'NEGATIVE_CONFLICT' | 'OUT_OF_STOCK' | 'LOW_STOCK';
}

interface MovementRow {
  id: string;
  productName: string;
  sku: string;
  movementType: StockMovementType;
  quantityDelta: number;
  qtyBefore: number;
  qtyAfter: number;
  reason: string | null;
  declaredOperatorName: string | null;
  createdAt: string;
}

interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  stockPhysical: number;
}

export default function StockPage() {
  const { activeOperator } = useAuth();
  const { shopId, selectShop } = useActiveOperationalShop();

  const [tab, setTab] = useState<'movements' | 'adjust' | 'inventory'>('movements');
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adjForm, setAdjForm] = useState({
    productId: '',
    movementType: 'INVENTORY_ADJUSTMENT' as
      | 'MANUAL_IN'
      | 'MANUAL_OUT'
      | 'INVENTORY_ADJUSTMENT'
      | 'RETURN_DAMAGED_LOSS',
    quantityDelta: 0,
    reason: '',
  });

  const [invReason, setInvReason] = useState('Inventaire physique mensuel');
  const [countedMap, setCountedMap] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [al, mv, pr] = await Promise.all([
        apiFetch<StockAlert[]>(`/shops/${shopId}/stock/alerts`, { shopId }),
        apiFetch<{ items: MovementRow[] }>(`/shops/${shopId}/stock/movements?limit=50`, { shopId }),
        apiFetch<{ items: ProductOpt[] }>(`/shops/${shopId}/products?limit=200`, { shopId }),
      ]);
      setAlerts(al);
      setMovements(mv.items);
      setProducts(pr.items);
      if (pr.items[0] && !adjForm.productId) {
        setAdjForm((f) => ({ ...f, productId: pr.items[0].id }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des stocks.');
    } finally {
      setLoading(false);
    }
  }, [shopId, adjForm.productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await apiFetch(`/shops/${shopId}/stock/adjustments`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          ...adjForm,
          quantityDelta: Math.round(Number(adjForm.quantityDelta)),
        },
      });
      setMsg('Correction de stock enregistrée et journalisée.');
      setAdjForm((f) => ({ ...f, quantityDelta: 0, reason: '' }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Correction refusée.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    const items = Object.entries(countedMap)
      .filter(([, v]) => v.trim() !== '')
      .map(([productId, v]) => ({ productId, countedQty: Math.max(0, Math.round(Number(v))) }));

    if (items.length === 0) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await apiFetch<{ checkedCount: number; discrepanciesCount: number }>(
        `/shops/${shopId}/stock/inventory`,
        {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: { reason: invReason, items },
        },
      );
      setMsg(
        `Inventaire validé : ${res.checkedCount} produit(s) vérifié(s), ${res.discrepanciesCount} écart(s) corrigé(s).`,
      );
      setCountedMap({});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Validation inventaire refusée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Stocks, Mouvements & Inventaire</h1>
            <p className="text-sm text-slate-600">
              Registre immuable de mouvements (append-only) : le stock disponible est la somme exacte
              des mouvements.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShopPickerInline shopId={shopId} onChange={selectShop} />
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab('movements')}
                className={`rounded-lg px-3 py-1.5 ${tab === 'movements' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
              >
                Mouvements
              </button>
              <button
                type="button"
                onClick={() => setTab('adjust')}
                className={`rounded-lg px-3 py-1.5 ${tab === 'adjust' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
              >
                Correction / Perte
              </button>
              <button
                type="button"
                onClick={() => setTab('inventory')}
                className={`rounded-lg px-3 py-1.5 ${tab === 'inventory' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
              >
                Inventaire physique
              </button>
            </div>
          </div>
        </div>

        {alerts.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-950">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <span>{alerts.length} alerte(s) de stock sur cette boutique</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {alerts.slice(0, 8).map((a) => (
                <span
                  key={a.productId}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    a.severity === 'NEGATIVE_CONFLICT'
                      ? 'bg-red-600 text-white'
                      : a.severity === 'OUT_OF_STOCK'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-white text-amber-900'
                  }`}
                >
                  {a.name} : {a.availableQty} (seuil {a.alertThreshold})
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {msg ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : tab === 'movements' ? (
          movements.length === 0 ? (
            <EmptyState
              title="Aucun mouvement de stock"
              description="Les réceptions fournisseurs, ventes, retours et inventaires apparaîtront ici."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Produit</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Delta (Avant → Après)</th>
                    <th className="px-4 py-3">Motif / Opérateur</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-900">{m.productName}</p>
                        <p className="font-mono text-xs text-slate-400">{m.sku}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium text-slate-700">
                        {STOCK_MOVEMENT_LABELS[m.movementType] || m.movementType}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        <span
                          className={`font-bold ${
                            m.quantityDelta > 0
                              ? 'text-emerald-700'
                              : m.quantityDelta < 0
                                ? 'text-red-600'
                                : 'text-slate-500'
                          }`}
                        >
                          {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                        </span>{' '}
                        <span className="text-slate-400">
                          ({m.qtyBefore} → {m.qtyAfter})
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        <p>{m.reason || '—'}</p>
                        {m.declaredOperatorName ? (
                          <p className="text-slate-400">Opérateur : {m.declaredOperatorName}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {formatDateTimeInTimezone(m.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'adjust' ? (
          <form
            onSubmit={handleAdjust}
            className="max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
          >
            <h2 className="text-base font-bold text-slate-900">Correction ou perte de stock</h2>
            <div>
              <label className="block text-xs font-medium text-slate-700">Produit *</label>
              <select
                required
                value={adjForm.productId}
                onChange={(e) => setAdjForm({ ...adjForm, productId: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku}) — Stock actuel : {p.stockPhysical}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nature</label>
                <select
                  value={adjForm.movementType}
                  onChange={(e) => setAdjForm({ ...adjForm, movementType: e.target.value as any })}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="INVENTORY_ADJUSTMENT">Correction d’inventaire</option>
                  <option value="MANUAL_IN">Entrée manuelle (+)</option>
                  <option value="MANUAL_OUT">Sortie manuelle (-)</option>
                  <option value="RETURN_DAMAGED_LOSS">Casse / Perte (-)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Variation quantité (+ ou -) *
                </label>
                <input
                  type="number"
                  required
                  value={adjForm.quantityDelta}
                  onChange={(e) => setAdjForm({ ...adjForm, quantityDelta: Number(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Motif obligatoire *</label>
              <textarea
                rows={2}
                required
                value={adjForm.reason}
                onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                placeholder="Ex. Produit endommagé lors de la manutention…"
                className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy || adjForm.quantityDelta === 0}
              className="rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              Valider le mouvement tracé
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmitInventory} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-brand-700" />
                <h2 className="text-base font-bold text-slate-900">Comptage d’inventaire physique</h2>
              </div>
              <input
                required
                value={invReason}
                onChange={(e) => setInvReason(e.target.value)}
                className="w-72 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                placeholder="Libellé de l’inventaire"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Produit</th>
                    <th className="px-3 py-2">Stock théorique</th>
                    <th className="px-3 py-2">Stock compté</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {p.name} <span className="font-mono text-xs text-slate-400">({p.sku})</span>
                      </td>
                      <td className="px-3 py-2 font-mono">{p.stockPhysical}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          placeholder={String(p.stockPhysical)}
                          value={countedMap[p.id] ?? ''}
                          onChange={(e) => setCountedMap({ ...countedMap, [p.id]: e.target.value })}
                          className="w-28 rounded-lg border border-slate-300 px-2.5 py-1 text-sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Valider l’inventaire et corriger les écarts
            </button>
          </form>
        )}
      </div>
    </AppShell>
  );
}
