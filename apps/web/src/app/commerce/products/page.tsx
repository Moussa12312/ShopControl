'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Search, Tag } from 'lucide-react';
import {
  formatXof,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  ProductStatus,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface CategoryRow {
  id: string;
  name: string;
  productsCount: number;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  salePriceXof: number;
  costPriceXof: number | null;
  hasCostPrice: boolean;
  alertThreshold: number;
  status: ProductStatus;
  stockPhysical: number;
  stockAvailable: number;
}

export default function ProductsPage() {
  const { shopId, activeShop, selectShop, isOwner } = useActiveOperationalShop();
  const canWrite = isOwner || Boolean(activeShop?.permissions['products:create']);
  const canReadCost = isOwner || Boolean(activeShop?.permissions['finance:read_margins']);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCatName, setNewCatName] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    categoryId: '',
    unit: 'unité',
    salePriceXof: 0,
    costPriceXof: '',
    alertThreshold: 5,
    status: 'PUBLISHED' as ProductStatus,
    initialStockQty: 0,
  });

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (search.trim()) qs.set('search', search.trim());
      if (catFilter) qs.set('categoryId', catFilter);
      const [cats, prods] = await Promise.all([
        apiFetch<CategoryRow[]>(`/shops/${shopId}/categories`, { shopId }),
        apiFetch<{ items: ProductRow[] }>(`/shops/${shopId}/products?${qs.toString()}`, { shopId }),
      ]);
      setCategories(cats);
      setProducts(prods.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement du catalogue.');
    } finally {
      setLoading(false);
    }
  }, [shopId, search, catFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !newCatName.trim()) return;
    try {
      await apiFetch(`/shops/${shopId}/categories`, {
        method: 'POST',
        shopId,
        body: { name: newCatName.trim() },
      });
      setNewCatName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de créer la catégorie.');
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormErr(null);
    setForm({
      name: '',
      sku: '',
      barcode: '',
      categoryId: '',
      unit: 'unité',
      salePriceXof: 0,
      costPriceXof: '',
      alertThreshold: 5,
      status: 'PUBLISHED',
      initialStockQty: 0,
    });
    setModalOpen(true);
  };

  const openEdit = (p: ProductRow) => {
    setEditing(p);
    setFormErr(null);
    setForm({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode || '',
      categoryId: p.categoryId || '',
      unit: p.unit,
      salePriceXof: p.salePriceXof,
      costPriceXof: p.costPriceXof !== null ? String(p.costPriceXof) : '',
      alertThreshold: p.alertThreshold,
      status: p.status,
      initialStockQty: 0,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setFormErr(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode.trim() || undefined,
        categoryId: form.categoryId || null,
        unit: form.unit,
        salePriceXof: Math.round(Number(form.salePriceXof) || 0),
        costPriceXof: form.costPriceXof.trim() === '' ? null : Math.round(Number(form.costPriceXof)),
        alertThreshold: Math.round(Number(form.alertThreshold) || 0),
        status: form.status,
        ...(!editing && form.initialStockQty > 0 ? { initialStockQty: form.initialStockQty } : {}),
      };

      if (editing) {
        await apiFetch(`/shops/${shopId}/products/${editing.id}`, {
          method: 'PATCH',
          shopId,
          body: payload,
        });
      } else {
        await apiFetch(`/shops/${shopId}/products`, {
          method: 'POST',
          shopId,
          body: payload,
        });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormErr(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Produits & Catégories</h1>
            <p className="text-sm text-slate-600">
              Catalogue isolé dans la base dédiée de la boutique. Le stock évolue uniquement via
              mouvements tracés.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShopPickerInline shopId={shopId} onChange={selectShop} />
            {canWrite && shopId ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
              >
                <Plus className="h-4 w-4" />
                Nouveau produit
              </button>
            ) : null}
          </div>
        </div>

        {/* Catégories */}
        {shopId ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4">
            <Tag className="h-4 w-4 shrink-0 text-brand-700" />
            <button
              type="button"
              onClick={() => setCatFilter('')}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                catFilter === '' ? 'bg-forest-900 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              Toutes
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCatFilter(c.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  catFilter === c.id ? 'bg-forest-900 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {c.name} ({c.productsCount})
              </button>
            ))}
            {canWrite ? (
              <form
                onSubmit={handleCreateCategory}
                className="flex w-full gap-1.5 pt-1 sm:ml-auto sm:w-auto sm:pt-0"
              >
                <input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Nouvelle catégorie…"
                  className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs sm:w-44 sm:flex-none sm:py-1"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-forest-900 px-3 py-1.5 text-xs font-semibold text-white sm:py-1"
                >
                  +
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, SKU ou code-barres…"
            className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : products.length === 0 ? (
          <EmptyState
            title="Catalogue vide"
            description="Créez votre premier produit ou importez votre catalogue existant en CSV."
          />
        ) : (
          <>
            {/* Cartes mobile (< md) */}
            <div className="space-y-3 md:hidden">
              {products.map((p) => (
                <div
                  key={`m-${p.id}`}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{p.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        <code className="font-mono">{p.sku}</code>
                        {p.categoryName ? ` · ${p.categoryName}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                      {PRODUCT_STATUS_LABELS[p.status]}
                    </span>
                  </div>

                  <div
                    className={`mt-3 grid gap-2 rounded-xl bg-slate-50 p-2.5 text-center text-xs ${
                      canReadCost ? 'grid-cols-3' : 'grid-cols-2'
                    }`}
                  >
                    <div>
                      <p className="text-[10px] text-slate-500">Prix vente</p>
                      <p className="font-bold text-slate-900">{formatXof(p.salePriceXof)}</p>
                    </div>
                    {canReadCost ? (
                      <div>
                        <p className="text-[10px] text-slate-500">Coût CMP</p>
                        <p className="font-semibold text-slate-700">
                          {p.costPriceXof !== null ? formatXof(p.costPriceXof) : 'Estimé'}
                        </p>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-[10px] text-slate-500">Stock (seuil {p.alertThreshold})</p>
                      <p
                        className={`font-bold ${
                          p.stockAvailable <= 0
                            ? 'text-red-600'
                            : p.stockAvailable <= p.alertThreshold
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                        }`}
                      >
                        {p.stockAvailable} {p.unit}
                      </p>
                    </div>
                  </div>

                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Modifier le produit
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Tableau desktop (>= md) */}
            <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Produit</th>
                    <th className="px-4 py-3">Prix vente</th>
                    {canReadCost ? <th className="px-4 py-3">Coût (CMP)</th> : null}
                    <th className="px-4 py-3">Stock dispo</th>
                    <th className="px-4 py-3">Statut</th>
                    {canWrite ? <th className="px-4 py-3 text-right">Action</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500">
                          SKU : <code className="font-mono">{p.sku}</code>
                          {p.categoryName ? ` · ${p.categoryName}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {formatXof(p.salePriceXof)}
                      </td>
                      {canReadCost ? (
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {p.costPriceXof !== null ? (
                            formatXof(p.costPriceXof)
                          ) : (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                              Non renseigné (estimé)
                            </span>
                          )}
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <span
                          className={`font-bold ${
                            p.stockAvailable <= 0
                              ? 'text-red-600'
                              : p.stockAvailable <= p.alertThreshold
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {p.stockAvailable} {p.unit}
                        </span>
                        <span className="ml-1 text-[11px] text-slate-400">
                          (seuil {p.alertThreshold})
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          {PRODUCT_STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Modifier
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {modalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form
              onSubmit={handleSave}
              className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            >
              <h2 className="text-lg font-bold text-slate-900">
                {editing ? `Modifier ${editing.name}` : 'Créer un produit'}
              </h2>
              {formErr ? (
                <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{formErr}</div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Nom *</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">SKU / Référence *</label>
                  <input
                    required
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Catégorie</label>
                  <select
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Sans catégorie</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Code-barres</label>
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Prix vente (XOF) *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={form.salePriceXof}
                    onChange={(e) => setForm({ ...form, salePriceXof: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Coût achat (XOF)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.costPriceXof}
                    onChange={(e) => setForm({ ...form, costPriceXof: e.target.value })}
                    placeholder="Optionnel"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Seuil alerte</label>
                  <input
                    type="number"
                    min={0}
                    value={form.alertThreshold}
                    onChange={(e) => setForm({ ...form, alertThreshold: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Unité</label>
                  <input
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Statut vitrine</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ProductStatus })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {PRODUCT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PRODUCT_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                {!editing ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Stock initial</label>
                    <input
                      type="number"
                      min={0}
                      value={form.initialStockQty}
                      onChange={(e) =>
                        setForm({ ...form, initialStockQty: Number(e.target.value) || 0 })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  {busy ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
