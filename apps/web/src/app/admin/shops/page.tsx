'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Database, ExternalLink, Layers, Plus, RefreshCw, X } from 'lucide-react';
import {
  BusinessProfileConfig,
  normalizeBusinessProfile,
  normalizeShopType,
  SHOP_TYPE_DESCRIPTIONS,
  SHOP_TYPE_LABELS,
  SHOP_TYPE_SHORT_LABELS,
  SHOP_TYPES,
  ShopType,
  TenantStatus,
  TENANT_STATUSES,
  TENANT_STATUS_LABELS,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import {
  ConfirmModal,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '@/components/ui/StateViews';

interface AdminShopRow {
  id: string;
  name: string;
  slug: string;
  shopType?: ShopType;
  businessProfile?: BusinessProfileConfig;
  status: TenantStatus;
  dbName: string;
  dbStatus: string;
  dbSchemaVersion: string | null;
  merchant: { id: string; name: string; status: TenantStatus };
  createdAt: string;
}

interface MerchantOption {
  id: string;
  name: string;
}

export default function AdminShopsPage() {
  const [items, setItems] = useState<AdminShopRow[]>([]);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [statusModal, setStatusModal] = useState<{
    shop: AdminShopRow;
    nextStatus: TenantStatus;
    reason: string;
  } | null>(null);

  // Modale Super Admin : Configuration du / des Type(s) de la boutique
  const [typeModal, setTypeModal] = useState<{
    shop: AdminShopRow;
    primaryType: ShopType;
    enabledTypes: ShopType[];
    seedCategories: boolean;
  } | null>(null);

  // Modale Super Admin : Création directe d'une boutique avec son Type
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    merchantId: '',
    name: '',
    slug: '',
    shopType: 'GROCERY' as ShopType,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, mRes] = await Promise.all([
        apiFetch<{ items: AdminShopRow[] }>('/admin/shops'),
        apiFetch<{ items: MerchantOption[] }>('/admin/merchants?limit=100').catch(() => ({
          items: [],
        })),
      ]);
      setItems(res.items);
      setMerchants(mRes.items);
      if (mRes.items[0]) {
        setCreateForm((prev) => ({
          ...prev,
          merchantId: prev.merchantId || mRes.items[0].id,
        }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des boutiques.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTypeModal = (shop: AdminShopRow) => {
    const primary = normalizeShopType(shop.shopType);
    const profile = normalizeBusinessProfile(primary, shop.businessProfile);
    setTypeModal({
      shop,
      primaryType: primary,
      enabledTypes:
        profile.enabledShopTypes && profile.enabledShopTypes.length > 0
          ? profile.enabledShopTypes
          : [primary],
      seedCategories: true,
    });
  };

  const toggleEnabledTypeInModal = (t: ShopType) => {
    if (!typeModal) return;
    const exists = typeModal.enabledTypes.includes(t);
    let nextEnabled = exists
      ? typeModal.enabledTypes.filter((x) => x !== t)
      : [...typeModal.enabledTypes, t];
    if (nextEnabled.length === 0) {
      nextEnabled = [t];
    }
    const nextPrimary = nextEnabled.includes(typeModal.primaryType)
      ? typeModal.primaryType
      : nextEnabled[0];
    setTypeModal({
      ...typeModal,
      primaryType: nextPrimary,
      enabledTypes: nextEnabled,
    });
  };

  const handleSaveTypes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeModal) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await apiFetch<{ seededCategoriesCount?: number }>(
        `/admin/shops/${typeModal.shop.id}/types`,
        {
          method: 'PATCH',
          body: {
            shopType: typeModal.primaryType,
            enabledShopTypes: typeModal.enabledTypes,
            seedCategories: typeModal.seedCategories,
          },
        },
      );
      const shopName = typeModal.shop.name;
      const labels = typeModal.enabledTypes.map((t) => SHOP_TYPE_SHORT_LABELS[t]).join(' + ');
      setTypeModal(null);
      setMsg(
        `Type(s) de la boutique « ${shopName} » mis à jour : ${labels}${
          res.seededCategoriesCount
            ? ` (${res.seededCategoriesCount} nouvelle(s) catégorie(s) ajoutée(s))`
            : ''
        }.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de mettre à jour le type.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.merchantId || !createForm.name.trim()) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await apiFetch('/admin/shops', {
        method: 'POST',
        body: {
          merchantId: createForm.merchantId,
          name: createForm.name.trim(),
          ...(createForm.slug.trim() ? { slug: createForm.slug.trim() } : {}),
          shopType: createForm.shopType,
          enabledShopTypes: [createForm.shopType],
        },
      });
      setCreateOpen(false);
      setCreateForm((prev) => ({ ...prev, name: '', slug: '' }));
      setMsg('Nouvelle boutique créée, base PostgreSQL provisionnée et catégories initialisées.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création de la boutique impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleApplyStatus = async () => {
    if (!statusModal) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/shops/${statusModal.shop.id}/status`, {
        method: 'PATCH',
        body: { status: statusModal.nextStatus, reason: statusModal.reason },
      });
      setStatusModal(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de modifier le statut.');
    } finally {
      setBusy(false);
    }
  };

  const handleRetryProvision = async (shopId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/admin/shops/${shopId}/retry-provision`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du provisionnement BDD.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['SUPER_ADMIN']}
      title="Boutiques, Types Métiers & Bases dédiées"
      subtitle="Définissez le(s) type(s) de chaque boutique (Mode, Boutique de rue, Cosmétique, Quincaillerie…) et gérez leurs bases PostgreSQL dédiées."
      headerActions={
        merchants.length > 0 ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="sc-hero-btn-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouvelle boutique
          </button>
        ) : null
      }
    >
      <div className="space-y-5">
        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Aucune boutique sur la plateforme"
            description="Créez une boutique avec son type métier pour démarrer."
          />
        ) : (
          <>
            {/* Cartes mobile (< md) */}
            <div className="space-y-3 md:hidden">
              {items.map((shop) => {
                const primary = normalizeShopType(shop.shopType);
                const profile = normalizeBusinessProfile(primary, shop.businessProfile);
                const types = profile.enabledShopTypes?.length
                  ? profile.enabledShopTypes
                  : [primary];
                return (
                  <div
                    key={`m-${shop.id}`}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-900">{shop.name}</p>
                        <p className="text-xs text-slate-500">{shop.merchant.name}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {types.map((t) => (
                            <span
                              key={t}
                              className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-extrabold text-brand-800"
                            >
                              {SHOP_TYPE_SHORT_LABELS[t]}
                            </span>
                          ))}
                        </div>
                        <Link
                          href={`/s/${shop.slug}`}
                          target="_blank"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                        >
                          /s/{shop.slug}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                      <StatusBadge status={shop.status} />
                    </div>
                    <div className="mt-3 rounded-xl bg-slate-50 p-2.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Database className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <code className="truncate font-mono text-slate-800">{shop.dbName}</code>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <StatusBadge status={shop.dbStatus} />
                        {shop.dbSchemaVersion ? (
                          <span className="truncate text-[11px] text-slate-400">
                            {shop.dbSchemaVersion}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openTypeModal(shop)}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-forest-900 py-2 text-xs font-bold text-limeglow-400"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        Types & Rayons
                      </button>
                      {shop.dbStatus !== 'READY' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleRetryProvision(shop.id)}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-amber-50 py-2 text-xs font-semibold text-amber-800"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Migrer BDD
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          setStatusModal({
                            shop,
                            nextStatus: shop.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                            reason: '',
                          })
                        }
                        className="flex-1 rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700"
                      >
                        Statut
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tableau desktop (>= md) */}
            <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Boutique</th>
                    <th className="px-4 py-3">Type(s) Métier(s)</th>
                    <th className="px-4 py-3">Marchand</th>
                    <th className="px-4 py-3">Base PostgreSQL dédiée</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((shop) => {
                    const primary = normalizeShopType(shop.shopType);
                    const profile = normalizeBusinessProfile(primary, shop.businessProfile);
                    const types = profile.enabledShopTypes?.length
                      ? profile.enabledShopTypes
                      : [primary];
                    return (
                      <tr key={shop.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{shop.name}</p>
                          <Link
                            href={`/s/${shop.slug}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                          >
                            /s/{shop.slug}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {types.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-extrabold text-brand-800"
                              >
                                {SHOP_TYPE_SHORT_LABELS[t]}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{shop.merchant.name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 text-slate-400" />
                            <code className="text-xs font-mono text-slate-800">{shop.dbName}</code>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <StatusBadge status={shop.dbStatus} />
                            {shop.dbSchemaVersion ? (
                              <span className="text-[11px] text-slate-400">
                                {shop.dbSchemaVersion}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={shop.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openTypeModal(shop)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-forest-900 px-3 py-1.5 text-xs font-bold text-limeglow-400 hover:bg-forest-800"
                            >
                              <Layers className="h-3.5 w-3.5" />
                              Types & Rayons
                            </button>
                            {shop.dbStatus !== 'READY' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRetryProvision(shop.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Migrer BDD
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                setStatusModal({
                                  shop,
                                  nextStatus: shop.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                                  reason: '',
                                })
                              }
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              Statut
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Modale Super Admin : Définir ou Ajouter un Type de Boutique */}
        {typeModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleSaveTypes}
              className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    Type(s) & Rayons de « {typeModal.shop.name} »
                  </h2>
                  <p className="text-xs text-slate-500">
                    Cochez un ou plusieurs types métiers (ex. Cosmétique + Mode & Vêtements si le propriétaire a demandé l’ajout d’un rayon).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTypeModal(null)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {SHOP_TYPES.map((st) => {
                  const checked = typeModal.enabledTypes.includes(st);
                  const isPrimary = typeModal.primaryType === st;
                  return (
                    <div
                      key={st}
                      onClick={() => toggleEnabledTypeInModal(st)}
                      className={`cursor-pointer rounded-2xl border p-3 transition ${
                        checked
                          ? 'border-forest-900 bg-forest-900 text-white shadow-sm'
                          : 'border-slate-200 bg-porcelain-50 text-slate-800 hover:border-brand-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold">{SHOP_TYPE_LABELS[st]}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => undefined}
                          className="h-4 w-4 accent-limeglow-400"
                        />
                      </div>
                      <p
                        className={`mt-1 text-[10px] leading-snug ${
                          checked ? 'text-emerald-100/85' : 'text-slate-500'
                        }`}
                      >
                        {SHOP_TYPE_DESCRIPTIONS[st]}
                      </p>
                      {checked && typeModal.enabledTypes.length > 1 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTypeModal({ ...typeModal, primaryType: st });
                          }}
                          className={`mt-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            isPrimary
                              ? 'bg-limeglow-400 text-forest-950'
                              : 'bg-white/15 text-white hover:bg-white/25'
                          }`}
                        >
                          {isPrimary ? '★ Type principal vitrine' : 'Définir principal'}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-porcelain-50 p-3 text-xs font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={typeModal.seedCategories}
                  onChange={(e) =>
                    setTypeModal({ ...typeModal, seedCategories: e.target.checked })
                  }
                  className="h-4 w-4 accent-brand-700"
                />
                <span>
                  Créer automatiquement les catégories de base du / des type(s) coché(s) dans cette boutique
                </span>
              </label>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setTypeModal(null)}
                  className="sc-btn-ghost w-full sm:w-auto"
                >
                  Annuler
                </button>
                <button type="submit" disabled={busy} className="sc-btn-primary w-full sm:w-auto">
                  {busy ? 'Enregistrement…' : 'Activer ce(s) type(s) sur la boutique'}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Super Admin : Créer une boutique pour un marchand */}
        {createOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleCreateShop}
              className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-lg font-extrabold text-slate-900">
                  Créer une boutique & sélectionner son type
                </h2>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Marchand *</label>
                <select
                  required
                  value={createForm.merchantId}
                  onChange={(e) => setCreateForm({ ...createForm, merchantId: e.target.value })}
                  className="sc-input mt-1"
                >
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Nom de la boutique *
                  </label>
                  <input
                    required
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="Ex. Boutique Cosmétique Bamako"
                    className="sc-input mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Identifiant URL (slug optionnel)
                  </label>
                  <input
                    value={createForm.slug}
                    onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                    placeholder="auto-généré si vide"
                    className="sc-input mt-1 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800">
                  Type de la boutique *
                </label>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {SHOP_TYPES.map((st) => {
                    const active = createForm.shopType === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setCreateForm({ ...createForm, shopType: st })}
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

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="sc-btn-ghost w-full sm:w-auto"
                >
                  Annuler
                </button>
                <button type="submit" disabled={busy} className="sc-btn-primary w-full sm:w-auto">
                  {busy ? 'Provisionnement…' : 'Créer la boutique & sa BDD'}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        <ConfirmModal
          open={Boolean(statusModal)}
          title={`Statut de la boutique ${statusModal?.shop.name || ''}`}
          description="Une boutique suspendue passe en lecture seule et sa vitrine affiche « Boutique momentanément indisponible ». Ses données sont préservées."
          confirmLabel="Enregistrer"
          danger={statusModal?.nextStatus === 'SUSPENDED'}
          busy={busy}
          onCancel={() => setStatusModal(null)}
          onConfirm={handleApplyStatus}
        >
          {statusModal ? (
            <div className="space-y-3">
              <select
                value={statusModal.nextStatus}
                onChange={(e) =>
                  setStatusModal({ ...statusModal, nextStatus: e.target.value as TenantStatus })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {TENANT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TENANT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <textarea
                rows={2}
                required
                value={statusModal.reason}
                onChange={(e) => setStatusModal({ ...statusModal, reason: e.target.value })}
                placeholder="Motif obligatoire…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          ) : null}
        </ConfirmModal>
      </div>
    </AppShell>
  );
}
