'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Boxes,
  CalendarClock,
  Package,
  Palette,
  Pencil,
  Pin,
  Plus,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import {
  formatXof,
  normalizeBusinessProfile,
  normalizeShopType,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  ProductStatus,
  SHOP_TYPE_SHORT_LABELS,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { ImageUploader, MultiImageUploader } from '@/components/ui/ImageUploader';
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
  brand?: string | null;
  modelName?: string | null;
  volumeLabel?: string | null;
  isPinnedPos?: boolean;
  bulkUnitLabel?: string | null;
  unitsPerBulk?: number | null;
  bulkSalePriceXof?: number | null;
  allowFractionalSale?: boolean;
  expiryDate?: string | null;
  warrantyMonths?: number | null;
  trackSerialNumber?: boolean;
  stockPhysical: number;
  stockRemainderMilli?: number;
  stockPhysicalDecimal?: number;
  stockAvailable: number;
  stockAvailableDecimal?: number;
}

export default function ProductsPage() {
  const { shopId, activeShop, selectShop, isOwner } = useActiveOperationalShop();
  const canWrite = isOwner || Boolean(activeShop?.permissions['products:create']);
  const canReadCost = isOwner || Boolean(activeShop?.permissions['finance:read_margins']);
  const shopType = normalizeShopType(activeShop?.shopType);
  const profile = normalizeBusinessProfile(shopType, activeShop?.businessProfile);

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
    brand: '',
    modelName: '',
    volumeLabel: '',
    isPinnedPos: false,
    bulkUnitLabel: '',
    unitsPerBulk: '',
    bulkSalePriceXof: '',
    allowFractionalSale: false,
    expiryDate: '',
    batchNumber: '',
    warrantyMonths: '',
    trackSerialNumber: false,
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

  const handleSeedCategories = async () => {
    if (!shopId) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/categories/seed-suggested`, {
        method: 'POST',
        shopId,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de créer les catégories suggérées.');
    } finally {
      setBusy(false);
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
      unit: profile.defaultUnits[0] || 'unité',
      salePriceXof: 0,
      costPriceXof: '',
      alertThreshold: 5,
      status: 'PUBLISHED',
      initialStockQty: 0,
      imageUrls: [],
      availableSizes: [],
      availableColors: [],
      brand: '',
      modelName: '',
      volumeLabel: '',
      isPinnedPos: false,
      bulkUnitLabel: '',
      unitsPerBulk: '',
      bulkSalePriceXof: '',
      allowFractionalSale: false,
      expiryDate: '',
      batchNumber: '',
      warrantyMonths: '',
      trackSerialNumber: false,
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
      brand: p.brand || '',
      modelName: p.modelName || '',
      volumeLabel: p.volumeLabel || '',
      isPinnedPos: Boolean(p.isPinnedPos),
      bulkUnitLabel: p.bulkUnitLabel || '',
      unitsPerBulk: p.unitsPerBulk ? String(p.unitsPerBulk) : '',
      bulkSalePriceXof: p.bulkSalePriceXof !== null && p.bulkSalePriceXof !== undefined ? String(p.bulkSalePriceXof) : '',
      allowFractionalSale: Boolean(p.allowFractionalSale),
      expiryDate: p.expiryDate ? p.expiryDate.slice(0, 10) : '',
      batchNumber: '',
      warrantyMonths: p.warrantyMonths !== null && p.warrantyMonths !== undefined ? String(p.warrantyMonths) : '',
      trackSerialNumber: Boolean(p.trackSerialNumber),
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
        availableSizes: profile.enableSizes ? form.availableSizes : [],
        availableColors: profile.enableColors ? form.availableColors : [],
        brand: profile.enableBrandModel ? form.brand.trim() || null : null,
        modelName: profile.enableBrandModel ? form.modelName.trim() || null : null,
        volumeLabel: profile.enableBrandModel ? form.volumeLabel.trim() || null : null,
        isPinnedPos: profile.enableFastPosFavorites ? Boolean(form.isPinnedPos) : false,
        bulkUnitLabel:
          profile.enableBulkUnits && form.unitsPerBulk.trim() !== ''
            ? form.bulkUnitLabel.trim() || 'carton'
            : null,
        unitsPerBulk:
          profile.enableBulkUnits && form.unitsPerBulk.trim() !== ''
            ? Math.max(2, Math.round(Number(form.unitsPerBulk)))
            : null,
        bulkSalePriceXof:
          profile.enableBulkUnits && form.bulkSalePriceXof.trim() !== ''
            ? Math.round(Number(form.bulkSalePriceXof))
            : null,
        allowFractionalSale: profile.enableAmountSale ? Boolean(form.allowFractionalSale) : false,
        expiryDate:
          profile.enableExpiryTracking && form.expiryDate.trim() !== ''
            ? new Date(`${form.expiryDate.trim()}T23:59:59.000Z`).toISOString()
            : null,
        ...(!editing && profile.enableExpiryTracking && form.batchNumber.trim() !== ''
          ? { batchNumber: form.batchNumber.trim() }
          : {}),
        warrantyMonths:
          profile.enableSerialWarranty && form.warrantyMonths.trim() !== ''
            ? Math.max(0, Math.round(Number(form.warrantyMonths)))
            : null,
        trackSerialNumber: profile.enableSerialWarranty ? Boolean(form.trackSerialNumber) : false,
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
              <div className="flex w-full flex-wrap items-center gap-1.5 pt-1 sm:ml-auto sm:w-auto sm:pt-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSeedCategories}
                  className="inline-flex items-center gap-1 rounded-xl border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-bold text-brand-800 hover:bg-brand-100"
                  title={`Créer les catégories recommandées pour ${SHOP_TYPE_SHORT_LABELS[shopType]}`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Catégories {SHOP_TYPE_SHORT_LABELS[shopType]}
                </button>
                <form
                  onSubmit={handleCreateCategory}
                  className="flex flex-1 gap-1.5 sm:flex-none"
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
              </div>
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
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-bold text-slate-900">{p.name}</p>
                          {p.isPinnedPos ? (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-800">
                              Favori POS
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          <code className="font-mono">{p.sku}</code>
                          {p.categoryName ? ` · ${p.categoryName}` : ''}
                          {p.brand ? ` · ${p.brand}` : ''}
                          {p.modelName ? ` (${p.modelName})` : ''}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {p.unitsPerBulk && p.unitsPerBulk >= 2 ? (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                              {p.bulkUnitLabel || 'carton'} ×{p.unitsPerBulk}
                              {p.bulkSalePriceXof ? ` (${formatXof(p.bulkSalePriceXof)})` : ''}
                            </span>
                          ) : null}
                          {p.allowFractionalSale ? (
                            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
                              Vente au montant
                            </span>
                          ) : null}
                          {p.expiryDate ? (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                              DLC {new Date(p.expiryDate).toLocaleDateString('fr-FR')}
                            </span>
                          ) : null}
                          {p.warrantyMonths ? (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                              Garantie {p.warrantyMonths}m
                            </span>
                          ) : null}
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
                          {(p.stockAvailableDecimal ?? p.stockAvailable)} {p.unit}
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
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="font-bold text-slate-900">{p.name}</p>
                                {p.isPinnedPos ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-800">
                                    ★ POS
                                  </span>
                                ) : null}
                                {p.brand || p.modelName ? (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                                    {[p.brand, p.modelName].filter(Boolean).join(' · ')}
                                  </span>
                                ) : null}
                                {p.volumeLabel ? (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                    {p.volumeLabel}
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-xs text-slate-500">
                                SKU : <code className="font-mono">{p.sku}</code>
                                {p.categoryName ? ` · ${p.categoryName}` : ''}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {p.unitsPerBulk && p.unitsPerBulk >= 2 ? (
                                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                    {p.bulkUnitLabel || 'carton'} ×{p.unitsPerBulk}
                                    {p.bulkSalePriceXof ? ` · ${formatXof(p.bulkSalePriceXof)}` : ''}
                                  </span>
                                ) : null}
                                {p.allowFractionalSale ? (
                                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
                                    Vente au montant
                                  </span>
                                ) : null}
                                {p.expiryDate ? (
                                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                    DLC : {new Date(p.expiryDate).toLocaleDateString('fr-FR')}
                                  </span>
                                ) : null}
                                {p.warrantyMonths ? (
                                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                                    Garantie {p.warrantyMonths} mois{p.trackSerialNumber ? ' · IMEI' : ''}
                                  </span>
                                ) : null}
                              </div>
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
                            {(p.stockAvailableDecimal ?? p.stockAvailable)} {p.unit}
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
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    {editing ? `Modifier ${editing.name}` : 'Créer un nouveau produit'}
                  </h2>
                  <p className="text-[11px] font-semibold text-brand-700">
                    Profil actif : {SHOP_TYPE_SHORT_LABELS[shopType]} (modifiable dans Paramètres)
                  </p>
                </div>
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

              {profile.enableMultiPhotos ? (
                <MultiImageUploader
                  purpose="product"
                  maxImages={10}
                  label="Photos du produit (jusqu’à 10 photos — POS & Vitrine QR)"
                  hint="Vous pouvez ajouter 5 photos ou plus d’un coup. La photo #1 est l’image principale."
                  values={form.imageUrls}
                  onChange={(urls) => setForm((f) => ({ ...f, imageUrls: urls }))}
                />
              ) : (
                <ImageUploader
                  purpose="product"
                  aspect="square"
                  label="Photo du produit (optionnelle pour la saisie rapide)"
                  value={form.imageUrls[0] || null}
                  onChange={(url) => setForm((f) => ({ ...f, imageUrls: url ? [url] : [] }))}
                />
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Nom du produit *</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={
                      shopType === 'GROCERY'
                        ? 'Ex. Lait Bonnet Rouge / Sucre en poudre'
                        : shopType === 'ELECTRONICS'
                          ? 'Ex. Samsung Galaxy A55 5G'
                          : 'Ex. Veste Blazer Classique'
                    }
                    className="sc-input mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">SKU / Référence *</label>
                  <input
                    required
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    placeholder="Ex. REF-001"
                    className="sc-input mt-1 font-mono"
                  />
                </div>
              </div>

              {/* Marque, Modèle & Contenance (Mode, Cosmétique, Électronique) */}
              {profile.enableBrandModel ? (
                <div className="grid gap-3 rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Marque</label>
                    <input
                      value={form.brand}
                      onChange={(e) => setForm({ ...form, brand: e.target.value })}
                      placeholder="Ex. Samsung, Nivea, Zara…"
                      className="sc-input mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Modèle / Série</label>
                    <input
                      value={form.modelName}
                      onChange={(e) => setForm({ ...form, modelName: e.target.value })}
                      placeholder="Ex. SM-A556 / 256Go"
                      className="sc-input mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Contenance / Format</label>
                    <input
                      value={form.volumeLabel}
                      onChange={(e) => setForm({ ...form, volumeLabel: e.target.value })}
                      placeholder="Ex. 250 ml, 500 g…"
                      className="sc-input mt-1 bg-white"
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Description (optionnelle — affichée sur « Voir plus » de la vitrine)
                </label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Détails ou caractéristiques utiles aux clients…"
                  className="sc-input mt-1"
                />
              </div>

              {/* Sélection des Tailles disponibles (uniquement si enableSizes est actif) */}
              {profile.enableSizes ? (
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
              ) : null}

              {/* Sélection des Couleurs disponibles (uniquement si enableColors est actif) */}
              {profile.enableColors ? (
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
              ) : null}

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
                  <label className="block text-xs font-semibold text-slate-700">
                    Prix vente détail (XOF) *
                  </label>
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
                  <label className="block text-xs font-semibold text-slate-700">
                    Coût achat détail (XOF)
                  </label>
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
                  <label className="block text-xs font-semibold text-slate-700">Unité de base</label>
                  <input
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="sc-input mt-1"
                  />
                  {profile.defaultUnits.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {profile.defaultUnits.slice(0, 8).map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, unit: u }))}
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-bold transition ${
                            form.unit === u
                              ? 'bg-forest-900 text-limeglow-400'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  ) : null}
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
                    <label className="block text-xs font-semibold text-slate-700">
                      Stock initial ({form.unit})
                    </label>
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

              {/* Lot 9 : Conditionnement Gros ↔ Détail (Carton / Sac / Pack) */}
              {profile.enableBulkUnits ? (
                <div className="space-y-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3.5">
                  <span className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-950">
                    <Boxes className="h-3.5 w-3.5 text-brand-700" />
                    Conditionnement Gros ↔ Détail (Carton / Sac / Pack — optionnel)
                  </span>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Libellé unité gros
                      </label>
                      <input
                        value={form.bulkUnitLabel}
                        onChange={(e) => setForm({ ...form, bulkUnitLabel: e.target.value })}
                        placeholder="Ex. carton, sac, pack…"
                        className="sc-input mt-1 bg-white py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Nb d’unités détail / gros
                      </label>
                      <input
                        type="number"
                        min={2}
                        value={form.unitsPerBulk}
                        onChange={(e) => setForm({ ...form, unitsPerBulk: e.target.value })}
                        placeholder="Ex. 24"
                        className="sc-input mt-1 bg-white py-1.5 text-xs tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Prix vente en gros (XOF)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={form.bulkSalePriceXof}
                        onChange={(e) => setForm({ ...form, bulkSalePriceXof: e.target.value })}
                        placeholder={
                          form.unitsPerBulk && form.salePriceXof
                            ? String(Number(form.unitsPerBulk) * Number(form.salePriceXof))
                            : 'Ex. 11000'
                        }
                        className="sc-input mt-1 bg-white py-1.5 text-xs tabular"
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Lot 9 : Vente au montant / fraction & Favori POS Express */}
              {profile.enableAmountSale || profile.enableFastPosFavorites ? (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {profile.enableAmountSale ? (
                    <label className="flex items-center gap-2.5 rounded-2xl border border-sky-200 bg-sky-50/50 p-3 text-xs font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={form.allowFractionalSale}
                        onChange={(e) =>
                          setForm({ ...form, allowFractionalSale: e.target.checked })
                        }
                        className="h-4 w-4 accent-brand-700"
                      />
                      <span className="flex items-center gap-1.5">
                        <Scale className="h-3.5 w-3.5 text-sky-700" />
                        Autoriser la vente au montant / fraction (ex. 250 F de {form.name || 'sucre'})
                      </span>
                    </label>
                  ) : null}
                  {profile.enableFastPosFavorites ? (
                    <label className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/50 p-3 text-xs font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={form.isPinnedPos}
                        onChange={(e) => setForm({ ...form, isPinnedPos: e.target.checked })}
                        className="h-4 w-4 accent-brand-700"
                      />
                      <span className="flex items-center gap-1.5">
                        <Pin className="h-3.5 w-3.5 text-amber-700" />
                        Épingler en haut du comptoir POS Express (vente 1 clic)
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : null}

              {/* Lot 10 : Date de péremption (DLC) & Lot initial */}
              {profile.enableExpiryTracking ? (
                <div className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50/40 p-3.5 sm:grid-cols-2">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-extrabold text-amber-950">
                      <CalendarClock className="h-3.5 w-3.5 text-amber-700" />
                      Date de péremption (DLC — optionnelle)
                    </label>
                    <input
                      type="date"
                      value={form.expiryDate}
                      onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                      className="sc-input mt-1 bg-white py-1.5 text-xs"
                    />
                  </div>
                  {!editing ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        N° de lot initial (optionnel)
                      </label>
                      <input
                        value={form.batchNumber}
                        onChange={(e) => setForm({ ...form, batchNumber: e.target.value })}
                        placeholder="Ex. LOT-2026-11"
                        className="sc-input mt-1 bg-white py-1.5 text-xs font-mono"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Lot 10 : Garantie & Numéro de série / IMEI */}
              {profile.enableSerialWarranty ? (
                <div className="grid gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3.5 sm:grid-cols-2">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-extrabold text-indigo-950">
                      <ShieldCheck className="h-3.5 w-3.5 text-indigo-700" />
                      Durée de garantie (en mois)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={form.warrantyMonths}
                      onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })}
                      placeholder="Ex. 12 (imprimé sur ticket & PDF)"
                      className="sc-input mt-1 bg-white py-1.5 text-xs tabular"
                    />
                  </div>
                  <label className="mt-4 flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-white p-2.5 text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={form.trackSerialNumber}
                      onChange={(e) =>
                        setForm({ ...form, trackSerialNumber: e.target.checked })
                      }
                      className="h-4 w-4 accent-brand-700"
                    />
                    <span>Exiger la saisie du N° de série / IMEI lors de la vente POS</span>
                  </label>
                </div>
              ) : null}

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
