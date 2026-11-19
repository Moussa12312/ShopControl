'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  FileText,
  Minus,
  Package,
  Plus,
  Printer,
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
import { ReceiptModal, SaleDocumentView } from '@/components/commerce/ReceiptModal';
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
  imageUrls?: string[];
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
  const [mobilePosPane, setMobilePosPane] = useState<'catalog' | 'cart'>('catalog');
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

  // Modales historique (Ticket / Annulation / Retour / Remboursement)
  const [activeDoc, setActiveDoc] = useState<SaleDocumentView | null>(null);
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [cancelSaleTarget, setCancelSaleTarget] = useState<SaleRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [returnTarget, setReturnTarget] = useState<SaleRow | null>(null);
  const [returnLineId, setReturnLineId] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnCondition, setReturnCondition] = useState<'RESELLABLE' | 'DAMAGED_LOSS'>('RESELLABLE');
  const [returnReason, setReturnReason] = useState('');
  const [refundTarget, setRefundTarget] = useState<SaleRow | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundMethodCode, setRefundMethodCode] = useState('CASH');
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

      const created = await apiFetch<{
        id: string;
        saleNumber: string;
        totalXof: number;
        dueAmountXof: number;
      }>(`/shops/${shopId}/sales`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: payload,
      });

      setCart([]);
      setMobilePosPane('catalog');
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
      // Ouvre immédiatement le ticket de caisse prêt à imprimer / PDF / WhatsApp (Lot 3)
      apiFetch<SaleDocumentView[]>(`/shops/${shopId}/documents/by-sale/${created.id}`, { shopId })
        .then((docs) => {
          const receipt = docs.find((d) => d.documentType === 'SALE_RECEIPT') || docs[0];
          if (receipt) setActiveDoc(receipt);
        })
        .catch(() => undefined);
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

  const openSaleDocument = async (saleId: string, preferredType: 'SALE_RECEIPT' | 'CREDIT_NOTE' = 'SALE_RECEIPT') => {
    if (!shopId) return;
    try {
      const docs = await apiFetch<SaleDocumentView[]>(
        `/shops/${shopId}/documents/by-sale/${saleId}`,
        { shopId },
      );
      const chosen =
        docs.find((d) => d.documentType === preferredType) ||
        docs[docs.length - 1] ||
        null;
      if (chosen) setActiveDoc(chosen);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof ApiError ? err.message : 'Impossible d’ouvrir le justificatif.',
      });
    }
  };

  const handleCancelSale = async () => {
    if (!shopId || !cancelSaleTarget) return;
    setBusy(true);
    setModalErr(null);
    try {
      await apiFetch(`/shops/${shopId}/sales/${cancelSaleTarget.id}/cancel`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { reason: cancelReason, refundCashFromDrawer: true },
      });
      setCancelSaleTarget(null);
      setCancelReason('');
      setFeedback({ type: 'ok', msg: `Vente ${cancelSaleTarget.saleNumber} annulée et stock réintégré.` });
      await loadData();
    } catch (err) {
      setModalErr(err instanceof ApiError ? err.message : 'Annulation refusée.');
    } finally {
      setBusy(false);
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !returnTarget || !returnLineId) return;
    setBusy(true);
    setModalErr(null);
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
      setFeedback({ type: 'ok', msg: `Retour article enregistré sur ${returnTarget.saleNumber}.` });
      await loadData();
    } catch (err) {
      setModalErr(err instanceof ApiError ? err.message : 'Retour refusé.');
    } finally {
      setBusy(false);
    }
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !refundTarget) return;
    setBusy(true);
    setModalErr(null);
    try {
      const refunded = await apiFetch<{ creditNoteNumber?: string }>(
        `/shops/${shopId}/sales/${refundTarget.id}/refunds`,
        {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: {
            amountXof: Math.round(Number(refundAmount) || 0),
            paymentMethodCode: refundMethodCode,
            reason: refundReason.trim(),
          },
        },
      );
      const targetId = refundTarget.id;
      const targetNum = refundTarget.saleNumber;
      setRefundTarget(null);
      setRefundReason('');
      setFeedback({
        type: 'ok',
        msg: `Remboursement de ${formatXof(refundAmount)} enregistré sur ${targetNum}${
          refunded.creditNoteNumber ? ` (Avoir ${refunded.creditNoteNumber})` : ''
        }. Le chiffre d’affaires net a été actualisé.`,
      });
      await loadData();
      await openSaleDocument(targetId, 'CREDIT_NOTE');
    } catch (err) {
      setModalErr(err instanceof ApiError ? err.message : 'Remboursement refusé.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Ventes & Comptoir POS</h1>
            <p className="text-xs text-slate-600 sm:text-sm">
              Validation atomique (stock + caisse + créances) · Montants entiers XOF · Mode dégradé
              Option B.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShopPickerInline shopId={shopId} onChange={selectShop} />
            <div className="grid w-full grid-cols-2 rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold sm:inline-flex sm:w-auto">
              <button
                type="button"
                onClick={() => setTab('pos')}
                className={`rounded-lg px-3 py-1.5 text-center ${
                  tab === 'pos' ? 'bg-forest-900 text-white' : 'text-slate-600'
                }`}
              >
                Comptoir POS
              </button>
              <button
                type="button"
                onClick={() => setTab('history')}
                className={`rounded-lg px-3 py-1.5 text-center ${
                  tab === 'history' ? 'bg-forest-900 text-white' : 'text-slate-600'
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
          <div className="space-y-4">
            {/* Switcher mobile Catalogue ↔ Panier (< lg) */}
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-white p-1 text-xs font-bold lg:hidden">
              <button
                type="button"
                onClick={() => setMobilePosPane('catalog')}
                className={`rounded-xl py-2 text-center transition ${
                  mobilePosPane === 'catalog'
                    ? 'bg-forest-900 text-white shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Catalogue ({filteredProducts.length})
              </button>
              <button
                type="button"
                onClick={() => setMobilePosPane('cart')}
                className={`rounded-xl py-2 text-center transition ${
                  mobilePosPane === 'cart'
                    ? 'bg-forest-900 text-white shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Panier ({cart.reduce((a, b) => a + b.quantity, 0)})
              </button>
            </div>

            <div className="grid gap-5 lg:grid-cols-12">
              {/* Catalogue rapide */}
              <div
                className={`min-w-0 space-y-4 lg:col-span-7 xl:col-span-8 ${
                  mobilePosPane === 'cart' ? 'hidden lg:block' : 'block'
                }`}
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={handleBarcodeEnter}
                    placeholder="Rechercher par nom, SKU ou scanner un code-barres…"
                    className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm shadow-xs"
                  />
                </div>

                {filteredProducts.length === 0 ? (
                  <EmptyState
                    title="Aucun produit trouvé"
                    description="Ajoutez vos produits dans l’onglet Produits ou via Import CSV."
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredProducts.map((p) => {
                      const inCartQty = cart.find((c) => c.product.id === p.id)?.quantity || 0;
                      const thumb = p.imageUrls?.[0];
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addToCart(p)}
                          className={`flex items-center justify-between gap-2.5 rounded-2xl border bg-white p-3 text-left transition hover:border-forest-800 hover:shadow-card sm:p-3.5 ${
                            inCartQty > 0 ? 'border-forest-900 ring-1 ring-forest-900/15' : 'border-slate-200'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={thumb}
                                alt={p.name}
                                className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 object-cover bg-porcelain-50"
                              />
                            ) : (
                              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                                <Package className="h-5 w-5" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="truncate text-sm font-bold text-slate-900">{p.name}</p>
                                {inCartQty > 0 ? (
                                  <span className="shrink-0 rounded-full bg-forest-900 px-1.5 py-0.5 text-[10px] font-bold text-limeglow-400">
                                    ×{inCartQty}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {p.sku} ·{' '}
                                <span
                                  className={
                                    p.stockAvailable <= 0
                                      ? 'font-bold text-rose-600'
                                      : 'font-semibold text-emerald-700'
                                  }
                                >
                                  {p.stockAvailable} {p.unit}
                                </span>
                              </p>
                            </div>
                          </div>
                          <span className="shrink-0 rounded-xl bg-brand-50 px-2.5 py-1 text-xs font-extrabold text-brand-800 tabular sm:text-sm">
                            {formatXof(p.salePriceXof)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Panier & Encaissement */}
              <form
                onSubmit={handleCheckout}
                className={`min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5 lg:col-span-5 lg:flex xl:col-span-4 ${
                  mobilePosPane === 'cart' ? 'flex' : 'hidden lg:flex'
                }`}
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
                  className="mt-2 w-full rounded-xl bg-forest-900 px-4 py-3 text-sm font-bold text-white hover:bg-forest-800 disabled:opacity-50"
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

            {/* Barre flottante mobile d'accès rapide au panier (au-dessus du dock mobile) */}
            {mobilePosPane === 'catalog' && cart.length > 0 && totals ? (
              <div className="fixed inset-x-3 bottom-[68px] z-20 flex items-center justify-between gap-3 rounded-2xl border border-limeglow-400/30 bg-forest-950 px-4 py-3 text-white shadow-2xl lg:hidden">
                <div className="min-w-0">
                  <p className="text-[11px] text-emerald-200/80">
                    {cart.reduce((a, b) => a + b.quantity, 0)} article(s) dans le panier
                  </p>
                  <p className="truncate text-base font-bold text-white">
                    {formatXof(totals.totalXof)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobilePosPane('cart')}
                  className="shrink-0 rounded-full bg-limeglow-400 px-4 py-2 text-xs font-bold text-forest-950 shadow-sm"
                >
                  Encaisser →
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          /* Historique des ventes : cartes mobiles + tableau desktop */
          sales.length === 0 ? (
            <EmptyState
              title="Aucune vente enregistrée"
              description="Les ventes validées au comptoir POS apparaîtront ici en temps réel."
            />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {sales.map((sale) => (
                  <div
                    key={`m-${sale.id}`}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-bold text-slate-900">{sale.saleNumber}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatDateTimeInTimezone(sale.createdAt)}
                        </p>
                        {sale.client || sale.declaredOperatorName ? (
                          <p className="text-xs text-slate-500">
                            {sale.client ? sale.client.fullName : 'Client comptoir'}
                            {sale.declaredOperatorName ? ` · Op. ${sale.declaredOperatorName}` : ''}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          sale.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {sale.status === 'COMPLETED' ? 'Validée' : 'Annulée'}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center text-xs">
                      <div>
                        <p className="text-[10px] text-slate-500">Total</p>
                        <p className="font-bold text-slate-900">{formatXof(sale.totalXof)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Payé</p>
                        <p className="font-semibold text-emerald-700">
                          {formatXof(sale.paidAmountXof)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Dû / Remb.</p>
                        <p className="font-semibold text-amber-700">
                          {sale.dueAmountXof > 0
                            ? formatXof(sale.dueAmountXof)
                            : sale.refundedAmountXof > 0
                              ? `-${formatXof(sale.refundedAmountXof)}`
                              : '0 F'}
                        </p>
                      </div>
                    </div>

                    {sale.status === 'COMPLETED' ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => openSaleDocument(sale.id, 'SALE_RECEIPT')}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-forest-900 py-2 text-xs font-bold text-white"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Ticket
                        </button>
                        {sale.refundedAmountXof > 0 ? (
                          <button
                            type="button"
                            onClick={() => openSaleDocument(sale.id, 'CREDIT_NOTE')}
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-rose-50 py-2 text-xs font-bold text-rose-700"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Avoir
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setModalErr(null);
                            setReturnTarget(sale);
                            setReturnLineId(sale.lines[0]?.id || '');
                            setReturnQty(1);
                            setReturnReason('');
                          }}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          Retour
                        </button>
                        {sale.paidAmountXof - sale.refundedAmountXof > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setModalErr(null);
                              setRefundTarget(sale);
                              setRefundAmount(
                                Math.max(0, sale.paidAmountXof - sale.refundedAmountXof),
                              );
                              setRefundMethodCode(sale.payments[0]?.paymentMethodCode || 'CASH');
                              setRefundReason('');
                            }}
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-amber-300 bg-amber-50 py-2 text-xs font-bold text-amber-900"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Remb.
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setModalErr(null);
                            setCancelSaleTarget(sale);
                            setCancelReason('');
                          }}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-red-50 py-2 text-xs font-semibold text-red-700"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-500">
                          {sale.cancelReason ? `Motif : ${sale.cancelReason}` : 'Vente annulée'}
                        </p>
                        <button
                          type="button"
                          onClick={() => openSaleDocument(sale.id, 'SALE_RECEIPT')}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700"
                        >
                          Voir ticket ANNULÉ
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
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
                          <p className="font-mono text-xs font-bold text-slate-900">
                            {sale.saleNumber}
                          </p>
                          <p className="text-xs text-slate-500">
                            {sale.lines.length} ligne(s)
                            {sale.client ? ` · ${sale.client.fullName}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <p>{formatDateTimeInTimezone(sale.createdAt)}</p>
                          {sale.declaredOperatorName ? (
                            <p className="text-slate-400">
                              Opérateur : {sale.declaredOperatorName}
                            </p>
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
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                sale.status === 'COMPLETED'
                                  ? sale.refundedAmountXof >= sale.paidAmountXof && sale.paidAmountXof > 0
                                    ? 'bg-amber-50 text-amber-800'
                                    : 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {sale.status === 'COMPLETED'
                                ? sale.refundedAmountXof >= sale.paidAmountXof && sale.paidAmountXof > 0
                                  ? 'Remboursée'
                                  : sale.refundedAmountXof > 0
                                    ? 'Remb. partiel'
                                    : 'Validée'
                                : 'Annulée'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openSaleDocument(sale.id, 'SALE_RECEIPT')}
                              className="inline-flex items-center gap-1 rounded-lg bg-forest-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-forest-800"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Ticket
                            </button>
                            {sale.refundedAmountXof > 0 ? (
                              <button
                                type="button"
                                onClick={() => openSaleDocument(sale.id, 'CREDIT_NOTE')}
                                className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                Avoir
                              </button>
                            ) : null}
                            {sale.status === 'COMPLETED' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModalErr(null);
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
                                {sale.paidAmountXof - sale.refundedAmountXof > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setModalErr(null);
                                      setRefundTarget(sale);
                                      setRefundAmount(
                                        Math.max(0, sale.paidAmountXof - sale.refundedAmountXof),
                                      );
                                      setRefundMethodCode(sale.payments[0]?.paymentMethodCode || 'CASH');
                                      setRefundReason('');
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Rembourser
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModalErr(null);
                                    setCancelSaleTarget(sale);
                                    setCancelReason('');
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Annuler
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}

        {/* Modale Annulation vente */}
        {cancelSaleTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">
                Annuler la vente {cancelSaleTarget.saleNumber}
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                La vente reste dans l’historique avec mention ANNULÉ et réintègre les articles en stock.
              </p>
              {modalErr ? (
                <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {modalErr}
                </div>
              ) : null}
              <textarea
                rows={3}
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Motif d’annulation obligatoire (5+ caractères)…"
                className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm"
              />
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setCancelSaleTarget(null)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 sm:w-auto"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={busy || cancelReason.trim().length < 5}
                  onClick={handleCancelSale}
                  className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
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
            <form
              onSubmit={handleReturnSubmit}
              className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6"
            >
              <h3 className="text-lg font-bold text-slate-900">
                Retour article — {returnTarget.saleNumber}
              </h3>
              {modalErr ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {modalErr}
                </div>
              ) : null}
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 sm:w-auto"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-forest-900 px-4 py-2 text-sm font-semibold text-white sm:w-auto"
                >
                  Enregistrer retour
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Remboursement (avec mode de remboursement + erreur inline + génération Avoir) */}
        {refundTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleRefundSubmit}
              className="max-h-[90dvh] w-full max-w-md space-y-3.5 overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
            >
              <h3 className="text-lg font-extrabold text-slate-900">
                Remboursement & Avoir — {refundTarget.saleNumber}
              </h3>
              <p className="text-xs text-slate-600">
                Maximum remboursable :{' '}
                <strong className="text-slate-900 tabular">
                  {formatXof(refundTarget.paidAmountXof - refundTarget.refundedAmountXof)}
                </strong>
                . Le montant remboursé sera immédiatement déduit du chiffre d’affaires net et un
                avoir numéroté sera généré.
              </p>

              {modalErr ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {modalErr}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Montant à rembourser (XOF) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={refundTarget.paidAmountXof - refundTarget.refundedAmountXof}
                    required
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(Number(e.target.value) || 0)}
                    className="sc-input mt-1 font-bold tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Mode de remboursement *
                  </label>
                  <select
                    value={refundMethodCode}
                    onChange={(e) => setRefundMethodCode(e.target.value)}
                    className="sc-input mt-1"
                  >
                    {paymentMethods.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Motif obligatoire (5+ caractères) *
                </label>
                <textarea
                  rows={2}
                  required
                  minLength={5}
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Ex. Article retourné par le client / erreur facturation…"
                  className="sc-input mt-1"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setRefundTarget(null);
                    setModalErr(null);
                  }}
                  className="sc-btn-ghost w-full sm:w-auto"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy || refundReason.trim().length < 5 || refundAmount <= 0}
                  className="sc-btn-primary w-full sm:w-auto"
                >
                  {busy ? 'Enregistrement…' : 'Confirmer le remboursement'}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Ticket de caisse / Avoir (Lot 3) */}
        {activeDoc && shopId ? (
          <ReceiptModal
            shopId={shopId}
            document={activeDoc}
            onClose={() => setActiveDoc(null)}
            onUpdated={(d) => setActiveDoc(d)}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
