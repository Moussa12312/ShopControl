'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  PackageCheck,
  Plus,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import {
  formatDateTimeInTimezone,
  TRANSFER_STATUS_LABELS,
  TransferStatus,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface TransferItemRow {
  id: string;
  productName: string;
  sku: string;
  requestedQty: number;
  dispatchedQty: number;
  receivedQty: number | null;
  discrepancyReason: string | null;
}

interface TransferRow {
  id: string;
  transferNumber: string;
  status: TransferStatus;
  hasDiscrepancy: boolean;
  notes: string | null;
  rejectReason: string | null;
  sourceShop: { id: string; name: string };
  destShop: { id: string; name: string };
  items: TransferItemRow[];
  createdAt: string;
}

interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  stockAvailable: number;
}

export default function TransfersPage() {
  const { user, shops } = useAuth();
  const isOwner = user?.role === 'OWNER';

  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Modale création transfert
  const [createOpen, setCreateOpen] = useState(false);
  const [sourceShopId, setSourceShopId] = useState('');
  const [destShopId, setDestShopId] = useState('');
  const [sourceProducts, setSourceProducts] = useState<ProductOpt[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  // Modale refus (Owner)
  const [rejectTarget, setRejectTarget] = useState<TransferRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Modale réception (avec écarts possibles)
  const [receiveTarget, setReceiveTarget] = useState<TransferRow | null>(null);
  const [receivedMap, setReceivedMap] = useState<Record<string, { qty: number; reason: string }>>({});
  const [receiveNotes, setReceiveNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<TransferRow[]>('/transfers');
      setTransfers(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des transferts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadProductsForShop = async (sId: string) => {
    if (!sId) return;
    try {
      const res = await apiFetch<{ items: ProductOpt[] }>(`/shops/${sId}/products?limit=200`, {
        shopId: sId,
      });
      setSourceProducts(res.items);
      setSelectedProductId(res.items[0]?.id || '');
    } catch {
      setSourceProducts([]);
    }
  };

  const openCreateModal = () => {
    const src = shops[0]?.shopId || '';
    const dst = shops[1]?.shopId || '';
    setSourceShopId(src);
    setDestShopId(dst);
    setQty(1);
    setNotes('');
    setCreateOpen(true);
    if (src) void loadProductsForShop(src);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceShopId || !destShopId || !selectedProductId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const created = await apiFetch<TransferRow>('/transfers', {
        method: 'POST',
        body: {
          sourceShopId,
          destShopId,
          notes: notes.trim() || undefined,
          items: [{ sourceProductId: selectedProductId, requestedQty: Math.max(1, qty) }],
        },
      });
      setCreateOpen(false);
      setMsg(`Demande de transfert ${created.transferNumber} créée (en attente de validation Propriétaire).`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création de transfert impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (t: TransferRow) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/transfers/${t.id}/approve`, { method: 'POST' });
      setMsg(`Transfert ${t.transferNumber} validé — prêt à être expédié.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Validation impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/transfers/${rejectTarget.id}/reject`, {
        method: 'POST',
        body: { reason: rejectReason.trim() },
      });
      setRejectTarget(null);
      setRejectReason('');
      setMsg('Transfert refusé.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Refus impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleDispatch = async (t: TransferRow) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/transfers/${t.id}/dispatch`, { method: 'POST' });
      setMsg(`Transfert ${t.transferNumber} expédié (stock passé EN TRANSIT).`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Expédition impossible.');
    } finally {
      setBusy(false);
    }
  };

  const openReceiveModal = (t: TransferRow) => {
    setReceiveTarget(t);
    setReceiveNotes('');
    const init: Record<string, { qty: number; reason: string }> = {};
    for (const it of t.items) {
      init[it.id] = { qty: it.dispatchedQty, reason: '' };
    }
    setReceivedMap(init);
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveTarget) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<TransferRow>(`/transfers/${receiveTarget.id}/receive`, {
        method: 'POST',
        body: {
          notes: receiveNotes.trim() || undefined,
          items: receiveTarget.items.map((it) => ({
            itemId: it.id,
            receivedQty: Math.max(0, receivedMap[it.id]?.qty ?? it.dispatchedQty),
            discrepancyReason: receivedMap[it.id]?.reason?.trim() || undefined,
          })),
        },
      });
      setReceiveTarget(null);
      setMsg(
        updated.hasDiscrepancy
          ? `Transfert ${updated.transferNumber} réceptionné AVEC ÉCART (alerte urgente envoyée au Propriétaire).`
          : `Transfert ${updated.transferNumber} réceptionné conforme et stock destination crédité !`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Réception impossible.');
    } finally {
      setBusy(false);
    }
  };

  const statusBadgeStyle = (s: TransferStatus) => {
    if (s === 'PENDING_APPROVAL') return 'bg-amber-50 text-amber-800';
    if (s === 'APPROVED') return 'bg-sky-50 text-sky-800';
    if (s === 'IN_TRANSIT') return 'bg-indigo-50 text-indigo-800';
    if (s === 'RECEIVED') return 'bg-emerald-50 text-emerald-700';
    if (s === 'RECEIVED_WITH_DISCREPANCY') return 'bg-orange-100 text-orange-800';
    return 'bg-rose-50 text-rose-700';
  };

  return (
    <AppShell
      allowedRoles={['OWNER', 'AGENT']}
      title="Transferts Inter-Boutiques"
      subtitle="Validation obligatoire du Propriétaire avant expédition · Stock en transit isolé · Traçabilité des écarts."
      headerActions={
        shops.length >= 2 ? (
          <button type="button" onClick={openCreateModal} className="sc-hero-btn-primary">
            <Plus className="h-3.5 w-3.5" />
            Nouveau transfert
          </button>
        ) : null
      }
    >
      <div className="space-y-5">

        {shops.length < 2 && isOwner ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-900">
            Créez au moins 2 boutiques dans <strong>Boutiques & QR</strong> pour transférer du stock
            d’une boutique à une autre.
          </div>
        ) : null}

        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : transfers.length === 0 ? (
          <EmptyState
            title="Aucun transfert enregistré"
            description="Les mouvements de stock entre vos différentes boutiques apparaîtront ici avec leur statut temps réel."
          />
        ) : (
          <div className="space-y-3">
            {transfers.map((t) => (
              <div key={t.id} className="sc-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-slate-900">
                        {t.transferNumber}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusBadgeStyle(t.status)}`}
                      >
                        {TRANSFER_STATUS_LABELS[t.status]}
                      </span>
                      {t.hasDiscrepancy ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                          <AlertTriangle className="h-3 w-3" />
                          Écart signalé
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-800">
                      <span>{t.sourceShop.name}</span>
                      <ArrowRight className="h-4 w-4 text-brand-600" />
                      <span>{t.destShop.name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Créé le {formatDateTimeInTimezone(t.createdAt)}
                      {t.notes ? ` · ${t.notes}` : ''}
                    </p>
                    {t.rejectReason ? (
                      <p className="mt-1 text-xs font-semibold text-rose-700">
                        Motif refus : {t.rejectReason}
                      </p>
                    ) : null}
                  </div>

                  {/* Boutons workflow */}
                  <div className="flex flex-wrap gap-2">
                    {t.status === 'PENDING_APPROVAL' && isOwner ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleApprove(t)}
                          className="sc-btn-primary px-3.5 py-2 text-xs"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-limeglow-400" />
                          Valider
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRejectTarget(t);
                            setRejectReason('');
                          }}
                          className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Refuser
                        </button>
                      </>
                    ) : null}

                    {t.status === 'APPROVED' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDispatch(t)}
                        className="sc-btn-lime px-3.5 py-2 text-xs"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Expédier (En transit)
                      </button>
                    ) : null}

                    {t.status === 'IN_TRANSIT' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openReceiveModal(t)}
                        className="sc-btn-primary px-3.5 py-2 text-xs"
                      >
                        <PackageCheck className="h-3.5 w-3.5 text-limeglow-400" />
                        Réceptionner
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Articles du transfert */}
                <div className="mt-3 divide-y divide-slate-100 rounded-2xl bg-porcelain-50 px-3.5 py-2 text-xs">
                  {t.items.map((it) => (
                    <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <span className="font-bold text-slate-900">{it.productName}</span>{' '}
                        <code className="font-mono text-slate-500">({it.sku})</code>
                        {it.discrepancyReason ? (
                          <p className="text-[11px] font-semibold text-rose-700">
                            Écart : {it.discrepancyReason}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 tabular">
                        <span>
                          Demandé : <strong>{it.requestedQty}</strong>
                        </span>
                        <span>
                          Expédié : <strong>{it.dispatchedQty}</strong>
                        </span>
                        {it.receivedQty !== null ? (
                          <span
                            className={
                              it.receivedQty !== it.dispatchedQty
                                ? 'font-extrabold text-rose-600'
                                : 'font-extrabold text-emerald-700'
                            }
                          >
                            Reçu : {it.receivedQty}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modale Nouveau transfert */}
        {createOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleCreate}
              className="max-h-[92dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-slate-900">
                  Nouvelle demande de transfert
                </h2>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-xl p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Boutique source *</label>
                  <select
                    required
                    value={sourceShopId}
                    onChange={(e) => {
                      setSourceShopId(e.target.value);
                      void loadProductsForShop(e.target.value);
                    }}
                    className="sc-input mt-1"
                  >
                    {shops.map((s) => (
                      <option key={s.shopId} value={s.shopId}>
                        {s.shopName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Boutique destination *
                  </label>
                  <select
                    required
                    value={destShopId}
                    onChange={(e) => setDestShopId(e.target.value)}
                    className="sc-input mt-1"
                  >
                    {shops
                      .filter((s) => s.shopId !== sourceShopId)
                      .map((s) => (
                        <option key={s.shopId} value={s.shopId}>
                          {s.shopName}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">Article *</label>
                  <select
                    required
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="sc-input mt-1"
                  >
                    {sourceProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku}) — Stock : {p.stockAvailable}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Quantité *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value) || 1)}
                    className="sc-input mt-1 tabular"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Note / Motif</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex. Réapprovisionnement fin de semaine"
                  className="sc-input mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="sc-btn-ghost">
                  Annuler
                </button>
                <button type="submit" disabled={busy || !selectedProductId} className="sc-btn-primary">
                  Créer la demande
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Refus */}
        {rejectTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleReject}
              className="w-full max-w-md space-y-3 rounded-3xl bg-white p-6 shadow-2xl"
            >
              <h3 className="text-lg font-extrabold text-slate-900">
                Refuser {rejectTarget.transferNumber}
              </h3>
              <textarea
                required
                minLength={5}
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Motif du refus obligatoire (5+ caractères)…"
                className="sc-input"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRejectTarget(null)} className="sc-btn-ghost">
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy || rejectReason.trim().length < 5}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white"
                >
                  Confirmer le refus
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Réception (gestion écarts) */}
        {receiveTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleReceive}
              className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            >
              <h3 className="text-lg font-extrabold text-slate-900">
                Réceptionner {receiveTarget.transferNumber}
              </h3>
              <p className="text-xs text-slate-600">
                Saisissez les quantités réellement reçues dans <strong>{receiveTarget.destShop.name}</strong>.
                Tout écart déclenchera une alerte urgente au Propriétaire.
              </p>

              <div className="space-y-3">
                {receiveTarget.items.map((it) => {
                  const cur = receivedMap[it.id] || { qty: it.dispatchedQty, reason: '' };
                  const diff = cur.qty !== it.dispatchedQty;
                  return (
                    <div key={it.id} className="rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{it.productName}</p>
                          <p className="text-xs text-slate-500">Expédié : {it.dispatchedQty}</p>
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={cur.qty}
                          onChange={(e) =>
                            setReceivedMap((prev) => ({
                              ...prev,
                              [it.id]: { ...cur, qty: Number(e.target.value) || 0 },
                            }))
                          }
                          className="sc-input w-24 text-center font-bold tabular"
                        />
                      </div>
                      {diff ? (
                        <input
                          required
                          value={cur.reason}
                          onChange={(e) =>
                            setReceivedMap((prev) => ({
                              ...prev,
                              [it.id]: { ...cur, reason: e.target.value },
                            }))
                          }
                          placeholder="Expliquez l’écart constaté (casse, manquant…) *"
                          className="sc-input mt-2 border-amber-300 bg-amber-50/40 text-xs"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <input
                value={receiveNotes}
                onChange={(e) => setReceiveNotes(e.target.value)}
                placeholder="Commentaire de réception (optionnel)"
                className="sc-input"
              />

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReceiveTarget(null)} className="sc-btn-ghost">
                  Annuler
                </button>
                <button type="submit" disabled={busy} className="sc-btn-primary">
                  Valider la réception
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
