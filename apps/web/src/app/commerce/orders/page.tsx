'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Package,
  Phone,
  QrCode,
  ShieldAlert,
  ShoppingBag,
  Trash2,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import {
  formatDateTimeInTimezone,
  formatXof,
  FULFILLMENT_MODE_LABELS,
  FulfillmentMode,
  ONLINE_ORDER_STATUS_LABELS,
  OnlineOrderStatus,
  PaymentMethodConfig,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { ReceiptModal, SaleDocumentView } from '@/components/commerce/ReceiptModal';
import { ShopQrModal } from '@/components/commerce/ShopQrModal';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface OrderLineRow {
  id: string;
  productName: string;
  sku: string;
  selectedSize?: string | null;
  selectedColor?: string | null;
  orderedQty?: number;
  quantity?: number;
  unitPriceXof: number;
  lineTotalXof: number;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  status: OnlineOrderStatus;
  fulfillmentMode: FulfillmentMode;
  clientName: string;
  clientPhone: string;
  deliveryAddress: string | null;
  deliveryDistrict: string | null;
  deliveryNotes: string | null;
  subtotalXof: number;
  deliveryFeeXof: number;
  totalXof: number;
  outOfHours: boolean;
  cancelOrRejectReason: string | null;
  convertedSaleId: string | null;
  lines: OrderLineRow[];
  createdAt: string;
}

interface BlockedPhoneRow {
  id: string;
  phone: string;
  reason: string | null;
  createdAt: string;
}

export default function OrdersPage() {
  const { activeOperator } = useAuth();
  const { shopId, activeShop, selectShop, isOwner } = useActiveOperationalShop();

  const [tab, setTab] = useState<'orders' | 'blocked'>('orders');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [blocked, setBlocked] = useState<BlockedPhoneRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [qrOpen, setQrOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<SaleDocumentView | null>(null);

  // Modale refus / annulation
  const [reasonTarget, setReasonTarget] = useState<{ order: OrderRow; nextStatus: 'REJECTED' | 'CANCELLED' } | null>(null);
  const [reasonText, setReasonText] = useState('');

  // Modale conversion en vente (Remettre au client)
  const [completeTarget, setCompleteTarget] = useState<OrderRow | null>(null);
  const [payMethod, setPayMethod] = useState('');
  const [payAmount, setPayAmount] = useState(0);
  const [payRef, setPayRef] = useState('');

  // Bloquer téléphone
  const [blockPhone, setBlockPhone] = useState('');
  const [blockReason, setBlockReason] = useState('');

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const [ordRes, blkRes, shopMeta] = await Promise.all([
        apiFetch<OrderRow[]>(`/shops/${shopId}/orders${qs}`, { shopId }),
        apiFetch<BlockedPhoneRow[]>(`/shops/${shopId}/blocked-phones`, { shopId }).catch(() => []),
        apiFetch<{ paymentMethods?: PaymentMethodConfig[] }>(`/shops/${shopId}`, { shopId }).catch(
          () => null,
        ),
      ]);
      setOrders(ordRes);
      setBlocked(blkRes);
      const enabledMethods = (shopMeta?.paymentMethods || []).filter((m) => m.enabled);
      setPaymentMethods(enabledMethods);
      setPayMethod((prev) =>
        prev && enabledMethods.some((m) => m.code === prev) ? prev : enabledMethods[0]?.code || '',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des commandes.');
    } finally {
      setLoading(false);
    }
  }, [shopId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConfirm = async (o: OrderRow) => {
    if (!shopId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiFetch(`/shops/${shopId}/orders/${o.id}/confirm`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
      });
      setMsg(`Commande ${o.orderNumber} confirmée — stock réservé immédiatement !`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Confirmation impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleTransition = async (o: OrderRow, status: OnlineOrderStatus, reason?: string) => {
    if (!shopId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiFetch(`/shops/${shopId}/orders/${o.id}/status`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { status, reason },
      });
      setReasonTarget(null);
      setReasonText('');
      setMsg(`Commande ${o.orderNumber} passée en statut « ${ONLINE_ORDER_STATUS_LABELS[status]} ».`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Changement de statut impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !completeTarget) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await apiFetch<{ sale: { id: string; saleNumber: string; totalXof: number } }>(
        `/shops/${shopId}/orders/${completeTarget.id}/complete`,
        {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: {
            paymentMethodCode: payMethod,
            amountPaidXof: Math.max(0, Math.round(Number(payAmount) || 0)),
            transactionRef: payRef.trim() || undefined,
          },
        },
      );
      setCompleteTarget(null);
      setMsg(
        `Commande convertie en vente ${res.sale.saleNumber} (${formatXof(res.sale.totalXof)}) ! Stock décrémenté et ticket généré.`,
      );
      await load();
      apiFetch<SaleDocumentView[]>(`/shops/${shopId}/documents/by-sale/${res.sale.id}`, { shopId })
        .then((docs) => {
          if (docs[0]) setActiveDoc(docs[0]);
        })
        .catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Conversion en vente impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleBlockPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !blockPhone.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/blocked-phones`, {
        method: 'POST',
        shopId,
        body: { phone: blockPhone.trim(), reason: blockReason.trim() || undefined },
      });
      setBlockPhone('');
      setBlockReason('');
      setMsg('Numéro ajouté à la liste noire anti-abus.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Blocage impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnblock = async (id: string) => {
    if (!shopId) return;
    await apiFetch(`/shops/${shopId}/blocked-phones/${id}`, { method: 'DELETE', shopId });
    await load();
  };

  const badgeColor = (st: OnlineOrderStatus) => {
    if (st === 'NEW') return 'bg-limeglow-400/25 text-forest-950 ring-1 ring-limeglow-500/40';
    if (st === 'CONFIRMED') return 'bg-sky-50 text-sky-800';
    if (st === 'PREPARING' || st === 'READY') return 'bg-indigo-50 text-indigo-800';
    if (st === 'IN_DELIVERY') return 'bg-purple-50 text-purple-800';
    if (st === 'COMPLETED') return 'bg-emerald-50 text-emerald-700';
    return 'bg-rose-50 text-rose-700';
  };

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Commandes Vitrine QR
            </h1>
            <p className="text-sm text-slate-600">
              Confirmez pour réserver le stock immédiatement · Convertissez en vente + ticket lors de la remise.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShopPickerInline shopId={shopId} onChange={selectShop} />
            {activeShop ? (
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                className="sc-btn-lime text-xs"
              >
                <QrCode className="h-4 w-4" />
                QR & Vitrine
              </button>
            ) : null}
          </div>
        </div>

        {/* Onglets & Filtres */}
        <div className="sc-card flex flex-wrap items-center justify-between gap-3 p-3.5">
          <div className="inline-flex rounded-xl bg-porcelain-100 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setTab('orders')}
              className={`rounded-lg px-3 py-1.5 ${
                tab === 'orders' ? 'bg-forest-900 text-white' : 'text-slate-600'
              }`}
            >
              File commandes ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('blocked')}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 ${
                tab === 'blocked' ? 'bg-forest-900 text-white' : 'text-slate-600'
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Anti-abus ({blocked.length})
            </button>
          </div>

          {tab === 'orders' ? (
            <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
              {[
                { key: '', label: 'Toutes' },
                { key: 'NEW', label: 'Nouvelles' },
                { key: 'CONFIRMED', label: 'Confirmées' },
                { key: 'PREPARING', label: 'Préparation' },
                { key: 'READY', label: 'Prêtes' },
                { key: 'IN_DELIVERY', label: 'Livraison' },
                { key: 'COMPLETED', label: 'Terminées' },
              ].map((st) => (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => setStatusFilter(st.key)}
                  className={`rounded-full px-3 py-1 transition ${
                    statusFilter === st.key
                      ? 'bg-forest-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : tab === 'blocked' ? (
          <div className="grid gap-5 lg:grid-cols-12">
            <form onSubmit={handleBlockPhone} className="sc-card space-y-3 p-5 lg:col-span-5">
              <h2 className="text-base font-extrabold text-slate-900">Bloquer un numéro abusif</h2>
              <p className="text-xs text-slate-500">
                Les numéros bloqués ne peuvent plus soumettre de commandes sur la vitrine de cette boutique.
              </p>
              <input
                required
                value={blockPhone}
                onChange={(e) => setBlockPhone(e.target.value)}
                placeholder="+223 70 00 00 00"
                className="sc-input"
              />
              <input
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Motif (fausses commandes, impayés…)"
                className="sc-input"
              />
              <button type="submit" disabled={busy} className="sc-btn-primary w-full text-xs">
                <Ban className="h-4 w-4" />
                Bloquer ce numéro
              </button>
            </form>

            <div className="sc-card p-5 lg:col-span-7">
              <h2 className="text-base font-extrabold text-slate-900">Numéros bloqués</h2>
              {blocked.length === 0 ? (
                <p className="mt-4 text-xs text-slate-400">Aucun numéro sur liste noire.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {blocked.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-200 bg-porcelain-50 px-4 py-3 text-xs"
                    >
                      <div>
                        <p className="font-mono font-bold text-slate-900">{b.phone}</p>
                        <p className="text-slate-500">{b.reason || 'Bloqué manuellement'}</p>
                      </div>
                      {isOwner ? (
                        <button
                          type="button"
                          onClick={() => handleUnblock(b.id)}
                          className="rounded-lg bg-rose-50 p-2 text-rose-700 hover:bg-rose-100"
                          title="Débloquer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            title="Aucune commande vitrine QR"
            description="Partagez le QR Code de votre boutique pour recevoir vos premières commandes clients sans compte."
            action={
              activeShop ? (
                <button type="button" onClick={() => setQrOpen(true)} className="sc-btn-primary text-xs">
                  <QrCode className="h-4 w-4" />
                  Afficher le QR Code boutique
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div key={o.id} className="sc-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-slate-950">
                        {o.orderNumber}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeColor(o.status)}`}>
                        {ONLINE_ORDER_STATUS_LABELS[o.status]}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                        {o.fulfillmentMode === 'DELIVERY' ? (
                          <Truck className="h-3 w-3" />
                        ) : (
                          <ShoppingBag className="h-3 w-3" />
                        )}
                        {FULFILLMENT_MODE_LABELS[o.fulfillmentMode]}
                      </span>
                      {o.outOfHours ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                          Hors horaires
                        </span>
                      ) : null}
                    </div>

                    <p className="text-sm font-bold text-slate-900">
                      {o.clientName} ·{' '}
                      <a href={`tel:${o.clientPhone}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                        <Phone className="h-3.5 w-3.5" />
                        {o.clientPhone}
                      </a>
                    </p>
                    {o.fulfillmentMode === 'DELIVERY' && (o.deliveryAddress || o.deliveryDistrict) ? (
                      <p className="text-xs text-slate-600">
                        Adresse : {[o.deliveryDistrict, o.deliveryAddress].filter(Boolean).join(' — ')}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-slate-400">
                      Reçue le {formatDateTimeInTimezone(o.createdAt)}
                    </p>
                    {o.cancelOrRejectReason ? (
                      <p className="text-xs font-semibold text-rose-700">
                        Motif : {o.cancelOrRejectReason}
                      </p>
                    ) : null}
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-extrabold text-slate-950 tabular">
                      {formatXof(o.totalXof)}
                    </p>
                    {o.deliveryFeeXof > 0 ? (
                      <p className="text-[11px] text-slate-500">
                        dont livraison : {formatXof(o.deliveryFeeXof)}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Articles commandés (avec Taille & Couleur sélectionnées par le client) */}
                <div className="mt-3 divide-y divide-slate-100 rounded-2xl bg-porcelain-50 px-3.5 py-2 text-xs">
                  {o.lines.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-800">
                          {l.orderedQty ?? l.quantity ?? 1} × {l.productName}{' '}
                          <code className="text-slate-400">({l.sku})</code>
                        </span>
                        {l.selectedSize ? (
                          <span className="rounded-md bg-forest-900 px-1.5 py-0.5 text-[10px] font-bold text-limeglow-400">
                            Taille {l.selectedSize}
                          </span>
                        ) : null}
                        {l.selectedColor ? (
                          <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                            {l.selectedColor}
                          </span>
                        ) : null}
                      </div>
                      <span className="font-bold text-slate-900 tabular">
                        {formatXof(l.lineTotalXof)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Actions workflow */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {o.status === 'NEW' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleConfirm(o)}
                        className="sc-btn-primary text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-limeglow-400" />
                        Confirmer & Réserver le stock
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setReasonTarget({ order: o, nextStatus: 'REJECTED' });
                          setReasonText('');
                        }}
                        className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Refuser
                      </button>
                    </>
                  ) : null}

                  {o.status === 'CONFIRMED' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleTransition(o, 'PREPARING')}
                      className="sc-btn-ghost text-xs"
                    >
                      <Package className="h-3.5 w-3.5" />
                      Passer en préparation
                    </button>
                  ) : null}

                  {o.status === 'PREPARING' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleTransition(o, 'READY')}
                      className="sc-btn-ghost text-xs"
                    >
                      Marquer prête
                    </button>
                  ) : null}

                  {(o.status === 'READY' || o.status === 'CONFIRMED') && o.fulfillmentMode === 'DELIVERY' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleTransition(o, 'IN_DELIVERY')}
                      className="sc-btn-ghost text-xs"
                    >
                      <Truck className="h-3.5 w-3.5" />
                      Partir en livraison
                    </button>
                  ) : null}

                  {['CONFIRMED', 'PREPARING', 'READY', 'IN_DELIVERY'].includes(o.status) ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setCompleteTarget(o);
                          setPayMethod('CASH');
                          setPayAmount(o.totalXof);
                          setPayRef('');
                        }}
                        className="sc-btn-lime text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Remettre & Encaisser (Vente + Ticket)
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setReasonTarget({ order: o, nextStatus: 'CANCELLED' });
                          setReasonText('');
                        }}
                        className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                      >
                        Annuler (libère stock)
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modale Conversion Commande -> Vente */}
        {completeTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleComplete}
              className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-slate-900">
                  Encaisser & Clôturer {completeTarget.orderNumber}
                </h3>
                <button
                  type="button"
                  onClick={() => setCompleteTarget(null)}
                  className="rounded-xl p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-xs text-slate-600">
                Total commande : <strong>{formatXof(completeTarget.totalXof)}</strong>. Cette
                action crée la vente définitive, décrémente le stock, enregistre l’encaissement et
                génère le ticket de caisse.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Moyen de paiement</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="sc-input mt-1"
                  >
                    {paymentMethods.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Montant encaissé (XOF)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
                    className="sc-input mt-1 font-bold tabular"
                  />
                </div>
              </div>

              {payMethod !== 'CASH' ? (
                <input
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Référence transaction Mobile Money / Banque"
                  className="sc-input font-mono text-xs"
                />
              ) : null}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setCompleteTarget(null)} className="sc-btn-ghost">
                  Annuler
                </button>
                <button type="submit" disabled={busy} className="sc-btn-primary">
                  Valider la remise & créer la vente
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Motif Refus / Annulation */}
        {reasonTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md space-y-3 rounded-3xl bg-white p-6 shadow-2xl">
              <h3 className="text-lg font-extrabold text-slate-900">
                {reasonTarget.nextStatus === 'REJECTED' ? 'Refuser' : 'Annuler'}{' '}
                {reasonTarget.order.orderNumber}
              </h3>
              <textarea
                rows={3}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Indiquez le motif (ex. article indisponible, client injoignable)…"
                className="sc-input"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReasonTarget(null)} className="sc-btn-ghost">
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={busy || reasonText.trim().length < 4}
                  onClick={() =>
                    handleTransition(reasonTarget.order, reasonTarget.nextStatus, reasonText.trim())
                  }
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {qrOpen && activeShop ? (
        <ShopQrModal slug={activeShop.slug} shopName={activeShop.shopName} onClose={() => setQrOpen(false)} />
      ) : null}

      {activeDoc && shopId ? (
        <ReceiptModal shopId={shopId} document={activeDoc} onClose={() => setActiveDoc(null)} />
      ) : null}
    </AppShell>
  );
}
