'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react';
import {
  calculateSaleTotals,
  DEFAULT_PAYMENT_METHODS,
  formatDateTimeInTimezone,
  formatXof,
  PaymentMethodConfig,
  TaxMode,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import {
  cacheShopProducts,
  enqueueOfflineSale,
  getCachedShopProducts,
  getPendingOfflineSales,
  OfflineOperationItem,
  updateOfflineSaleStatus,
} from '@/lib/local-db';
import { useAuth } from '@/components/providers/AuthProvider';
import { useNetworkStatus } from '@/components/providers/NetworkStatusProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface ProductItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  salePriceXof: number;
  stockAvailable: number;
  status: string;
  unit: string;
}

interface ClientItem {
  id: string;
  fullName: string;
  phone: string;
  creditLimitXof: number;
  outstandingDebtXof: number;
}

interface CartItem {
  product: ProductItem;
  quantity: number;
}

interface SaleRow {
  id: string;
  saleNumber: string;
  status: string;
  offlineSynced: boolean;
  stockConflict: boolean;
  client: { id: string; fullName: string; phone: string } | null;
  totalXof: number;
  paidAmountXof: number;
  dueAmountXof: number;
  refundedAmountXof: number;
  cancelReason: string | null;
  declaredOperatorName: string | null;
  lines: Array<{
    id: string;
    productName: string;
    quantity: number;
    returnedQty: number;
    unitPriceXof: number;
    lineTotalXof: number;
  }>;
  payments: Array<{ paymentMethodCode: string; amountXof: number; transactionRef: string | null }>;
  createdAt: string;
}

export default function PosPage() {
  const { activeOperator } = useAuth();
  const { isOnline, apiReachable } = useNetworkStatus();
  const { shopId, activeShop, selectShop } = useActiveOperationalShop();

  const [tab, setTab] = useState<'pos' | 'history'>('pos');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>(DEFAULT_PAYMENT_METHODS);
  const [taxMode, setTaxMode] = useState<TaxMode>('NONE');
  const [taxRateBps, setTaxRateBps] = useState(0);
  const [pendingOffline, setPendingOffline] = useState<OfflineOperationItem[]>([]);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [cashRoundingStep, setCashRoundingStep] = useState<0 | 5 | 25>(0);
  const [paymentMethodCode, setPaymentMethodCode] = useState('CASH');
  const [amountPaidXof, setAmountPaidXof] = useState<string>('');
  const [transactionRef, setTransactionRef] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err' | 'warn'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Modales historique (Annulation / Retour / Remboursement)
  const [cancelSaleTarget, setCancelSaleTarget] = useState<SaleRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [returnTarget, setReturnTarget] = useState<SaleRow | null>(null);
  const [returnLineId, setReturnLineId] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnCondition, setReturnCondition] = useState<'RESELLABLE' | 'DAMAGED_LOSS'>('RESELLABLE');
  const [returnReason, setReturnReason] = useState('');
  const [refundTarget, setRefundTarget] = useState<SaleRow | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState('');

  const loadOfflineQueue = useCallback(async () => {
    if (!shopId) return;
    const queued = await getPendingOfflineSales(shopId);
    setPendingOffline(queued);
  }, [shopId]);

  const loadData = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    await loadOfflineQueue();

    try {
      const [shopDetails, prodRes, clientRes, salesRes] = await Promise.all([
        apiFetch<{
          paymentMethods: PaymentMethodConfig[];
          taxMode: TaxMode;
          defaultTaxRateBps: number;
        }>(`/shops/${shopId}`, { shopId, requiresOnline: false }),
        apiFetch<{ items: ProductItem[] }>(`/shops/${shopId}/products?limit=200`, {
          shopId,
          requiresOnline: false,
        }),
        apiFetch<ClientItem[]>(`/shops/${shopId}/clients`, { shopId, requiresOnline: false }).catch(
          () => [],
        ),
        apiFetch<{ items: SaleRow[] }>(`/shops/${shopId}/sales?limit=30`, {
          shopId,
          requiresOnline: false,
        }),
      ]);

      const enabledMethods = (shopDetails.paymentMethods || DEFAULT_PAYMENT_METHODS).filter(
        (m) => m.enabled,
      );
      setPaymentMethods(enabledMethods.length ? enabledMethods : DEFAULT_PAYMENT_METHODS);
      setTaxMode(shopDetails.taxMode || 'NONE');
      setTaxRateBps(shopDetails.defaultTaxRateBps || 0);

      const sellable = prodRes.items.filter((p) => p.status !== 'ARCHIVED');
      setProducts(sellable);
      setClients(clientRes);
      setSales(salesRes.items);

      // Met à jour le cache local IndexedDB pour le mode dégradé comptoir Option B
      await cacheShopProducts(
        shopId,
        sellable.map((p) => ({ ...p, shopId, cachedAt: new Date().toISOString() })),
      );
    } catch (err) {
      // Fallback sur le cache local IndexedDB si hors-ligne (Option B — Section 14.3)
      const cached = await getCachedShopProducts(shopId);
      if (cached.length > 0) {
        setProducts(cached);
        setFeedback({
          type: 'warn',
          msg: 'Mode hors-ligne actif : catalogue chargé depuis le cache local. Les ventes seront enregistrées localement puis synchronisées.',
        });
      } else {
        setError(err instanceof ApiError ? err.message : 'Erreur de chargement du point de vente.');
      }
    } finally {
      setLoading(false);
    }
  }, [shopId, loadOfflineQueue]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totals = useMemo(() => {
    if (cart.length === 0) return null;
    return calculateSaleTotals({
      lines: cart.map((c) => ({
        quantity: c.quantity,
        unitPriceXof: c.product.salePriceXof,
      })),
      globalDiscountType: discountPercent > 0 ? 'PERCENT' : 'NONE',
      globalDiscountValue: discountPercent,
      taxMode,
      defaultTaxRateBps: taxRateBps,
      cashRoundingStep: paymentMethodCode === 'CASH' ? cashRoundingStep : 0,
    });
  }, [cart, discountPercent, taxMode, taxRateBps, paymentMethodCode, cashRoundingStep]);

  const activeMethod = paymentMethods.find((m) => m.code === paymentMethodCode) || paymentMethods[0];
  const effectivePaid =
    amountPaidXof.trim() === '' ? (totals?.totalXof ?? 0) : Math.max(0, Math.round(Number(amountPaidXof) || 0));
  const changeDue = totals ? Math.max(0, effectivePaid - totals.totalXof) : 0;
  const creditDue = totals ? Math.max(0, totals.totalXof - effectivePaid) : 0;

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)),
    );
  }, [products, search]);

  const addToCart = (product: ProductItem) => {
    setFeedback(null);
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.id === product.id);
      if (idx >= 0) {
        return prev.map((item, i) =>
          i === idx ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.product.id === productId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    );
  };

  // Permet la validation rapide par lecteur code-barres + Entrée
  const handleBarcodeEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const exact = products.find(
      (p) =>
        p.barcode?.toLowerCase() === search.trim().toLowerCase() ||
        p.sku.toLowerCase() === search.trim().toLowerCase(),
    );
    if (exact) {
      e.preventDefault();
      addToCart(exact);
      setSearch('');
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !totals || cart.length === 0) return;

    setBusy(true);
    setFeedback(null);

    const payload = {
      clientOperationId: crypto.randomUUID(),
      clientId: selectedClientId || null,
      lines: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
      globalDiscountType: discountPercent > 0 ? 'PERCENT' : 'NONE',
      globalDiscountValue: discountPercent,
      cashRoundingStep: paymentMethodCode === 'CASH' ? cashRoundingStep : 0,
      payments:
        effectivePaid > 0
          ? [
              {
                paymentMethodCode,
                amountXof: effectivePaid,
                transactionRef: transactionRef.trim() || undefined,
              },
            ]
          : [],
    };

    try {
      // Option B (Section 14.3) : si hors-ligne, enregistrement local en file d'attente IndexedDB
      if (!isOnline || !apiReachable) {
        const queued = await enqueueOfflineSale(shopId, payload, totals.totalXof);
        setCart([]);
        setDiscountPercent(0);
        setAmountPaidXof('');
        setTransactionRef('');
        await loadOfflineQueue();
        setFeedback({
          type: 'warn',
          msg: `Enregistré localement (${queued.offlineSaleNumber}), en attente de synchronisation serveur.`,
        });
        return;
      }

      const created = await apiFetch<{ saleNumber: string; totalXof: number; dueAmountXof: number }>(
        `/shops/${shopId}/sales`,
        {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: payload,
        },
      );

      setCart([]);
      setDiscountPercent(0);
      setAmountPaidXof('');
      setTransactionRef('');
      setSelectedClientId('');
      setFeedback({
        type: 'ok',
        msg: `Vente ${created.saleNumber} validée (${formatXof(created.totalXof)})${
          created.dueAmountXof > 0 ? ` — Créance : ${formatXof(created.dueAmountXof)}` : ''
        }.`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof ApiError ? err.message : 'Erreur lors de la validation de la vente.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSyncOfflineQueue = async () => {
    if (!shopId || pendingOffline.length === 0) return;
    setBusy(true);
    let syncedCount = 0;
    let conflictsCount = 0;

    for (const item of pendingOffline) {
      try {
        const res = await apiFetch<{ stockConflict?: boolean }>(`/shops/${shopId}/sales/sync`, {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: item.payload,
        });
        await updateOfflineSaleStatus(item.id!, res.stockConflict ? 'CONFLICT' : 'SYNCED');
        syncedCount += 1;
        if (res.stockConflict) conflictsCount += 1;
      } catch (err) {
        await updateOfflineSaleStatus(
          item.id!,
          'ERROR',
          err instanceof ApiError ? err.message : 'Échec de synchronisation',
        );
      }
    }

    await loadData();
    setBusy(false);
    setFeedback({
      type: conflictsCount > 0 ? 'warn' : 'ok',
      msg: `${syncedCount} vente(s) locale(s) synchronisée(s)${
        conflictsCount > 0 ? ` (${conflictsCount} conflit(s) de stock signalé(s) au propriétaire)` : ''
      }.`,
    });
  };

  const handleCancelSale = async () => {
    if (!shopId || !cancelSaleTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/sales/${cancelSaleTarget.id}/cancel`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { reason: cancelReason, refundCashFromDrawer: true },
      });
      setCancelSaleTarget(null);
      setCancelReason('');
      await loadData();
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof ApiError ? err.message : 'Annulation refusée.' });
    } finally {
      setBusy(false);
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !returnTarget || !returnLineId) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/sales/${returnTarget.id}/returns`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          reason: returnReason,
          items: [{ saleLineId: returnLineId, quantity: returnQty, condition: returnCondition }],
        },
      });
      setReturnTarget(null);
      setReturnReason('');
      await loadData();
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof ApiError ? err.message : 'Retour refusé.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !refundTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/sales/${refundTarget.id}/refunds`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { amountXof: refundAmount, paymentMethodCode: 'CASH', reason: refundReason },
      });
      setRefundTarget(null);
      setRefundReason('');
      await loadData();
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof ApiError ? err.message : 'Remboursement refusé.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Ventes & Comptoir POS</h1>
            <p className="text-sm text-slate-600">
              Validation atomique (stock + caisse + créances) · Montants entiers XOF · Mode dégradé
              Option B.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShopPickerInline shopId={shopId} onChange={selectShop} />
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab('pos')}
                className={`rounded-lg px-3 py-1.5 ${
                  tab === 'pos' ? 'bg-brand-700 text-white' : 'text-slate-600'
                }`}
              >
                Comptoir POS
              </button>
              <button
                type="button"
                onClick={() => setTab('history')}
                className={`rounded-lg px-3 py-1.5 ${
                  tab === 'history' ? 'bg-brand-700 text-white' : 'text-slate-600'
                }`}
              >
                Historique ({sales.length})
              </button>
            </div>
          </div>
        </div>

        {/* File de synchronisation Option B */}
        {pendingOffline.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="flex items-center gap-2">
              <CloudOff className="h-5 w-5 text-amber-700" />
              <span>
                <strong>{pendingOffline.length} vente(s) locale(s)</strong> en attente de
                synchronisation serveur (comptées séparément tant que non confirmées).
              </span>
            </div>
            <button
              type="button"
              disabled={busy || !isOnline || !apiReachable}
              onClick={handleSyncOfflineQueue}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Synchroniser maintenant
            </button>
          </div>
        ) : null}

        {feedback ? (
          <div
            role="alert"
            className={`flex items-center gap-2 rounded-xl border p-3.5 text-sm font-medium ${
              feedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : feedback.type === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0" />
            )}
            <span>{feedback.msg}</span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : !shopId ? (
          <EmptyState
            title="Aucune boutique sélectionnée"
            description="Créez ou sélectionnez une boutique pour ouvrir le comptoir de vente."
          />
        ) : tab === 'pos' ? (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Catalogue rapide */}
            <div className="space-y-4 lg:col-span-7">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleBarcodeEnter}
                  placeholder="Rechercher par nom, SKU ou scanner un code-barres (Entrée)…"
                  className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm shadow-xs"
                />
              </div>

              {filteredProducts.length === 0 ? (
                <EmptyState
                  title="Aucun produit trouvé"
                  description="Ajoutez vos produits dans l’onglet Produits ou via Import CSV."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addToCart(p)}
                      className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-600 hover:shadow-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="truncate font-semibold text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500">
                          {p.sku} · Stock dispo :{' '}
                          <span
                            className={
                              p.stockAvailable <= 0
                                ? 'font-bold text-red-600'
                                : 'font-semibold text-emerald-700'
                            }
                          >
                            {p.stockAvailable} {p.unit}
                          </span>
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-brand-50 px-2.5 py-1 text-sm font-bold text-brand-800">
                        {formatXof(p.salePriceXof)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Panier & Encaissement */}
            <form
              onSubmit={handleCheckout}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-5"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <ShoppingCart className="h-5 w-5 text-brand-700" />
                    <span>Panier ({cart.reduce((a, b) => a + b.quantity, 0)})</span>
                  </div>
                  {cart.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setCart([])}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Vider
                    </button>
                  ) : null}
                </div>

                {cart.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    Cliquez sur un article à gauche ou scannez son code-barres.
                  </p>
                ) : (
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {cart.map((item) => (
                      <div
                        key={item.product.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2.5 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-900">
                            {item.product.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatXof(item.product.salePriceXof)} × {item.quantity} ={' '}
                            <strong>{formatXof(item.product.salePriceXof * item.quantity)}</strong>
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.product.id, -1)}
                            aria-label="Diminuer quantité"
                            className="rounded-lg border border-slate-300 bg-white p-1 hover:bg-slate-100"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-7 text-center font-bold">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.product.id, 1)}
                            aria-label="Augmenter quantité"
                            className="rounded-lg border border-slate-300 bg-white p-1 hover:bg-slate-100"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.product.id, -item.quantity)}
                            aria-label="Retirer"
                            className="ml-1 rounded-lg p-1 text-red-500 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Remise globale (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={activeShop?.maxDiscountPercent ?? 100}
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(Number(e.target.value) || 0)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Client (requis si crédit)
                    </label>
                    <select
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    >
                      <option value="">Client comptoir</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.fullName} ({c.phone})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Moyen de paiement
                    </label>
                    <select
                      value={paymentMethodCode}
                      onChange={(e) => setPaymentMethodCode(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    >
                      {paymentMethods.map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Montant reçu (XOF)
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder={totals ? String(totals.totalXof) : '0'}
                      value={amountPaidXof}
                      onChange={(e) => setAmountPaidXof(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold"
                    />
                  </div>
                </div>

                {activeMethod?.requireReference ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Référence transaction {activeMethod.label} (obligatoire et unique) *
                    </label>
                    <input
                      required
                      value={transactionRef}
                      onChange={(e) => setTransactionRef(e.target.value)}
                      placeholder="ex. OM261119.123456"
                      className="mt-1 w-full rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                ) : null}

                {paymentMethodCode === 'CASH' ? (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Arrondi espèces tracé :</span>
                    <div className="inline-flex gap-1">
                      {([0, 5, 25] as const).map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => setCashRoundingStep(step)}
                          className={`rounded-md px-2 py-1 font-semibold ${
                            cashRoundingStep === step
                              ? 'bg-brand-700 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {step === 0 ? 'Aucun' : `${step} F`}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Récapitulatif XOF & validation */}
              <div className="mt-5 space-y-2 border-t border-slate-200 pt-4 text-sm">
                {totals ? (
                  <>
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Sous-total brut</span>
                      <span>{formatXof(totals.grossSubtotalXof)}</span>
                    </div>
                    {totals.discountTotalXof > 0 ? (
                      <div className="flex justify-between text-xs text-emerald-700">
                        <span>Remise ({totals.effectiveDiscountPercent} %)</span>
                        <span>- {formatXof(totals.discountTotalXof)}</span>
                      </div>
                    ) : null}
                    {totals.taxTotalXof > 0 ? (
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>Taxes ({taxMode})</span>
                        <span>{formatXof(totals.taxTotalXof)}</span>
                      </div>
                    ) : null}
                    {totals.roundingXof !== 0 ? (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Ligne d’arrondi</span>
                        <span>{totals.roundingXof > 0 ? '+' : ''}{formatXof(totals.roundingXof)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between text-lg font-bold text-slate-900">
                      <span>TOTAL À PAYER</span>
                      <span>{formatXof(totals.totalXof)}</span>
                    </div>
                    {changeDue > 0 ? (
                      <p className="text-xs font-semibold text-emerald-700">
                        Monnaie à rendre : {formatXof(changeDue)}
                      </p>
                    ) : null}
                    {creditDue > 0 ? (
                      <p className="text-xs font-semibold text-amber-800">
                        Solde dû (créance client) : {formatXof(creditDue)}
                      </p>
                    ) : null}
                  </>
                ) : null}

                <button
                  type="submit"
                  disabled={busy || cart.length === 0}
                  className="mt-2 w-full rounded-xl bg-brand-700 px-4 py-3 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  {busy
                    ? 'Validation…'
                    : !isOnline || !apiReachable
                      ? 'Enregistrer localement (Hors-ligne)'
                      : 'Valider la vente'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Historique des ventes */
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3">N° Vente</th>
                  <th className="px-4 py-3">Date & Opérateur</th>
                  <th className="px-4 py-3">Total / Payé / Dû</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-bold text-slate-900">{sale.saleNumber}</p>
                      <p className="text-xs text-slate-500">
                        {sale.lines.length} ligne(s)
                        {sale.client ? ` · ${sale.client.fullName}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>{formatDateTimeInTimezone(sale.createdAt)}</p>
                      {sale.declaredOperatorName ? (
                        <p className="text-slate-400">Opérateur : {sale.declaredOperatorName}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p className="font-bold text-slate-900">{formatXof(sale.totalXof)}</p>
                      <p className="text-slate-500">
                        Payé : {formatXof(sale.paidAmountXof)}
                        {sale.dueAmountXof > 0 ? (
                          <span className="ml-1 font-semibold text-amber-700">
                            · Dû : {formatXof(sale.dueAmountXof)}
                          </span>
                        ) : null}
                        {sale.refundedAmountXof > 0 ? (
                          <span className="ml-1 font-semibold text-red-600">
                            · Remb. : {formatXof(sale.refundedAmountXof)}
                          </span>
                        ) : null}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          sale.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {sale.status === 'COMPLETED' ? 'Validée' : 'Annulée'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {sale.status === 'COMPLETED' ? (
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setReturnTarget(sale);
                              setReturnLineId(sale.lines[0]?.id || '');
                              setReturnQty(1);
                              setReturnReason('');
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            Retour
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRefundTarget(sale);
                              setRefundAmount(Math.max(0, sale.paidAmountXof - sale.refundedAmountXof));
                              setRefundReason('');
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Rembourser
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCancelSaleTarget(sale);
                              setCancelReason('');
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">{sale.cancelReason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modale Annulation vente */}
        {cancelSaleTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold text-slate-900">
                Annuler la vente {cancelSaleTarget.saleNumber}
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                La vente reste dans l’historique avec mention ANNULÉ et réintègre les articles en stock.
              </p>
              <textarea
                rows={3}
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Motif d’annulation obligatoire (5+ caractères)…"
                className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancelSaleTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={busy || cancelReason.trim().length < 5}
                  onClick={handleCancelSale}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Confirmer l’annulation
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modale Retour article */}
        {returnTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form onSubmit={handleReturnSubmit} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold text-slate-900">
                Retour article — {returnTarget.saleNumber}
              </h3>
              <div>
                <label className="block text-xs font-medium text-slate-700">Article</label>
                <select
                  value={returnLineId}
                  onChange={(e) => setReturnLineId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {returnTarget.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.productName} (max {l.quantity - l.returnedQty})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Quantité</label>
                  <input
                    type="number"
                    min={1}
                    value={returnQty}
                    onChange={(e) => setReturnQty(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">État</label>
                  <select
                    value={returnCondition}
                    onChange={(e) =>
                      setReturnCondition(e.target.value as 'RESELLABLE' | 'DAMAGED_LOSS')
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="RESELLABLE">Revendable (retour stock)</option>
                    <option value="DAMAGED_LOSS">Non revendable (perte)</option>
                  </select>
                </div>
              </div>
              <textarea
                rows={2}
                required
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Motif du retour…"
                className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Enregistrer retour
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Remboursement */}
        {refundTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form onSubmit={handleRefundSubmit} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold text-slate-900">
                Remboursement — {refundTarget.saleNumber}
              </h3>
              <p className="text-xs text-slate-600">
                Maximum remboursable :{' '}
                <strong>{formatXof(refundTarget.paidAmountXof - refundTarget.refundedAmountXof)}</strong>
              </p>
              <input
                type="number"
                min={1}
                max={refundTarget.paidAmountXof - refundTarget.refundedAmountXof}
                required
                value={refundAmount}
                onChange={(e) => setRefundAmount(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
              />
              <textarea
                rows={2}
                required
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Motif obligatoire du remboursement…"
                className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRefundTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Rembourser en espèces
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
