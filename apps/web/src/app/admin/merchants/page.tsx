'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, ShieldAlert, UserCheck } from 'lucide-react';
import {
  SHOP_TYPE_DESCRIPTIONS,
  SHOP_TYPE_LABELS,
  SHOP_TYPES,
  ShopType,
  TenantStatus,
  TENANT_STATUSES,
  TENANT_STATUS_LABELS,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  ConfirmModal,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '@/components/ui/StateViews';

interface MerchantRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: TenantStatus;
  statusReason: string | null;
  currency: string;
  shopsCount: number;
  usersCount: number;
  owner: { id: string; fullName: string; email: string } | null;
  createdAt: string;
}

export default function AdminMerchantsPage() {
  const router = useRouter();
  const { setSupportGrantId, refreshMe } = useAuth();

  const [items, setItems] = useState<MerchantRow[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    merchantName: '',
    phone: '+223',
    email: '',
    ownerFullName: '',
    ownerEmail: '',
    ownerPassword: '',
    initialShopName: '',
    initialShopType: 'GROCERY' as ShopType,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [statusModal, setStatusModal] = useState<{
    merchant: MerchantRow;
    nextStatus: TenantStatus;
    reason: string;
  } | null>(null);

  const [supportModal, setSupportModal] = useState<{
    merchant: MerchantRow;
    reason: string;
    durationMinutes: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (statusFilter) qs.set('status', statusFilter);
      const res = await apiFetch<{ items: MerchantRow[] }>(`/admin/merchants?${qs.toString()}`);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des marchands.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await apiFetch('/admin/merchants', {
        method: 'POST',
        body: {
          ...form,
          initialShopName: form.initialShopName.trim() || undefined,
          initialShopType: form.initialShopName.trim() ? form.initialShopType : undefined,
        },
      });
      setShowCreate(false);
      setForm({
        merchantName: '',
        phone: '+223',
        email: '',
        ownerFullName: '',
        ownerEmail: '',
        ownerPassword: '',
        initialShopName: '',
        initialShopType: 'GROCERY',
      });
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!statusModal) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/merchants/${statusModal.merchant.id}/status`, {
        method: 'PATCH',
        body: { status: statusModal.nextStatus, reason: statusModal.reason },
      });
      setStatusModal(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de mise à jour du statut.');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenSupport = async () => {
    if (!supportModal) return;
    setBusy(true);
    try {
      const grant = await apiFetch<{ id: string }>('/admin/support-access', {
        method: 'POST',
        body: {
          merchantId: supportModal.merchant.id,
          reason: supportModal.reason,
          durationMinutes: supportModal.durationMinutes,
          readOnly: true,
        },
      });
      setSupportGrantId(grant.id);
      await refreshMe();
      setSupportModal(null);
      router.push('/owner');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’ouvrir le mandat support.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['SUPER_ADMIN']}
      title="Marchands"
      subtitle="Créez des entreprises marchandes, gérez leur statut ou ouvrez un accès support borné."
      headerActions={
        <button type="button" onClick={() => setShowCreate(true)} className="sc-hero-btn-primary">
          <Plus className="h-3.5 w-3.5" />
          Nouveau marchand
        </button>
      }
    >
      <div className="space-y-5">

        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-3">
          <div className="relative flex-1 sm:min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, e-mail ou téléphone…"
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filtrer par statut"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm sm:w-auto"
          >
            <option value="">Tous les statuts</option>
            {TENANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TENANT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Aucun marchand enregistré"
            description="Créez votre premier compte marchand avec son propriétaire et sa première boutique."
          />
        ) : (
          <>
            {/* Cartes mobile (< md) */}
            <div className="space-y-3 md:hidden">
              {items.map((m) => (
                <div
                  key={`m-${m.id}`}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{m.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {m.email} · {m.phone}
                      </p>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="truncate">
                      Proprio : <strong>{m.owner ? m.owner.fullName : '—'}</strong>
                    </span>
                    <span className="shrink-0 font-semibold text-slate-800">
                      {m.shopsCount} boutique(s)
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setStatusModal({
                          merchant: m,
                          nextStatus: m.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                          reason: '',
                        })
                      }
                      className="rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700"
                    >
                      Changer statut
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSupportModal({ merchant: m, reason: '', durationMinutes: 30 })
                      }
                      className="inline-flex items-center justify-center gap-1 rounded-xl bg-indigo-50 py-2 text-xs font-semibold text-indigo-700"
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      Assistance (RO)
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Tableau desktop (>= md) */}
            <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Entreprise</th>
                    <th className="px-4 py-3">Propriétaire</th>
                    <th className="px-4 py-3">Boutiques</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{m.name}</p>
                        <p className="text-xs text-slate-500">
                          {m.email} · {m.phone}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {m.owner ? (
                          <>
                            <p className="font-medium text-slate-800">{m.owner.fullName}</p>
                            <p className="text-xs text-slate-500">{m.owner.email}</p>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{m.shopsCount}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setStatusModal({
                                merchant: m,
                                nextStatus: m.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                                reason: '',
                              })
                            }
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Changer statut
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSupportModal({ merchant: m, reason: '', durationMinutes: 30 })
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            Assistance (RO)
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Modale création marchand */}
        {showCreate ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="text-lg font-bold text-slate-900">Créer un marchand</h2>
              <p className="mt-1 text-xs text-slate-500">
                Si une 1re boutique est renseignée, sa base PostgreSQL dédiée sera provisionnée immédiatement.
              </p>

              {formError ? (
                <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">{formError}</div>
              ) : null}

              <form onSubmit={handleCreateMerchant} className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Nom entreprise *</label>
                    <input
                      required
                      value={form.merchantName}
                      onChange={(e) => setForm({ ...form, merchantName: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Téléphone *</label>
                    <input
                      required
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">E-mail entreprise *</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <hr className="my-2" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Nom propriétaire *</label>
                    <input
                      required
                      value={form.ownerFullName}
                      onChange={(e) => setForm({ ...form, ownerFullName: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">E-mail propriétaire *</label>
                    <input
                      type="email"
                      required
                      value={form.ownerEmail}
                      onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Mot de passe initial propriétaire (8+ car., majuscule, minuscule, chiffre) *
                  </label>
                  <input
                    type="password"
                    required
                    value={form.ownerPassword}
                    onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Nom de la 1re boutique (optionnel — crée automatiquement sa BDD dédiée)
                  </label>
                  <input
                    value={form.initialShopName}
                    onChange={(e) => setForm({ ...form, initialShopName: e.target.value })}
                    placeholder="ex. Boutique Bamako Centre"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Type de la boutique (définit ses catégories et son mode de vente) *
                  </label>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {SHOP_TYPES.map((st) => {
                      const active = form.initialShopType === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setForm({ ...form, initialShopType: st })}
                          className={`rounded-xl border p-2.5 text-left transition ${
                            active
                              ? 'border-forest-900 bg-forest-900 text-white shadow-xs'
                              : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-brand-400'
                          }`}
                        >
                          <p className="text-xs font-extrabold">{SHOP_TYPE_LABELS[st]}</p>
                          <p
                            className={`mt-0.5 line-clamp-2 text-[10px] leading-snug ${
                              active ? 'text-emerald-100/85' : 'text-slate-500'
                            }`}
                          >
                            {SHOP_TYPE_DESCRIPTIONS[st]}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    {busy ? 'Provisionnement…' : 'Créer le marchand'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {/* Modale changement de statut */}
        <ConfirmModal
          open={Boolean(statusModal)}
          title={`Statut de ${statusModal?.merchant.name || ''}`}
          description="Ce changement est journalisé et notifié au propriétaire. Aucune donnée n’est supprimée."
          confirmLabel="Appliquer le statut"
          danger={statusModal?.nextStatus === 'SUSPENDED' || statusModal?.nextStatus === 'TERMINATED'}
          busy={busy}
          onCancel={() => setStatusModal(null)}
          onConfirm={handleUpdateStatus}
        >
          {statusModal ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nouveau statut</label>
                <select
                  value={statusModal.nextStatus}
                  onChange={(e) =>
                    setStatusModal({ ...statusModal, nextStatus: e.target.value as TenantStatus })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {TENANT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {TENANT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Motif obligatoire *</label>
                <textarea
                  rows={2}
                  required
                  value={statusModal.reason}
                  onChange={(e) => setStatusModal({ ...statusModal, reason: e.target.value })}
                  placeholder="Expliquez la raison de ce changement…"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          ) : null}
        </ConfirmModal>

        {/* Modale accès support exceptionnel */}
        <ConfirmModal
          open={Boolean(supportModal)}
          title={`Accès d’assistance : ${supportModal?.merchant.name || ''}`}
          description="L’accès est limité à 2 heures maximum, en lecture seule, inscrit au journal d’audit et notifié immédiatement au propriétaire."
          confirmLabel="Ouvrir l’accès lecture seule"
          busy={busy}
          onCancel={() => setSupportModal(null)}
          onConfirm={handleOpenSupport}
        >
          {supportModal ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                Le propriétaire recevra une alerte immédiate avec votre nom et votre motif.
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Durée (15 à 120 minutes)
                </label>
                <input
                  type="number"
                  min={15}
                  max={120}
                  value={supportModal.durationMinutes}
                  onChange={(e) =>
                    setSupportModal({ ...supportModal, durationMinutes: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Motif détaillé (10+ caractères) *
                </label>
                <textarea
                  rows={2}
                  required
                  value={supportModal.reason}
                  onChange={(e) => setSupportModal({ ...supportModal, reason: e.target.value })}
                  placeholder="ex. Ticket #104 — Diagnostic de paramétrage demandé par le propriétaire"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          ) : null}
        </ConfirmModal>
      </div>
    </AppShell>
  );
}
