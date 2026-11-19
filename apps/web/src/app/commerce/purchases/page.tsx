'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, PackageCheck, Plus, Wallet } from 'lucide-react';
import {
  formatDateTimeInTimezone,
  formatXof,
  PURCHASE_ORDER_STATUS_LABELS,
  PurchaseOrderStatus,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  debtBalanceXof: number;
  totalReceivedXof: number;
  totalPaidXof: number;
}

interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  costPriceXof: number | null;
}

interface PurchaseOrderRow {
  id: string;
  poNumber: string;
  supplier: { id: string; name: string };
  status: PurchaseOrderStatus;
  totalOrderedXof: number;
  totalReceivedXof: number;
  totalPaidXof: number;
  debtDueXof: number;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    orderedQty: number;
    receivedQty: number;
    unitCostXof: number;
  }>;
  createdAt: string;
}

export default function PurchasesPage() {
  const { activeOperator } = useAuth();
  const { shopId, selectShop, isOwner } = useActiveOperationalShop();

  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders');
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Nouveau fournisseur
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');

  // Nouvelle commande fournisseur
  const [showNewPo, setShowNewPo] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poProductId, setPoProductId] = useState('');
  const [poQty, setPoQty] = useState(10);
  const [poUnitCost, setPoUnitCost] = useState(1000);

  // Réception partielle/totale
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrderRow | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});
  const [receiveCosts, setReceiveCosts] = useState<Record<string, number>>({});

  // Paiement fournisseur
  const [payTarget, setPayTarget] = useState<PurchaseOrderRow | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payFromCash, setPayFromCash] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [s, o, p] = await Promise.all([
        apiFetch<SupplierRow[]>(`/shops/${shopId}/suppliers`, { shopId }),
        apiFetch<PurchaseOrderRow[]>(`/shops/${shopId}/purchases`, { shopId }),
        apiFetch<{ items: ProductOpt[] }>(`/shops/${shopId}/products?limit=200`, { shopId }),
      ]);
      setSuppliers(s);
      setOrders(o);
      setProducts(p.items);
      if (s[0] && !poSupplierId) setPoSupplierId(s[0].id);
      if (p.items[0] && !poProductId) setPoProductId(p.items[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des achats.');
    } finally {
      setLoading(false);
    }
  }, [shopId, poSupplierId, poProductId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/suppliers`, {
        method: 'POST',
        shopId,
        body: { name: supName, phone: supPhone || undefined },
      });
      setSupName('');
      setSupPhone('');
      setMsg('Fournisseur ajouté.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création fournisseur impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/purchases`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          supplierId: poSupplierId,
          items: [{ productId: poProductId, orderedQty: poQty, unitCostXof: poUnitCost }],
        },
      });
      setShowNewPo(false);
      setMsg('Commande fournisseur créée (le stock sera crédité à la réception).');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création commande impossible.');
    } finally {
      setBusy(false);
    }
  };

  const openReceive = (po: PurchaseOrderRow) => {
    const qMap: Record<string, number> = {};
    const cMap: Record<string, number> = {};
    for (const item of po.items) {
      qMap[item.id] = Math.max(0, item.orderedQty - item.receivedQty);
      cMap[item.id] = item.unitCostXof;
    }
    setReceiveQtys(qMap);
    setReceiveCosts(cMap);
    setReceiveTarget(po);
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !receiveTarget) return;
    const items = receiveTarget.items
      .map((i) => ({
        purchaseOrderItemId: i.id,
        receivedQty: Math.round(Number(receiveQtys[i.id]) || 0),
        unitCostXof: Math.round(Number(receiveCosts[i.id]) || i.unitCostXof),
      }))
      .filter((i) => i.receivedQty > 0);
    if (items.length === 0) return;

    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/purchases/${receiveTarget.id}/receive`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { items },
      });
      setReceiveTarget(null);
      setMsg('Réception enregistrée : stock crédité et Coût Moyen Pondéré (CMP) recalculé.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Réception refusée.');
    } finally {
      setBusy(false);
    }
  };

  const handlePaySupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !payTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/purchases/${payTarget.id}/payments`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          amountXof: payAmount,
          paymentMethodCode: payFromCash ? 'CASH' : 'BANK',
          paidFromCashDrawer: payFromCash,
        },
      });
      setPayTarget(null);
      setMsg('Règlement fournisseur enregistré.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Paiement refusé.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Achats & Fournisseurs</h1>
            <p className="text-sm text-slate-600">
              Les commandes n’augmentent jamais le stock avant réception (partielle ou totale) avec
              recalcul automatique du CMP.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShopPickerInline shopId={shopId} onChange={selectShop} />
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab('orders')}
                className={`rounded-lg px-3 py-1.5 ${tab === 'orders' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
              >
                Commandes ({orders.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('suppliers')}
                className={`rounded-lg px-3 py-1.5 ${tab === 'suppliers' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
              >
                Fournisseurs ({suppliers.length})
              </button>
            </div>
            {tab === 'orders' && suppliers.length > 0 && products.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowNewPo(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                Nouvel achat
              </button>
            ) : null}
          </div>
        </div>

        {msg ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : tab === 'orders' ? (
          orders.length === 0 ? (
            <EmptyState
              title="Aucune commande fournisseur"
              description="Ajoutez un fournisseur et un produit, puis créez votre première commande d’approvisionnement."
            />
          ) : (
            <div className="space-y-3">
              {orders.map((po) => (
                <div
                  key={po.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {po.poNumber}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                        {PURCHASE_ORDER_STATUS_LABELS[po.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Fournisseur : <strong>{po.supplier.name}</strong> ·{' '}
                      {formatDateTimeInTimezone(po.createdAt)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Commandé : <strong>{formatXof(po.totalOrderedXof)}</strong> · Reçu :{' '}
                      <strong>{formatXof(po.totalReceivedXof)}</strong> · Payé :{' '}
                      <strong>{formatXof(po.totalPaidXof)}</strong>
                      {po.debtDueXof > 0 ? (
                        <span className="ml-1 font-bold text-amber-800">
                          · Dette : {formatXof(po.debtDueXof)}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' ? (
                      <button
                        type="button"
                        onClick={() => openReceive(po)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-800"
                      >
                        <PackageCheck className="h-4 w-4" />
                        Réceptionner
                      </button>
                    ) : null}
                    {isOwner && po.debtDueXof > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPayTarget(po);
                          setPayAmount(po.debtDueXof);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Wallet className="h-4 w-4" />
                        Régler dette
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-4">
            <form
              onSubmit={handleCreateSupplier}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:flex-wrap"
            >
              <input
                required
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
                placeholder="Nom du fournisseur *"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm sm:min-w-[200px] sm:flex-1"
              />
              <input
                value={supPhone}
                onChange={(e) => setSupPhone(e.target.value)}
                placeholder="Téléphone"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm sm:w-48"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-forest-900 px-4 py-2 text-sm font-semibold text-white hover:bg-forest-800 sm:w-auto"
              >
                Ajouter fournisseur
              </button>
            </form>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((s) => (
                <div key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-bold text-slate-900">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.phone || 'Sans téléphone'}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    Dette restante :{' '}
                    <strong className={s.debtBalanceXof > 0 ? 'text-amber-800' : 'text-emerald-700'}>
                      {formatXof(s.debtBalanceXof)}
                    </strong>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modale création PO */}
        {showNewPo ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form onSubmit={handleCreatePo} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold text-slate-900">Nouvelle commande fournisseur</h3>
              <select
                value={poSupplierId}
                onChange={(e) => setPoSupplierId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={poProductId}
                onChange={(e) => setPoProductId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Quantité</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={poQty}
                    onChange={(e) => setPoQty(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Coût unitaire (XOF)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={poUnitCost}
                    onChange={(e) => setPoUnitCost(Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewPo(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Créer commande
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Réception partielle/totale */}
        {receiveTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form
              onSubmit={handleReceive}
              className="max-h-[90dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6"
            >
              <h3 className="text-lg font-bold text-slate-900">
                Réception — {receiveTarget.poNumber}
              </h3>
              <p className="text-xs text-slate-600">
                Saisissez uniquement les quantités réellement livrées ; le CMP sera recalculé automatiquement.
              </p>
              <div className="space-y-2">
                {receiveTarget.items.map((item) => {
                  const rem = item.orderedQty - item.receivedQty;
                  return (
                    <div
                      key={item.id}
                      className="grid grid-cols-2 items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-12"
                    >
                      <div className="col-span-2 sm:col-span-6">
                        <p className="font-semibold text-slate-900">{item.productName}</p>
                        <p className="text-slate-500">Reliquat : {rem} / {item.orderedQty}</p>
                      </div>
                      <div className="sm:col-span-3">
                        <label className="mb-0.5 block text-[10px] text-slate-500">Qté reçue</label>
                        <input
                          type="number"
                          min={0}
                          max={rem}
                          value={receiveQtys[item.id] ?? 0}
                          onChange={(e) =>
                            setReceiveQtys({ ...receiveQtys, [item.id]: Number(e.target.value) || 0 })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                          placeholder="Qté"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="mb-0.5 block text-[10px] text-slate-500">Coût XOF</label>
                        <input
                          type="number"
                          min={0}
                          value={receiveCosts[item.id] ?? item.unitCostXof}
                          onChange={(e) =>
                            setReceiveCosts({ ...receiveCosts, [item.id]: Number(e.target.value) || 0 })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                          placeholder="Coût XOF"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setReceiveTarget(null)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 sm:w-auto"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-forest-900 px-4 py-2 text-sm font-semibold text-white sm:w-auto"
                >
                  Valider la réception
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Paiement fournisseur */}
        {payTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form onSubmit={handlePaySupplier} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold text-slate-900">
                Régler {payTarget.supplier.name} ({payTarget.poNumber})
              </h3>
              <p className="text-xs text-slate-600">
                Dette restante : <strong>{formatXof(payTarget.debtDueXof)}</strong>
              </p>
              <input
                type="number"
                min={1}
                max={payTarget.debtDueXof}
                required
                value={payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
              />
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={payFromCash}
                  onChange={(e) => setPayFromCash(e.target.checked)}
                />
                Décaisser depuis la session de caisse ouverte (espèces)
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Enregistrer le paiement
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
