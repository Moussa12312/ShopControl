'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Package, Palette, Pencil, Plus, Ruler, Search, Tag, X } from 'lucide-react';
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
import { MultiImageUploader } from '@/components/ui/ImageUploader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

const PRESET_CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Taille unique'];
const PRESET_SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];

const PRESET_COLORS: Array<{ name: string; hex: string }> = [
  { name: 'Noir', hex: '#111827' },
  { name: 'Blanc', hex: '#ffffff' },
  { name: 'Bleu marine', hex: '#1e3a8a' },
  { name: 'Bleu ciel', hex: '#38bdf8' },
  { name: 'Rouge', hex: '#dc2626' },
  { name: 'Vert', hex: '#16a34a' },
  { name: 'Beige', hex: '#e5d3b3' },
  { name: 'Marron', hex: '#78350f' },
  { name: 'Gris', hex: '#6b7280' },
  { name: 'Jaune', hex: '#eab308' },
  { name: 'Rose', hex: '#ec4899' },
  { name: 'Doré', hex: '#ca8a04' },
  { name: 'Kaki', hex: '#4d7c0f' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Violet', hex: '#7c3aed' },
];

function getColorHex(name: string): string {
  const found = PRESET_COLORS.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return found ? found.hex : '#0f766e';
}

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
  description?: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  salePriceXof: number;
  costPriceXof: number | null;
  hasCostPrice: boolean;
  alertThreshold: number;
  status: ProductStatus;
  imageUrls?: string[];
  availableSizes?: string[];
  availableColors?: string[];
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
  const [customSize, setCustomSize] = useState('');
  const [customColor, setCustomColor] = useState('');
  const [showShoeSizes, setShowShoeSizes] = useState(false);

  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    description: '',
    categoryId: '',
    unit: 'unité',
    salePriceXof: 0,
    costPriceXof: '',
    alertThreshold: 5,
    status: 'PUBLISHED' as ProductStatus,
    initialStockQty: 0,
    imageUrls: [] as string[],
    availableSizes: [] as string[],
    availableColors: [] as string[],
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
    setCustomSize('');
    setCustomColor('');
    setForm({
      name: '',
      sku: '',
      barcode: '',
      description: '',
      categoryId: '',
      unit: 'unité',
      salePriceXof: 0,
      costPriceXof: '',
      alertThreshold: 5,
      status: 'PUBLISHED',
      initialStockQty: 0,
      imageUrls: [],
      availableSizes: [],
      availableColors: [],
    });
    setModalOpen(true);
  };

  const openEdit = (p: ProductRow) => {
    setEditing(p);
    setFormErr(null);
    setCustomSize('');
    setCustomColor('');
    setForm({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode || '',
      description: p.description || '',
      categoryId: p.categoryId || '',
      unit: p.unit,
      salePriceXof: p.salePriceXof,
      costPriceXof: p.costPriceXof !== null ? String(p.costPriceXof) : '',
      alertThreshold: p.alertThreshold,
      status: p.status,
      initialStockQty: 0,
      imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
      availableSizes: Array.isArray(p.availableSizes) ? p.availableSizes : [],
      availableColors: Array.isArray(p.availableColors) ? p.availableColors : [],
    });
    setModalOpen(true);
  };

  const toggleSize = (size: string) => {
    setForm((f) => ({
      ...f,
      availableSizes: f.availableSizes.includes(size)
        ? f.availableSizes.filter((s) => s !== size)
        : [...f.availableSizes, size],
    }));
  };

  const addCustomSize = () => {
    const clean = customSize.trim();
    if (!clean) return;
    if (!form.availableSizes.includes(clean)) {
      setForm((f) => ({ ...f, availableSizes: [...f.availableSizes, clean] }));
    }
    setCustomSize('');
  };

  const toggleColor = (color: string) => {
    setForm((f) => ({
      ...f,
      availableColors: f.availableColors.includes(color)
        ? f.availableColors.filter((c) => c !== color)
        : [...f.availableColors, color],
    }));
  };

  const addCustomColor = () => {
    const clean = customColor.trim();
    if (!clean) return;
    if (!form.availableColors.includes(clean)) {
      setForm((f) => ({ ...f, availableColors: [...f.availableColors, clean] }));
    }
    setCustomColor('');
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
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || null,
        unit: form.unit,
        salePriceXof: Math.round(Number(form.salePriceXof) || 0),
        costPriceXof: form.costPriceXof.trim() === '' ? null : Math.round(Number(form.costPriceXof)),
        alertThreshold: Math.round(Number(form.alertThreshold) || 0),
        status: form.status,
        imageUrls: form.imageUrls,
        availableSizes: form.availableSizes,
        availableColors: form.availableColors,
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
    <AppShell
      allowedRoles={['OWNER', 'AGENT']}
      title="Produits & Catégories"
      subtitle="Photos, descriptions, tailles et couleurs disponibles — synchronisés en direct avec le POS et la vitrine QR."
      headerActions={
        <>
          <ShopPickerInline shopId={shopId} onChange={selectShop} />
          {canWrite && shopId ? (
            <button type="button" onClick={openCreate} className="sc-hero-btn-primary">
              <Plus className="h-3.5 w-3.5" />
              Nouveau produit
            </button>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">

        {/* Catégories */}
        {shopId ? (
          <div className="sc-card flex flex-wrap items-center gap-2 p-3.5 sm:p-4">
            <Tag className="h-4 w-4 shrink-0 text-brand-700" />
            <button
              type="button"
              onClick={() => setCatFilter('')}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                catFilter === '' ? 'bg-forest-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Toutes ({products.length})
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCatFilter(c.id)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  catFilter === c.id ? 'bg-forest-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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
                  className="flex-1 rounded-xl border border-slate-200 bg-porcelain-50 px-3 py-1.5 text-xs sm:w-44 sm:flex-none"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-forest-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-forest-800"
                >
                  +
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, SKU ou code-barres…"
            className="sc-input pl-10"
          />
        </div>

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : products.length === 0 ? (
          <EmptyState
            title="Catalogue vide"
            description="Créez votre premier produit avec sa photo, sa description, ses tailles et couleurs."
            action={
              canWrite ? (
                <button type="button" onClick={openCreate} className="sc-btn-primary">
                  <Plus className="h-4 w-4" />
                  Ajouter mon premier produit
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Cartes mobile (< md) */}
            <div className="space-y-3 md:hidden">
              {products.map((p) => {
                const thumb = p.imageUrls?.[0];
                const sizes = p.availableSizes || [];
                const colors = p.availableColors || [];
                return (
                  <div key={`m-${p.id}`} className="sc-card p-4">
                    <div className="flex items-start gap-3">
                      {thumb ? (
                        <div className="relative h-14 w-14 shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumb}
                            alt={p.name}
                            className="h-14 w-14 rounded-xl border border-slate-200 bg-white object-cover"
                          />
                          {(p.imageUrls?.length || 0) > 1 ? (
                            <span className="absolute -bottom-1 -right-1 rounded-md bg-forest-900 px-1 py-0.5 text-[9px] font-bold text-limeglow-400 shadow-xs">
                              +{(p.imageUrls?.length || 1) - 1}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                          <Package className="h-6 w-6" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-slate-900">{p.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          <code className="font-mono">{p.sku}</code>
                          {p.categoryName ? ` · ${p.categoryName}` : ''}
                        </p>
                        {(sizes.length > 0 || colors.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {sizes.slice(0, 4).map((s) => (
                              <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                {s}
                              </span>
                            ))}
                            {colors.slice(0, 4).map((c) => (
                              <span
                                key={c}
                                title={c}
                                className="h-3.5 w-3.5 rounded-full border border-slate-300"
                                style={{ backgroundColor: getColorHex(c) }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className={`mt-3 grid gap-2 rounded-xl bg-porcelain-50 p-2.5 text-center text-xs ${
                        canReadCost ? 'grid-cols-3' : 'grid-cols-2'
                      }`}
                    >
                      <div>
                        <p className="text-[10px] text-slate-500">Prix vente</p>
                        <p className="font-extrabold text-slate-900 tabular">{formatXof(p.salePriceXof)}</p>
                      </div>
                      {canReadCost ? (
                        <div>
                          <p className="text-[10px] text-slate-500">Coût CMP</p>
                          <p className="font-semibold text-slate-700 tabular">
                            {p.costPriceXof !== null ? formatXof(p.costPriceXof) : 'Estimé'}
                          </p>
                        </div>
                      ) : null}
                      <div>
                        <p className="text-[10px] text-slate-500">Stock</p>
                        <p
                          className={`font-extrabold tabular ${
                            p.stockAvailable <= 0
                              ? 'text-rose-600'
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
                        className="sc-btn-ghost mt-3 w-full py-2 text-xs"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Modifier, tailles & photo
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Tableau desktop (>= md) */}
            <div className="sc-card hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-porcelain-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3.5">Produit</th>
                    <th className="px-4 py-3.5">Tailles & Couleurs</th>
                    <th className="px-4 py-3.5">Prix vente</th>
                    {canReadCost ? <th className="px-4 py-3.5">Coût (CMP)</th> : null}
                    <th className="px-4 py-3.5">Stock dispo</th>
                    <th className="px-4 py-3.5">Vitrine</th>
                    {canWrite ? <th className="px-4 py-3.5 text-right">Action</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => {
                    const thumb = p.imageUrls?.[0];
                    const sizes = p.availableSizes || [];
                    const colors = p.availableColors || [];
                    return (
                      <tr key={p.id} className="transition hover:bg-porcelain-50/70">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {thumb ? (
                              <div className="relative h-11 w-11 shrink-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={thumb}
                                  alt={p.name}
                                  className="h-11 w-11 rounded-xl border border-slate-200 bg-white object-cover"
                                />
                                {(p.imageUrls?.length || 0) > 1 ? (
                                  <span className="absolute -bottom-1 -right-1 rounded-md bg-forest-900 px-1 py-0.5 text-[9px] font-bold text-limeglow-400 shadow-xs">
                                    +{(p.imageUrls?.length || 1) - 1}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                                <Package className="h-5 w-5" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900">{p.name}</p>
                              <p className="text-xs text-slate-500">
                                SKU : <code className="font-mono">{p.sku}</code>
                                {p.categoryName ? ` · ${p.categoryName}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {sizes.length === 0 && colors.length === 0 ? (
                            <span className="text-xs text-slate-400">Standard</span>
                          ) : (
                            <div className="space-y-1">
                              {sizes.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {sizes.slice(0, 5).map((s) => (
                                    <span
                                      key={s}
                                      className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700"
                                    >
                                      {s}
                                    </span>
                                  ))}
                                  {sizes.length > 5 ? (
                                    <span className="text-[10px] text-slate-400">+{sizes.length - 5}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {colors.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-1">
                                  {colors.slice(0, 6).map((c) => (
                                    <span
                                      key={c}
                                      title={c}
                                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700"
                                    >
                                      <span
                                        className="h-2.5 w-2.5 rounded-full border border-slate-300"
                                        style={{ backgroundColor: getColorHex(c) }}
                                      />
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-extrabold text-slate-900 tabular">
                          {formatXof(p.salePriceXof)}
                        </td>
                        {canReadCost ? (
                          <td className="px-4 py-3 text-xs text-slate-600 tabular">
                            {p.costPriceXof !== null ? (
                              formatXof(p.costPriceXof)
                            ) : (
                              <span className="rounded-lg bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                                Estimé
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-4 py-3">
                          <span
                            className={`font-extrabold tabular ${
                              p.stockAvailable <= 0
                                ? 'text-rose-600'
                                : p.stockAvailable <= p.alertThreshold
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                            }`}
                          >
                            {p.stockAvailable} {p.unit}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              p.status === 'PUBLISHED'
                                ? 'bg-emerald-50 text-emerald-700'
                                : p.status === 'DRAFT'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {PRODUCT_STATUS_LABELS[p.status]}
                          </span>
                        </td>
                        {canWrite ? (
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              className="sc-btn-ghost px-3 py-1.5 text-xs"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Modifier
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Modal Création / Édition avec Photo, Description, Tailles & Couleurs */}
        {modalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-3 backdrop-blur-xs sm:p-4">
            <form
              onSubmit={handleSave}
              className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-lg font-extrabold text-slate-900">
                  {editing ? `Modifier ${editing.name}` : 'Créer un nouveau produit'}
                </h2>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label="Fermer"
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {formErr ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {formErr}
                </div>
              ) : null}

              <MultiImageUploader
                purpose="product"
                maxImages={10}
                label="Photos du produit (jusqu’à 10 photos — POS & Vitrine QR)"
                hint="Vous pouvez ajouter 5 photos ou plus d’un coup. La photo #1 est l’image principale."
                values={form.imageUrls}
                onChange={(urls) => setForm((f) => ({ ...f, imageUrls: urls }))}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Nom du produit *</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex. Veste Blazer Classique"
                    className="sc-input mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">SKU / Référence *</label>
                  <input
                    required
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    placeholder="Ex. VEST-001"
                    className="sc-input mt-1 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Description détaillée (affichée sur « Voir plus » de la vitrine)
                </label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Décrivez la matière, la coupe, les détails d’entretien ou les points forts du produit…"
                  className="sc-input mt-1"
                />
              </div>

              {/* Sélection des Tailles disponibles */}
              <div className="rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                    <Ruler className="h-3.5 w-3.5 text-brand-700" />
                    Tailles disponibles ({form.availableSizes.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowShoeSizes((v) => !v)}
                    className="text-[11px] font-bold text-brand-700 hover:underline"
                  >
                    {showShoeSizes ? 'Masquer pointures' : '+ Pointures (36-45)'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[...PRESET_CLOTHING_SIZES, ...(showShoeSizes ? PRESET_SHOE_SIZES : [])].map(
                    (size) => {
                      const active = form.availableSizes.includes(size);
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => toggleSize(size)}
                          className={`rounded-xl px-2.5 py-1 text-xs font-bold transition ${
                            active
                              ? 'bg-forest-900 text-limeglow-400 shadow-xs'
                              : 'border border-slate-200 bg-white text-slate-700 hover:border-brand-400'
                          }`}
                        >
                          {size}
                        </button>
                      );
                    },
                  )}
                  {form.availableSizes
                    .filter(
                      (s) => !PRESET_CLOTHING_SIZES.includes(s) && !PRESET_SHOE_SIZES.includes(s),
                    )
                    .map((custom) => (
                      <button
                        key={custom}
                        type="button"
                        onClick={() => toggleSize(custom)}
                        className="inline-flex items-center gap-1 rounded-xl bg-forest-900 px-2.5 py-1 text-xs font-bold text-limeglow-400"
                      >
                        {custom} ×
                      </button>
                    ))}
                </div>

                <div className="flex gap-2">
                  <input
                    value={customSize}
                    onChange={(e) => setCustomSize(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomSize();
                      }
                    }}
                    placeholder="Autre taille (ex. 46, 2 ans, 50ml)…"
                    className="sc-input py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={addCustomSize}
                    className="sc-btn-ghost shrink-0 py-1.5 text-xs"
                  >
                    Ajouter
                  </button>
                </div>
              </div>

              {/* Sélection des Couleurs disponibles */}
              <div className="rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5 space-y-2.5">
                <span className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                  <Palette className="h-3.5 w-3.5 text-brand-700" />
                  Couleurs disponibles ({form.availableColors.length})
                </span>

                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((c) => {
                    const active = form.availableColors.includes(c.name);
                    return (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => toggleColor(c.name)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition ${
                          active
                            ? 'bg-forest-900 text-white ring-2 ring-limeglow-400'
                            : 'border border-slate-200 bg-white text-slate-700 hover:border-brand-400'
                        }`}
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border border-slate-300"
                          style={{ backgroundColor: c.hex }}
                        />
                        {c.name}
                      </button>
                    );
                  })}
                  {form.availableColors
                    .filter((c) => !PRESET_COLORS.some((p) => p.name === c))
                    .map((custom) => (
                      <button
                        key={custom}
                        type="button"
                        onClick={() => toggleColor(custom)}
                        className="inline-flex items-center gap-1 rounded-full bg-forest-900 px-2.5 py-1 text-xs font-bold text-limeglow-400"
                      >
                        {custom} ×
                      </button>
                    ))}
                </div>

                <div className="flex gap-2">
                  <input
                    value={customColor}
                    onChange={(e) => setCustomColor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomColor();
                      }
                    }}
                    placeholder="Autre couleur (ex. Bordeaux, Turquoise)…"
                    className="sc-input py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={addCustomColor}
                    className="sc-btn-ghost shrink-0 py-1.5 text-xs"
                  >
                    Ajouter
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Catégorie</label>
                  <select
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                    className="sc-input mt-1"
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
                  <label className="block text-xs font-semibold text-slate-700">Code-barres</label>
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    className="sc-input mt-1 font-mono"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Prix vente (XOF) *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={form.salePriceXof}
                    onChange={(e) => setForm({ ...form, salePriceXof: Number(e.target.value) })}
                    className="sc-input mt-1 tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Coût achat (XOF)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.costPriceXof}
                    onChange={(e) => setForm({ ...form, costPriceXof: e.target.value })}
                    placeholder="Optionnel"
                    className="sc-input mt-1 tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Seuil alerte</label>
                  <input
                    type="number"
                    min={0}
                    value={form.alertThreshold}
                    onChange={(e) => setForm({ ...form, alertThreshold: Number(e.target.value) })}
                    className="sc-input mt-1 tabular"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Unité</label>
                  <input
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="sc-input mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Statut vitrine</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ProductStatus })}
                    className="sc-input mt-1"
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
                    <label className="block text-xs font-semibold text-slate-700">Stock initial</label>
                    <input
                      type="number"
                      min={0}
                      value={form.initialStockQty}
                      onChange={(e) =>
                        setForm({ ...form, initialStockQty: Number(e.target.value) || 0 })
                      }
                      className="sc-input mt-1 tabular"
                    />
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button type="button" onClick={() => setModalOpen(false)} className="sc-btn-ghost">
                  Annuler
                </button>
                <button type="submit" disabled={busy} className="sc-btn-primary">
                  {busy ? 'Enregistrement…' : editing ? 'Mettre à jour' : 'Créer le produit'}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
