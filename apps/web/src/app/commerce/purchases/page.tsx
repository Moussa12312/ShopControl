'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  Plus,
  ShoppingCart,
  Sparkles,
  Truck,
  Wallet,
} from 'lucide-react';
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
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  suppliedProducts: string | null;
  debtBalanceXof: number;
  totalReceivedXof: number;
  totalPaidXof: number;
}

interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  unit?: string;
  costPriceXof: number | null;
  bulkUnitLabel?: string | null;
  unitsPerBulk?: number | null;
  stockAvailable?: number;
  stockPhysical?: number;
  alertThreshold?: number;
  variants?: Array<{
    id: string;
    name: string;
    sku: string;
    costPriceXof: number | null;
    stockAvailable?: number;
    stockPhysical?: number;
    alertThreshold?: number;
  }>;
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
  const [supProducts, setSupProducts] = useState('');

  // Nouvelle commande fournisseur
  const [showNewPo, setShowNewPo] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poProductId, setPoProductId] = useState('');
  const [poQty, setPoQty] = useState(10);
  const [poUnitCost, setPoUnitCost] = useState(1000);

  // Réception partielle/totale (avec option Gros/Carton & DLC Lot 9/10)
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrderRow | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});
  const [receiveCosts, setReceiveCosts] = useState<Record<string, number>>({});
  const [receiveInBulkMap, setReceiveInBulkMap] = useState<Record<string, boolean>>({});
  const [receiveExpiryMap, setReceiveExpiryMap] = useState<Record<string, string>>({});
  const [receiveBatchMap, setReceiveBatchMap] = useState<Record<string, string>>({});

  // Paiement fournisseur
  const [paymentMethods, setPaymentMethods] = useState<Array<{ code: string; label: string; enabled: boolean; affectsCashDrawer: boolean }>>([]);
  const [payTarget, setPayTarget] = useState<PurchaseOrderRow | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethodCode, setPayMethodCode] = useState('');
  const [payFromCash, setPayFromCash] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [s, o, p, shopMeta] = await Promise.all([
        apiFetch<SupplierRow[]>(`/shops/${shopId}/suppliers`, { shopId }),
        apiFetch<PurchaseOrderRow[]>(`/shops/${shopId}/purchases`, { shopId }),
        apiFetch<{ items: ProductOpt[] }>(`/shops/${shopId}/products?limit=200`, { shopId }),
        apiFetch<{ paymentMethods?: Array<{ code: string; label: string; enabled: boolean; affectsCashDrawer: boolean }> }>(
          `/shops/${shopId}`,
          { shopId },
        ).catch(() => null),
      ]);
      setSuppliers(s);
      setOrders(o);
      setProducts(p.items);
      const enabledMethods = (shopMeta?.paymentMethods || []).filter((m) => m.enabled);
      setPaymentMethods(enabledMethods);
      if (enabledMethods[0]) {
        setPayMethodCode((prev) =>
          prev && enabledMethods.some((m) => m.code === prev) ? prev : enabledMethods[0].code,
        );
      }
      if (s[0]) setPoSupplierId((prev) => (prev && s.some((x) => x.id === prev) ? prev : s[0].id));
      if (p.items[0]) setPoProductId((prev) => (prev && p.items.some((x) => x.id === prev) ? prev : p.items[0].id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des achats.');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Prefill depuis l'URL (ex: depuis les alertes de réapprovisionnement du stock)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const pId = params.get('productId');
    const q = params.get('qty');
    if (pId) {
      setPoProductId(pId);
      if (q) {
        const parsed = parseInt(q, 10);
        if (!isNaN(parsed) && parsed > 0) setPoQty(parsed);
      }
      setShowNewPo(true);
    }
  }, []);

  useEffect(() => {
    if (poProductId && products.length > 0) {
      const [actualProdId, actualVarId] = poProductId.split('::');
      const found = products.find((p) => p.id === actualProdId);
      if (found) {
        if (actualVarId && found.variants) {
          const vFound = found.variants.find((v) => v.id === actualVarId);
          if (vFound && vFound.costPriceXof && vFound.costPriceXof > 0) {
            setPoUnitCost(vFound.costPriceXof);
            return;
          }
        }
        if (found.costPriceXof && found.costPriceXof > 0) {
          setPoUnitCost(found.costPriceXof);
        }
      }
    }
  }, [poProductId, products]);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/suppliers`, {
        method: 'POST',
        shopId,
        body: {
          name: supName,
          phone: supPhone || undefined,
          suppliedProducts: supProducts.trim() || undefined,
        },
      });
      setSupName('');
      setSupPhone('');
      setSupProducts('');
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
    const [actualProdId, actualVarId] = poProductId.split('::');
    try {
      await apiFetch(`/shops/${shopId}/purchases`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          supplierId: poSupplierId,
          items: [
            {
              productId: actualProdId,
              ...(actualVarId ? { variantId: actualVarId } : {}),
              orderedQty: poQty,
              unitCostXof: poUnitCost,
            },
          ],
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
    const bMap: Record<string, boolean> = {};
    const eMap: Record<string, string> = {};
    const lMap: Record<string, string> = {};
    for (const item of po.items) {
      qMap[item.id] = Math.max(0, item.orderedQty - item.receivedQty);
      cMap[item.id] = item.unitCostXof;
      bMap[item.id] = false;
      eMap[item.id] = '';
      lMap[item.id] = '';
    }
    setReceiveQtys(qMap);
    setReceiveCosts(cMap);
    setReceiveInBulkMap(bMap);
    setReceiveExpiryMap(eMap);
    setReceiveBatchMap(lMap);
    setReceiveTarget(po);
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !receiveTarget) return;
    const items = receiveTarget.items
      .map((i) => {
        const rem = Math.max(0, i.orderedQty - i.receivedQty);
        const qty = receiveQtys[i.id] !== undefined ? receiveQtys[i.id] : rem;
        return {
          purchaseOrderItemId: i.id,
          receivedQty: Math.round(Number(qty) || 0),
          unitCostXof: Math.round(Number(receiveCosts[i.id]) || i.unitCostXof),
          receivedInBulk: Boolean(receiveInBulkMap[i.id]),
          ...(receiveExpiryMap[i.id]?.trim()
            ? {
              expiryDate: new Date(`${receiveExpiryMap[i.id].trim()}T23:59:59.000Z`).toISOString(),
            }
            : {}),
          ...(receiveBatchMap[i.id]?.trim() ? { batchNumber: receiveBatchMap[i.id].trim() } : {}),
        };
      })
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
          paymentMethodCode: payMethodCode || paymentMethods[0]?.code || 'CASH',
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
    <AppShell
      allowedRoles={['OWNER']}
      title="Achats & Fournisseurs"
      subtitle="Les commandes n’augmentent jamais le stock avant réception (partielle ou totale) avec recalcul automatique du CMP."
      headerActions={
        <>
          <div className="inline-flex rounded-full border border-white/10 bg-forest-800/80 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTab('orders')}
              className={`rounded-full px-3 py-1 transition ${tab === 'orders' ? 'bg-white font-bold text-forest-950' : 'text-[#8aa8a2] hover:text-white'
                }`}
            >
              Commandes ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('suppliers')}
              className={`rounded-full px-3 py-1 transition ${tab === 'suppliers' ? 'bg-white font-bold text-forest-950' : 'text-[#8aa8a2] hover:text-white'
                }`}
            >
              Fournisseurs ({suppliers.length})
            </button>
          </div>
          {tab === 'orders' && suppliers.length > 0 && products.length > 0 ? (
            <button type="button" onClick={() => setShowNewPo(true)} className="sc-hero-btn-primary">
              <Plus className="h-3.5 w-3.5" />
              Nouvel achat
            </button>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">

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
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:p-5"
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
              className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-12"
            >
              <input
                required
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
                placeholder="Nom du fournisseur *"
                className="sc-input sm:col-span-4"
              />
              <input
                value={supPhone}
                onChange={(e) => setSupPhone(e.target.value)}
                placeholder="Téléphone"
                className="sc-input sm:col-span-3"
              />
              <div className="sm:col-span-5 space-y-1.5">
                <div className="flex gap-2">
                  <select
                    value=""
                    onChange={(e) => {
                      const prodName = e.target.value;
                      if (!prodName) return;
                      const current = supProducts
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      if (!current.includes(prodName)) {
                        const updated = [...current, prodName].join(', ');
                        setSupProducts(updated);
                      }
                    }}
                    className="sc-input flex-1 text-xs bg-porcelain-50"
                  >
                    <option value="">+ Choisir un produit du catalogue...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  value={supProducts}
                  onChange={(e) => setSupProducts(e.target.value)}
                  placeholder="Articles fournis (ex. Chaussure, Sacoche...)"
                  className="sc-input text-xs"
                />
                {supProducts.trim() ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {supProducts
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((item, idx) => (
                        <span
                          key={`tag-${idx}`}
                          className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 px-2 py-0.5 text-[11px] font-bold text-brand-800"
                        >
                          {item}
                          <button
                            type="button"
                            onClick={() => {
                              const filtered = supProducts
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean)
                                .filter((x) => x !== item);
                              setSupProducts(filtered.join(', '));
                            }}
                            className="text-brand-600 hover:text-rose-600 font-bold ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
              <div className="sm:col-span-12 sm:flex sm:justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="sc-btn-primary w-full sm:w-auto"
                >
                  Ajouter fournisseur
                </button>
              </div>
            </form>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((s) => (
                <div key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="font-bold text-slate-900">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.phone || 'Sans téléphone'}</p>
                  {s.suppliedProducts ? (
                    <p className="mt-1.5 inline-block rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                      Fournit : {s.suppliedProducts}
                    </p>
                  ) : null}
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
                    {s.suppliedProducts ? ` — ${s.suppliedProducts}` : ''}
                  </option>
                ))}
              </select>
              <select
                value={poProductId}
                onChange={(e) => setPoProductId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {products.flatMap((p) => {
                  if (p.variants && p.variants.length > 0) {
                    return [
                      <option key={p.id} value={p.id}>
                        {p.name} (Stock global / sans variante)
                      </option>,
                      ...p.variants.map((v) => (
                        <option key={`${p.id}::${v.id}`} value={`${p.id}::${v.id}`}>
                          {p.name} — {v.name} ({v.sku || p.sku})
                        </option>
                      )),
                    ];
                  }
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  );
                })}
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
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowNewPo(false)}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 sm:w-auto"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white sm:w-auto"
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
              <div className="space-y-2.5">
                {receiveTarget.items.map((item) => {
                  const rem = item.orderedQty - item.receivedQty;
                  const prodInfo = products.find((p) => p.id === item.productId);
                  const canBulk = Boolean(prodInfo?.unitsPerBulk && prodInfo.unitsPerBulk >= 2);
                  return (
                    <div
                      key={item.id}
                      className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                    >
                      <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-12">
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
                            value={receiveQtys[item.id] !== undefined ? receiveQtys[item.id] : rem}
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

                      {canBulk ? (
                        <label className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-950">
                          <input
                            type="checkbox"
                            checked={Boolean(receiveInBulkMap[item.id])}
                            onChange={(e) =>
                              setReceiveInBulkMap({
                                ...receiveInBulkMap,
                                [item.id]: e.target.checked,
                              })
                            }
                            className="h-3.5 w-3.5 accent-brand-700"
                          />
                          <span>
                            Reçu en gros ({prodInfo?.bulkUnitLabel || 'carton'} de{' '}
                            {prodInfo?.unitsPerBulk} {prodInfo?.unit || 'unités'} → crédite{' '}
                            <strong>
                              {(receiveQtys[item.id] || 0) * (prodInfo?.unitsPerBulk || 1)}{' '}
                              {prodInfo?.unit || 'unités'}
                            </strong>
                            )
                          </span>
                        </label>
                      ) : null}

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-0.5 block text-[10px] text-slate-500">
                            Date de péremption (DLC — optionnelle)
                          </label>
                          <input
                            type="date"
                            value={receiveExpiryMap[item.id] || ''}
                            onChange={(e) =>
                              setReceiveExpiryMap({
                                ...receiveExpiryMap,
                                [item.id]: e.target.value,
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-0.5 block text-[10px] text-slate-500">
                            N° de lot (optionnel)
                          </label>
                          <input
                            value={receiveBatchMap[item.id] || ''}
                            onChange={(e) =>
                              setReceiveBatchMap({
                                ...receiveBatchMap,
                                [item.id]: e.target.value,
                              })
                            }
                            placeholder="Ex. LOT-2026"
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                          />
                        </div>
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
                className="sc-input font-bold tabular"
              />
              {paymentMethods.length > 0 ? (
                <select
                  value={payMethodCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    setPayMethodCode(code);
                    const found = paymentMethods.find((m) => m.code === code);
                    setPayFromCash(Boolean(found?.affectsCashDrawer));
                  }}
                  className="sc-input"
                >
                  {paymentMethods.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={payFromCash}
                  onChange={(e) => setPayFromCash(e.target.checked)}
                />
                Décaisser depuis la session de caisse ouverte
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
