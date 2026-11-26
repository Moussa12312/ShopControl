'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  Layers,
  Package,
  Palette,
  Pencil,
  Pin,
  Plus,
  Printer,
  RefreshCw,
  Ruler,
  Scale,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  CATEGORY_SELLING_MODE_SPECS,
  CategorySellingMode,
  formatXof,
  generateProductBarcodeEan13,
  generateProductSku,
  getAllowedSellingModesForShopTypes,
  normalizeBusinessProfile,
  normalizeCategorySellingMode,
  normalizeShopType,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  ProductStatus,
  SHOP_TYPE_DESCRIPTIONS,
  SHOP_TYPE_SHORT_LABELS,
  SHOP_TYPES,
  ShopType,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import {
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { BarcodeLabelsModal } from '@/components/commerce/BarcodeLabelsModal';
import { ImageUploader, MultiImageUploader } from '@/components/ui/ImageUploader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

const PRESET_CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Taille unique'];
const PRESET_SHOE_SIZES = ['38', '39', '40', '41', '42', '43', '44', '45'];
const PRESET_CUSTOM_SIZES = [
  '10 pouces',
  '12 pouces',
  '14 pouces',
  '16 pouces',
  '18 pouces',
  '20 pouces',
  '22 pouces',
  '24 pouces',
  'Petit',
  'Moyen',
  'Grand',
];

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
  { name: 'Argenté', hex: '#94a3b8' },
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
  description?: string | null;
  sellingMode?: CategorySellingMode;
  productsCount: number;
}

export interface ProductVariantItem {
  id?: string;
  name: string;
  sku?: string;
  barcode?: string | null;
  salePriceXof: number;
  costPriceXof?: number | null;
  alertThreshold: number;
  initialStockQty?: number;
  targetStockQty?: number;
  stockPhysical?: number;
  stockAvailable?: number;
  isActive?: boolean;
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
  variants?: ProductVariantItem[];
  stockPhysical: number;
  stockRemainderMilli?: number;
  stockPhysicalDecimal?: number;
  stockAvailable: number;
  stockAvailableDecimal?: number;
}

export default function ProductsPage() {
  const { shopId, activeShop, selectShop, isOwner } = useActiveOperationalShop();
  const canCreate = isOwner || Boolean(activeShop?.permissions['products:create']);
  const canEdit = isOwner || Boolean(activeShop?.permissions['products:update']);
  const canDelete = isOwner || Boolean(activeShop?.permissions['products:archive']);
  const canWrite = canCreate;
  const canReadCost = isOwner || Boolean(activeShop?.permissions['finance:read_margins']);
  const shopType = normalizeShopType(activeShop?.shopType);
  const profile = normalizeBusinessProfile(shopType, activeShop?.businessProfile);
  const enabledShopTypes: ShopType[] =
    profile.enabledShopTypes && profile.enabledShopTypes.length > 0
      ? profile.enabledShopTypes
      : [shopType];
  const allowedSellingModeSpecs = getAllowedSellingModesForShopTypes(enabledShopTypes);
  const allowedSellingModes: CategorySellingMode[] = allowedSellingModeSpecs.map((s) => s.code);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);

  // Création de catégorie (barre principale & étape 1 du modal produit)
  const [newCatName, setNewCatName] = useState('');
  const [newCatSellingMode, setNewCatSellingMode] = useState<CategorySellingMode>(
    allowedSellingModes[0] || 'STANDARD_PIECE',
  );
  const [manualModeSelected, setManualModeSelected] = useState(false);

  // Demande d'ajout d'un nouveau type de boutique au Super Admin
  const [requestTypeOpen, setRequestTypeOpen] = useState(false);
  const [requestedShopType, setRequestedShopType] = useState<ShopType>('FASHION');
  const [requestMessage, setRequestMessage] = useState('');

  // Modal Produit en 2 étapes : 1) Sélection catégorie -> 2) Formulaire adaptatif
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<'PICK_CATEGORY' | 'PRODUCT_FORM'>('PICK_CATEGORY');
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customSize, setCustomSize] = useState('');
  const [customColor, setCustomColor] = useState('');
  const [skuManual, setSkuManual] = useState(false);
  const [barcodeManual, setBarcodeManual] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [codeSeed, setCodeSeed] = useState(() => Math.floor(1000 + Math.random() * 9000));
  const [barcodeTarget, setBarcodeTarget] = useState<ProductRow | null>(null);
  const [previewProduct, setPreviewProduct] = useState<ProductRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null);

  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    description: '',
    categoryId: '',
    unit: 'pièce',
    salePriceXof: 0,
    costPriceXof: '',
    alertThreshold: 5,
    status: 'PUBLISHED' as ProductStatus,
    initialStockQty: 0,
    imageUrls: [] as string[],
    availableSizes: [] as string[],
    availableColors: [] as string[],
    variants: [] as ProductVariantItem[],
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

  useEffect(() => {
    if (!allowedSellingModes.includes(newCatSellingMode)) {
      setNewCatSellingMode(allowedSellingModes[0] || 'STANDARD_PIECE');
    }
  }, [allowedSellingModes, newCatSellingMode]);

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

  const handleCatNameInput = (val: string) => {
    setNewCatName(val);
    if (!manualModeSelected && val.trim().length >= 2) {
      const inferred = normalizeCategorySellingMode(undefined, shopType, val);
      if (allowedSellingModes.includes(inferred)) {
        setNewCatSellingMode(inferred);
      }
    }
  };

  const handleCreateCategory = async (
    e: React.FormEvent,
    autoSelectInModal = false,
  ) => {
    e.preventDefault();
    if (!shopId || !newCatName.trim()) return;
    setBusy(true);
    setFormErr(null);
    try {
      const created = await apiFetch<CategoryRow>(`/shops/${shopId}/categories`, {
        method: 'POST',
        shopId,
        body: {
          name: newCatName.trim(),
          sellingMode: newCatSellingMode,
        },
      });
      setNewCatName('');
      setManualModeSelected(false);
      await load();
      if (autoSelectInModal && created?.id) {
        selectCategoryForProduct({
          id: created.id,
          name: created.name,
          sellingMode: created.sellingMode || newCatSellingMode,
          productsCount: 0,
        });
      } else if (!autoSelectInModal) {
        setInfoMsg('Catégorie créée avec succès.');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Impossible de créer la catégorie.';
      if (autoSelectInModal) {
        setFormErr(msg);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSeedCategories = async () => {
    if (!shopId) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ createdCount: number }>(
        `/shops/${shopId}/categories/seed-suggested`,
        {
          method: 'POST',
          shopId,
        },
      );
      await load();
      setInfoMsg(
        res.createdCount > 0
          ? `${res.createdCount} catégorie(s) adaptée(s) créée(s) avec leurs modes de vente.`
          : 'Toutes les catégories recommandées sont déjà présentes.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de créer les catégories suggérées.');
    } finally {
      setBusy(false);
    }
  };

  const openRequestTypeModal = () => {
    const candidate = SHOP_TYPES.find((t) => !enabledShopTypes.includes(t)) || 'FASHION';
    setRequestedShopType(candidate);
    setRequestMessage('');
    setRequestTypeOpen(true);
  };

  const handleRequestShopType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ ticketNumber: string; message: string }>(
        `/shops/${shopId}/request-shop-type`,
        {
          method: 'POST',
          shopId,
          body: {
            requestedShopType,
            message: requestMessage.trim() || undefined,
          },
        },
      );
      setInfoMsg(res.message);
      setRequestTypeOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi de la demande impossible.');
    } finally {
      setBusy(false);
    }
  };

  const selectCategoryForProduct = (cat: CategoryRow) => {
    const mode = normalizeCategorySellingMode(cat.sellingMode, shopType, cat.name);
    const spec = CATEGORY_SELLING_MODE_SPECS[mode];
    setForm((prev) => ({
      ...prev,
      categoryId: cat.id,
      unit: spec.defaultUnit || 'pièce',
      bulkUnitLabel: spec.defaultBulkUnitLabel || '',
      allowFractionalSale: spec.defaultAllowFractionalSale,
      trackSerialNumber: spec.serialRequiredByDefault,
    }));
    setFormErr(null);
    setModalStep('PRODUCT_FORM');
  };

  const openCreate = () => {
    setEditing(null);
    setFormErr(null);
    setCustomSize('');
    setCustomColor('');
    setSkuManual(false);
    setBarcodeManual(false);
    setShowAdvanced(false);
    setCodeSeed(Math.floor(1000 + Math.random() * 9000));
    const defaultCat = (catFilter ? categories.find((c) => c.id === catFilter) : null) || categories[0] || null;
    const mode = defaultCat ? normalizeCategorySellingMode(defaultCat.sellingMode, shopType, defaultCat.name) : (allowedSellingModes[0] || 'STANDARD_PIECE');
    const spec = CATEGORY_SELLING_MODE_SPECS[mode];
    setForm({
      name: '',
      sku: '',
      barcode: '',
      description: '',
      categoryId: defaultCat?.id || '',
      unit: defaultCat ? spec.defaultUnit : 'pièce',
      salePriceXof: 0,
      costPriceXof: '',
      alertThreshold: 5,
      status: 'PUBLISHED',
      initialStockQty: 0,
      imageUrls: [],
      availableSizes: [],
      availableColors: [],
      variants: [],
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
    setModalStep(categories.length > 0 ? 'PRODUCT_FORM' : 'PICK_CATEGORY');
    setModalOpen(true);
  };

  const openEdit = (p: ProductRow) => {
    setEditing(p);
    setFormErr(null);
    setCustomSize('');
    setCustomColor('');
    setSkuManual(true);
    setBarcodeManual(true);
    setShowAdvanced(false);
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
      variants: Array.isArray(p.variants)
        ? p.variants.map((v) => ({
            id: v.id,
            name: v.name,
            sku: v.sku,
            barcode: v.barcode || '',
            salePriceXof: v.salePriceXof,
            costPriceXof: v.costPriceXof,
            alertThreshold: v.alertThreshold,
            initialStockQty: 0,
            targetStockQty: v.stockPhysical ?? 0,
            stockPhysical: v.stockPhysical,
            stockAvailable: v.stockAvailable,
          }))
        : [],
      brand: p.brand || '',
      modelName: p.modelName || '',
      volumeLabel: p.volumeLabel || '',
      isPinnedPos: Boolean(p.isPinnedPos),
      bulkUnitLabel: p.bulkUnitLabel || '',
      unitsPerBulk: p.unitsPerBulk ? String(p.unitsPerBulk) : '',
      bulkSalePriceXof:
        p.bulkSalePriceXof !== null && p.bulkSalePriceXof !== undefined
          ? String(p.bulkSalePriceXof)
          : '',
      allowFractionalSale: Boolean(p.allowFractionalSale),
      expiryDate: p.expiryDate ? p.expiryDate.slice(0, 10) : '',
      batchNumber: '',
      warrantyMonths:
        p.warrantyMonths !== null && p.warrantyMonths !== undefined
          ? String(p.warrantyMonths)
          : '',
      trackSerialNumber: Boolean(p.trackSerialNumber),
    });
    setModalStep('PRODUCT_FORM');
    setModalOpen(true);
  };

  // Catégorie actuellement sélectionnée dans le formulaire produit & son spec adaptatif
  const selectedCategory = categories.find((c) => c.id === form.categoryId) || null;
  const activeSellingMode: CategorySellingMode = selectedCategory
    ? normalizeCategorySellingMode(selectedCategory.sellingMode, shopType, selectedCategory.name)
    : allowedSellingModes[0] || 'STANDARD_PIECE';
  const activeSpec = CATEGORY_SELLING_MODE_SPECS[activeSellingMode];

  useEffect(() => {
    if (!modalOpen || editing || modalStep !== 'PRODUCT_FORM') return;
    setForm((prev) => {
      const nextSku = skuManual
        ? prev.sku
        : generateProductSku({
            shopName: activeShop?.shopName,
            categoryName: selectedCategory?.name,
            productName: prev.name,
            uniqueSeed: codeSeed,
          });
      const nextBarcode = barcodeManual
        ? prev.barcode
        : generateProductBarcodeEan13({
            shopName: activeShop?.shopName,
            categoryName: selectedCategory?.name,
            productName: prev.name,
            uniqueSeed: codeSeed,
          });
      if (nextSku === prev.sku && nextBarcode === prev.barcode) return prev;
      return { ...prev, sku: nextSku, barcode: nextBarcode };
    });
  }, [
    modalOpen,
    editing,
    modalStep,
    skuManual,
    barcodeManual,
    codeSeed,
    activeShop?.shopName,
    selectedCategory?.name,
    form.name,
  ]);

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

  const generateVariantCombinations = () => {
    const sizes = form.availableSizes.length > 0 ? form.availableSizes : ['Unique'];
    const colors = form.availableColors.length > 0 ? form.availableColors : ['Unique'];

    const newVars: ProductVariantItem[] = [];
    let idx = 1;

    for (const s of sizes) {
      for (const c of colors) {
        let vName = '';
        if (s !== 'Unique' && c !== 'Unique') {
          vName = `${s} / ${c}`;
        } else if (s !== 'Unique') {
          vName = `Taille ${s}`;
        } else if (c !== 'Unique') {
          vName = `Couleur ${c}`;
        } else {
          vName = `Standard`;
        }

        const existing = form.variants.find((v) => v.name.toLowerCase() === vName.toLowerCase());
        if (existing) {
          newVars.push(existing);
        } else {
          const varSku = `${form.sku || 'SKU'}-${s !== 'Unique' ? s.slice(0, 3).toUpperCase() : 'VAR'}-${c !== 'Unique' ? c.slice(0, 3).toUpperCase() : idx}`;
          const varBarcode = generateProductBarcodeEan13({
            shopName: activeShop?.shopName,
            categoryName: selectedCategory?.name,
            productName: `${form.name} ${vName}`,
            uniqueSeed: codeSeed + idx,
          });

          newVars.push({
            name: vName,
            sku: varSku,
            barcode: varBarcode,
            salePriceXof: form.salePriceXof || 0,
            costPriceXof: form.costPriceXof ? Number(form.costPriceXof) : null,
            alertThreshold: form.alertThreshold || 2,
            initialStockQty: 0,
          });
          idx++;
        }
      }
    }

    setForm((f) => ({ ...f, variants: newVars }));
  };

  const addManualVariant = () => {
    const idx = form.variants.length + 1;
    const vName = `Variante ${idx}`;
    const varSku = `${form.sku || 'SKU'}-VAR-${idx}`;
    const varBarcode = generateProductBarcodeEan13({
      shopName: activeShop?.shopName,
      categoryName: selectedCategory?.name,
      productName: `${form.name} ${vName}`,
      uniqueSeed: codeSeed + idx + 50,
    });
    setForm((f) => ({
      ...f,
      variants: [
        ...f.variants,
        {
          name: vName,
          sku: varSku,
          barcode: varBarcode,
          salePriceXof: form.salePriceXof || 0,
          costPriceXof: form.costPriceXof ? Number(form.costPriceXof) : null,
          alertThreshold: form.alertThreshold || 2,
          initialStockQty: 0,
        },
      ],
    }));
  };

  const updateVariant = (index: number, patch: Partial<ProductVariantItem>) => {
    setForm((f) => {
      const next = [...f.variants];
      next[index] = { ...next[index], ...patch };
      return { ...f, variants: next };
    });
  };

  const removeVariant = (index: number) => {
    setForm((f) => ({
      ...f,
      variants: f.variants.filter((_, i) => i !== index),
    }));
  };

  const handleDeleteProduct = async (product: ProductRow) => {
    if (!shopId) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ success: boolean; action: string; message: string }>(
        `/shops/${shopId}/products/${product.id}`,
        {
          method: 'DELETE',
          shopId,
        },
      );
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      setDeleteTarget(null);
      if (previewProduct?.id === product.id) setPreviewProduct(null);
      if (editing?.id === product.id) setModalOpen(false);
      setInfoMsg(res.message);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la suppression du produit.');
    } finally {
      setBusy(false);
    }
  };

  const handleAutoVentilate = async (product: ProductRow) => {
    if (!shopId || !product.variants?.length) return;
    setBusy(true);
    try {
      const totalVarStock = product.variants.reduce((sum, v) => sum + (v.stockPhysical || 0), 0);
      const baseStock = Math.max(0, product.stockPhysical - totalVarStock);
      if (baseStock <= 0) {
        setError('Aucun stock principal non-ventilé disponible.');
        return;
      }
      const count = product.variants.length;
      const perVariant = Math.floor(baseStock / count);
      let remainder = baseStock % count;

      const distributions = product.variants.map((v) => {
        const qty = perVariant + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        return { variantId: v.id, quantity: qty };
      });

      const res = await apiFetch<{ success: boolean; totalVentilated: number; message: string }>(
        `/shops/${shopId}/products/${product.id}/ventilate-stock`,
        {
          method: 'POST',
          shopId,
          body: { distributions },
        },
      );
      setInfoMsg(res.message);
      if (previewProduct?.id === product.id) setPreviewProduct(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la ventilation du stock.');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    if (!form.categoryId) {
      setFormErr('Veuillez d’abord sélectionner la catégorie du produit.');
      setModalStep('PICK_CATEGORY');
      return;
    }
    setFormErr(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        sku: form.sku,
        barcode: form.barcode.trim() || undefined,
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || null,
        unit: form.unit || activeSpec.defaultUnit,
        salePriceXof: Math.round(Number(form.salePriceXof) || 0),
        costPriceXof:
          form.costPriceXof.trim() === '' ? null : Math.round(Number(form.costPriceXof)),
        alertThreshold: Math.round(Number(form.alertThreshold) || 0),
        status: form.status,
        imageUrls: form.imageUrls,
        availableSizes: activeSpec.sizeMode !== 'NONE' ? form.availableSizes : [],
        availableColors: activeSpec.showColors ? form.availableColors : [],
        brand: activeSpec.showBrand ? form.brand.trim() || null : null,
        modelName: activeSpec.showModel ? form.modelName.trim() || null : null,
        volumeLabel: activeSpec.showVolumeDimension ? form.volumeLabel.trim() || null : null,
        isPinnedPos: activeSpec.showPosFavoriteToggle ? Boolean(form.isPinnedPos) : false,
        bulkUnitLabel:
          activeSpec.showBulkPackaging && form.unitsPerBulk.trim() !== ''
            ? form.bulkUnitLabel.trim() || activeSpec.defaultBulkUnitLabel || 'carton'
            : null,
        unitsPerBulk:
          activeSpec.showBulkPackaging && form.unitsPerBulk.trim() !== ''
            ? Math.max(2, Math.round(Number(form.unitsPerBulk)))
            : null,
        bulkSalePriceXof:
          activeSpec.showBulkPackaging && form.bulkSalePriceXof.trim() !== ''
            ? Math.round(Number(form.bulkSalePriceXof))
            : null,
        allowFractionalSale: activeSpec.showAmountFractionalSale
          ? Boolean(form.allowFractionalSale)
          : false,
        expiryDate:
          activeSpec.showExpiryDlc && form.expiryDate.trim() !== ''
            ? new Date(`${form.expiryDate.trim()}T23:59:59.000Z`).toISOString()
            : null,
        ...(!editing && activeSpec.showExpiryDlc && form.batchNumber.trim() !== ''
          ? { batchNumber: form.batchNumber.trim() }
          : {}),
        warrantyMonths:
          activeSpec.showWarranty && form.warrantyMonths.trim() !== ''
            ? Math.max(0, Math.round(Number(form.warrantyMonths)))
            : null,
        trackSerialNumber: activeSpec.showSerialNumber
          ? Boolean(form.trackSerialNumber)
          : false,
        ...(!editing && form.initialStockQty > 0
          ? { initialStockQty: form.initialStockQty }
          : {}),
        variants:
          form.variants.length > 0
            ? form.variants.map((v) => ({
                id: v.id && v.id.length > 10 ? v.id : undefined,
                name: v.name.trim(),
                sku: v.sku?.trim() || undefined,
                barcode: v.barcode?.trim() || undefined,
                salePriceXof: Math.round(Number(v.salePriceXof) || form.salePriceXof || 0),
                costPriceXof:
                  v.costPriceXof !== undefined && v.costPriceXof !== null && String(v.costPriceXof).trim() !== ''
                    ? Math.round(Number(v.costPriceXof))
                    : null,
                alertThreshold: Math.round(Number(v.alertThreshold) || 2),
                initialStockQty: !editing ? Math.max(0, Math.round(Number(v.initialStockQty) || 0)) : undefined,
                targetStockQty:
                  editing
                    ? Math.max(
                        0,
                        Math.round(
                          Number(
                            v.targetStockQty !== undefined
                              ? v.targetStockQty
                              : v.stockPhysical !== undefined
                                ? v.stockPhysical
                                : 0,
                          ),
                        ),
                      )
                    : undefined,
              }))
            : undefined,
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

  const presetSizesForActiveSpec =
    activeSpec.sizeMode === 'CLOTHING'
      ? PRESET_CLOTHING_SIZES
      : activeSpec.sizeMode === 'SHOES'
        ? PRESET_SHOE_SIZES
        : activeSpec.sizeMode === 'CUSTOM'
          ? PRESET_CUSTOM_SIZES
          : [];

  return (
    <AppShell
      allowedRoles={['OWNER', 'AGENT']}
      title="Produits & Catégories"
      subtitle="Gérez votre catalogue, vos catégories et vos prix."
      headerActions={
        canWrite && shopId ? (
          <button type="button" onClick={openCreate} className="sc-hero-btn-primary">
            <Plus className="h-3.5 w-3.5" />
            Nouveau produit
          </button>
        ) : null
      }
    >
      <div className="space-y-3.5 sm:space-y-4">
        {infoMsg ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-900">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {infoMsg}
            </span>
            <button
              type="button"
              onClick={() => setInfoMsg(null)}
              className="text-emerald-700 hover:underline"
            >
              Fermer
            </button>
          </div>
        ) : null}

        {/* Ligne 1 : Recherche & Bouton repliable Catégories / Rayons */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, SKU ou code-barres…"
              className="sc-input pl-10"
            />
          </div>

          {shopId ? (
            <button
              type="button"
              onClick={() => setManageCategoriesOpen((o) => !o)}
              aria-expanded={manageCategoriesOpen}
              className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                manageCategoriesOpen
                  ? 'border-forest-900 bg-forest-900 text-limeglow-400'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>Catégories & Rayons ({categories.length})</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  manageCategoriesOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          ) : null}
        </div>

        {/* Ligne 2 : Filtre rapide sur une seule ligne horizontale */}
        {shopId && categories.length > 0 ? (
          <div className="flex w-full max-w-full min-w-0 items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCatFilter('')}
              className={`shrink-0 !min-h-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition ${
                catFilter === ''
                  ? 'bg-forest-900 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              Toutes ({products.length})
            </button>
            {categories.map((c) => {
              const mode = normalizeCategorySellingMode(c.sellingMode, shopType, c.name);
              const spec = CATEGORY_SELLING_MODE_SPECS[mode];
              const active = catFilter === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCatFilter(active ? '' : c.id)}
                  title={`Mode de vente : ${spec.label}`}
                  className={`shrink-0 !min-h-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    active
                      ? 'bg-forest-900 text-white shadow-xs'
                      : 'bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {c.name} ({c.productsCount})
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Compact banner when no categories exist */}
        {shopId && !loading && categories.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
            <div>
              <p className="text-xs font-bold text-brand-950">Aucune catégorie créée pour l'instant</p>
              <p className="text-[11px] text-brand-800/80">Créez vos rayons ou générez automatiquement ceux conseillés pour votre boutique.</p>
            </div>
            <div className="flex items-center gap-2">
              {canWrite ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSeedCategories}
                  className="sc-btn-primary py-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Générer catégories recommandées
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Modal dédié Gestion des Catégories & Rayons (évite d'encombrer la page sur mobile) */}
        {manageCategoriesOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Tag className="h-5 w-5 text-brand-700" />
                  <h2 className="text-base font-extrabold text-slate-900">
                    Catégories & Rayons ({categories.length})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setManageCategoriesOpen(false)}
                  className="rounded-xl p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                    Type(s) de boutique :
                  </span>
                  {enabledShopTypes.map((st) => (
                    <span
                      key={st}
                      className="rounded-full bg-forest-900 px-2.5 py-0.5 text-[11px] font-bold text-limeglow-400"
                    >
                      {SHOP_TYPE_SHORT_LABELS[st]}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {canWrite ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSeedCategories}
                      className="inline-flex items-center gap-1 rounded-xl border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[11px] font-bold text-brand-800 hover:bg-brand-100"
                      title="Générer les catégories recommandées pour votre type de boutique"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Générer recommandées
                    </button>
                  ) : null}
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => {
                        setManageCategoriesOpen(false);
                        openRequestTypeModal();
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-porcelain-50 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:border-brand-300 hover:text-brand-800"
                      title="Demander au Super Admin d’ajouter un autre secteur"
                    >
                      <Layers className="h-3.5 w-3.5 text-brand-700" />
                      + Autre type (Super Admin)
                    </button>
                  ) : null}
                  {canWrite ? (
                    <Link
                      href="/commerce/import"
                      className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:border-brand-300 hover:text-brand-800 md:inline-flex"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Import CSV
                    </Link>
                  ) : null}
                </div>
              </div>

              {canWrite ? (
                <form
                  onSubmit={(e) => handleCreateCategory(e, false)}
                  className="space-y-2.5 rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5"
                >
                  <span className="block text-xs font-extrabold text-slate-800">
                    + Ajouter une nouvelle catégorie :
                  </span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={newCatName}
                      onChange={(e) => handleCatNameInput(e.target.value)}
                      placeholder="Nom (ex: Robes, Chaussures, Huile...)"
                      className="sc-input bg-white py-2 text-xs"
                    />
                    <select
                      value={newCatSellingMode}
                      onChange={(e) => {
                        setNewCatSellingMode(e.target.value as CategorySellingMode);
                        setManualModeSelected(true);
                      }}
                      className="sc-input bg-white py-2 text-xs font-semibold text-slate-800"
                    >
                      {allowedSellingModes.map((m) => (
                        <option key={m} value={m}>
                          {CATEGORY_SELLING_MODE_SPECS[m].shortLabel}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <p className="text-[11px] text-slate-500">
                      {CATEGORY_SELLING_MODE_SPECS[newCatSellingMode].description}
                    </p>
                    <button
                      type="submit"
                      disabled={busy || !newCatName.trim()}
                      className="sc-btn-primary shrink-0 py-1.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Créer la catégorie
                    </button>
                  </div>
                </form>
              ) : null}

              {categories.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-700">Catégories existantes :</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-60 overflow-y-auto">
                    {categories.map((c) => {
                      const mode = normalizeCategorySellingMode(c.sellingMode, shopType, c.name);
                      const spec = CATEGORY_SELLING_MODE_SPECS[mode];
                      const active = catFilter === c.id;
                      return (
                        <button
                          key={`mgr-${c.id}`}
                          type="button"
                          onClick={() => {
                            setCatFilter(active ? '' : c.id);
                            setManageCategoriesOpen(false);
                          }}
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${
                            active
                              ? 'border-forest-900 bg-forest-900 text-white'
                              : 'border-slate-200/80 bg-porcelain-50 text-slate-800 hover:border-brand-300'
                          }`}
                        >
                          <span className="min-w-0 truncate font-bold">{c.name}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                                active
                                  ? 'bg-white/15 text-limeglow-400'
                                  : 'bg-white text-slate-500 ring-1 ring-slate-200/70'
                              }`}
                            >
                              {spec.shortLabel}
                            </span>
                            <span className="text-[11px] font-bold opacity-80 tabular">
                              ({c.productsCount})
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : products.length === 0 ? (
          <EmptyState
            title="Catalogue vide"
            description="Cliquez sur « Nouveau produit », choisissez sa catégorie et remplissez uniquement les champs adaptés à cette catégorie."
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
                          {p.variants && p.variants.length > 0 ? (
                            <span className="shrink-0 rounded-full bg-forest-900 px-2 py-0.5 text-[9px] font-extrabold text-limeglow-400">
                              {p.variants.length} variantes
                            </span>
                          ) : null}
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
                            <span
                              key={s}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700"
                            >
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
                      className={`mt-3 grid gap-2 rounded-xl bg-porcelain-50 p-2.5 text-center text-xs ${canReadCost ? 'grid-cols-3' : 'grid-cols-2'
                        }`}
                    >
                      <div>
                        <p className="text-[10px] text-slate-500">Prix vente</p>
                        <p className="font-extrabold text-slate-900 tabular">
                          {formatXof(p.salePriceXof)}
                        </p>
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
                          className={`font-extrabold tabular ${p.stockAvailable <= 0
                            ? 'text-rose-600'
                            : p.stockAvailable <= p.alertThreshold
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                            }`}
                        >
                          {p.stockAvailableDecimal ?? p.stockAvailable} {p.unit}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPreviewProduct(p)}
                        className="sc-btn-ghost flex-1 py-1.5 text-xs font-semibold"
                        title="Voir la fiche détaillée du produit"
                      >
                        <Eye className="h-3.5 w-3.5 text-brand-700" />
                        Aperçu
                      </button>
                      <button
                        type="button"
                        onClick={() => setBarcodeTarget(p)}
                        className="sc-btn-ghost px-2.5 py-1.5 text-xs"
                        title="Imprimer ou prévisualiser les étiquettes code-barres"
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="sc-btn-ghost px-2.5 py-1.5 text-xs"
                          title="Modifier ce produit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(p)}
                          className="sc-btn-ghost px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                          title="Supprimer ou archiver ce produit"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tableau desktop (>= md) */}
            <div className="sc-card hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] table-auto divide-y divide-slate-200 text-sm">
                <thead className="bg-porcelain-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3.5 py-3.5 whitespace-nowrap min-w-[200px]">Produit & Catégorie</th>
                    <th className="px-3 py-3.5 whitespace-nowrap min-w-[140px]">Caractéristiques</th>
                    <th className="px-3 py-3.5 whitespace-nowrap min-w-[100px]">Prix vente</th>
                    {canReadCost ? <th className="px-3 py-3.5 whitespace-nowrap min-w-[100px]">Coût (CMP)</th> : null}
                    <th className="px-3 py-3.5 whitespace-nowrap min-w-[95px]">Stock dispo</th>
                    <th className="px-3 py-3.5 whitespace-nowrap min-w-[80px]">Vitrine</th>
                    {canEdit || canDelete ? (
                      <th className="sticky right-0 z-10 bg-porcelain-50 px-3.5 py-3.5 text-right whitespace-nowrap min-w-[190px] shadow-[-6px_0_12px_-4px_rgba(0,0,0,0.08)]">
                        Action
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => {
                    const thumb = p.imageUrls?.[0];
                    const sizes = p.availableSizes || [];
                    const colors = p.availableColors || [];
                    return (
                      <tr key={p.id} className="transition hover:bg-porcelain-50/70">
                        <td
                          className="px-4 py-3 cursor-pointer group"
                          onClick={() => setPreviewProduct(p)}
                          title="Cliquer pour voir l'aperçu complet de la fiche produit"
                        >
                          <div className="flex items-center gap-3">
                            {thumb ? (
                              <div className="relative h-11 w-11 shrink-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={thumb}
                                  alt={p.name}
                                  className="h-11 w-11 rounded-xl border border-slate-200 bg-white object-cover group-hover:border-brand-400 transition"
                                />
                                {(p.imageUrls?.length || 0) > 1 ? (
                                  <span className="absolute -bottom-1 -right-1 rounded-md bg-forest-900 px-1 py-0.5 text-[9px] font-bold text-limeglow-400 shadow-xs">
                                    +{(p.imageUrls?.length || 1) - 1}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 group-hover:bg-brand-100 transition">
                                <Package className="h-5 w-5" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="font-bold text-slate-900 group-hover:text-brand-800 transition">
                                  {p.name}
                                </p>
                                {p.brand ? (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-semibold text-slate-700">
                                    {p.brand}
                                  </span>
                                ) : null}
                                {p.isPinnedPos ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[9px] font-extrabold text-amber-800">
                                    ★ POS
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-xs text-slate-500">
                                <code className="font-mono text-slate-600">{p.sku}</code>
                                {p.categoryName ? ` · ${p.categoryName}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {p.variants && p.variants.length > 0 ? (
                            <div className="flex flex-col items-start gap-1">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-forest-900/10 border border-forest-900/15 px-2.5 py-0.5 text-xs font-bold text-forest-900 whitespace-nowrap">
                                <Tag className="w-3 h-3 text-brand-700" />
                                {p.variants.length} déclinaisons
                              </span>
                              {sizes.length > 0 ? (
                                <span className="text-[11px] text-slate-500 truncate max-w-[170px]" title={sizes.join(', ')}>
                                  {sizes.slice(0, 5).join(', ')}{sizes.length > 5 ? '…' : ''}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                              Article unique ({p.unit})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-extrabold text-slate-900 tabular whitespace-nowrap">
                          {formatXof(p.salePriceXof)}
                        </td>
                        {canReadCost ? (
                          <td className="px-4 py-3 text-xs text-slate-600 tabular whitespace-nowrap">
                            {p.costPriceXof !== null ? (
                              formatXof(p.costPriceXof)
                            ) : (
                              <span className="rounded-lg bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 whitespace-nowrap">
                                Estimé
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`font-extrabold tabular whitespace-nowrap ${p.stockAvailable <= 0
                              ? 'text-rose-600'
                              : p.stockAvailable <= p.alertThreshold
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                              }`}
                          >
                            {p.stockAvailableDecimal ?? p.stockAvailable} {p.unit}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${p.status === 'PUBLISHED'
                              ? 'bg-emerald-50 text-emerald-700'
                              : p.status === 'DRAFT'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-rose-50 text-rose-700'
                              }`}
                          >
                            {PRODUCT_STATUS_LABELS[p.status]}
                          </span>
                        </td>
                        <td className="sticky right-0 z-10 bg-white/95 backdrop-blur-xs px-3 py-2.5 text-right shadow-[-6px_0_12px_-4px_rgba(0,0,0,0.08)] group-hover:bg-porcelain-50/95 transition">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setPreviewProduct(p)}
                              className="sc-btn-ghost px-2 py-1 text-xs font-semibold"
                              title="Aperçu rapide"
                            >
                              <Eye className="h-3.5 w-3.5 text-brand-700" />
                              <span className="hidden xl:inline">Aperçu</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setBarcodeTarget(p)}
                              className="sc-btn-ghost px-2 py-1 text-xs"
                              title="Imprimer les étiquettes code-barres"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              <span className="hidden xl:inline">Étiquettes</span>
                            </button>
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => openEdit(p)}
                                className="sc-btn-ghost flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-forest-950 transition hover:bg-slate-200"
                                title="Modifier le produit"
                              >
                                <Pencil className="h-3.5 w-3.5 text-forest-800" />
                                <span>Modifier</span>
                              </button>
                            ) : null}
                            {canDelete ? (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(p)}
                                className="sc-btn-ghost p-1.5 text-xs text-rose-600 hover:bg-rose-50"
                                title="Supprimer ou archiver ce produit"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
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

        {/* MODAL PRODUIT EN 2 ÉTAPES : 1) CHOIX CATÉGORIE -> 2) FORMULAIRE ADAPTATIF ZÉRO MÉLANGE */}
        {modalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden bg-forest-950/70 p-2 sm:p-4 backdrop-blur-xs">
            <div className="max-h-[94vh] w-full max-w-[calc(100vw-1rem)] sm:max-w-5xl overflow-y-auto overflow-x-hidden rounded-3xl border border-slate-200 bg-white p-3.5 shadow-2xl sm:p-6 lg:p-7">
              {/* En-tête du modal */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    {editing
                      ? `Modifier ${editing.name}`
                      : modalStep === 'PICK_CATEGORY'
                        ? 'Étape 1 / 2 — Dans quelle catégorie se trouve ce produit ?'
                        : 'Étape 2 / 2 — Fiche produit adaptée à la catégorie'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {modalStep === 'PICK_CATEGORY'
                      ? 'Sélectionnez d’abord la catégorie : le formulaire affichera uniquement les champs adaptés (poids, carton, taille/couleur, ml/DLC ou garantie/IMEI).'
                      : `Champs personnalisés pour : ${selectedCategory?.name || 'Catégorie'} (${activeSpec.shortLabel})`}
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
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {formErr}
                </div>
              ) : null}

              {/* ÉTAPE 1 : SÉLECTION DE LA CATÉGORIE */}
              {modalStep === 'PICK_CATEGORY' ? (
                <div className="mt-4 space-y-4">
                  {categories.length === 0 ? (
                    <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4 text-center">
                      <p className="text-sm font-extrabold text-slate-900">
                        Aucune catégorie créée pour le moment
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Générez en 1 clic les catégories recommandées pour votre boutique ou créez votre propre catégorie ci-dessous.
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleSeedCategories}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-forest-900 px-4 py-2 text-xs font-bold text-limeglow-400 hover:bg-forest-800"
                      >
                        <Sparkles className="h-4 w-4" />
                        Générer les catégories recommandées
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {categories.map((c) => {
                        const mode = normalizeCategorySellingMode(c.sellingMode, shopType, c.name);
                        const spec = CATEGORY_SELLING_MODE_SPECS[mode];
                        const isSelected = form.categoryId === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectCategoryForProduct(c)}
                            className={`group flex flex-col justify-between rounded-2xl border p-3.5 text-left transition ${isSelected
                              ? 'border-forest-900 bg-forest-900 text-white shadow-md'
                              : 'border-slate-200 bg-porcelain-50 text-slate-900 hover:border-brand-500 hover:bg-white'
                              }`}
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-extrabold">{c.name}</span>
                                <ChevronRight
                                  className={`h-4 w-4 shrink-0 transition group-hover:translate-x-0.5 ${isSelected ? 'text-limeglow-400' : 'text-slate-400'
                                    }`}
                                />
                              </div>
                              <span
                                className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${isSelected
                                  ? 'bg-white/15 text-limeglow-400'
                                  : 'bg-brand-50 text-brand-800'
                                  }`}
                              >
                                {spec.shortLabel}
                              </span>
                              <p
                                className={`mt-1.5 line-clamp-2 text-[11px] leading-snug ${isSelected ? 'text-emerald-100/85' : 'text-slate-500'
                                  }`}
                              >
                                {c.description || spec.description}
                              </p>
                            </div>
                            <p
                              className={`mt-2 text-[10px] font-semibold ${isSelected ? 'text-emerald-200' : 'text-slate-400'
                                }`}
                            >
                              {c.productsCount} produit(s) dans cette catégorie
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Création rapide d'une catégorie directement depuis l'Étape 1 */}
                  <form
                    onSubmit={(e) => handleCreateCategory(e, true)}
                    className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3.5"
                  >
                    <p className="text-xs font-extrabold text-slate-800">
                      + Créer une nouvelle catégorie et continuer directement :
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={newCatName}
                        onChange={(e) => handleCatNameInput(e.target.value)}
                        placeholder="Nom de la catégorie (ex: Pommades, Robes, Sucre…)"
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                      />
                      <select
                        value={newCatSellingMode}
                        onChange={(e) => {
                          setNewCatSellingMode(e.target.value as CategorySellingMode);
                          setManualModeSelected(true);
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800"
                      >
                        {allowedSellingModes.map((m) => (
                          <option key={m} value={m}>
                            {CATEGORY_SELLING_MODE_SPECS[m].shortLabel}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-500">
                        {CATEGORY_SELLING_MODE_SPECS[newCatSellingMode].description}
                      </p>
                      <button
                        type="submit"
                        disabled={busy || !newCatName.trim()}
                        className="shrink-0 rounded-xl bg-brand-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50"
                      >
                        Créer & Choisir
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                /* ÉTAPE 2 : FORMULAIRE PRODUIT ÉPURÉ ET FLUIDE */
                <form onSubmit={handleSave} className="mt-4 space-y-4">
                  {/* Sélecteur de catégorie rapide en haut du formulaire */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-2xl border border-emerald-200/50 bg-forest-950 p-3 sm:p-3.5 text-white shadow-xs">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-300 shrink-0">
                        Catégorie :
                      </span>
                      <select
                        value={form.categoryId}
                        onChange={(e) => {
                          const catId = e.target.value;
                          const cat = categories.find((c) => c.id === catId);
                          const mode = cat ? normalizeCategorySellingMode(cat.sellingMode, shopType, cat.name) : (allowedSellingModes[0] || 'STANDARD_PIECE');
                          const spec = CATEGORY_SELLING_MODE_SPECS[mode];
                          setForm((f) => ({
                            ...f,
                            categoryId: catId,
                            unit: f.unit || spec.defaultUnit,
                          }));
                        }}
                        className="min-w-0 flex-1 rounded-xl border border-white/20 bg-forest-900/90 px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-limeglow-400"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id} className="bg-forest-950 text-white">
                            {c.name} ({CATEGORY_SELLING_MODE_SPECS[normalizeCategorySellingMode(c.sellingMode, shopType, c.name)].shortLabel})
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => setModalStep('PICK_CATEGORY')}
                      className="inline-flex self-start sm:self-auto items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1.5 text-xs font-bold text-limeglow-400 hover:bg-white/20 shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Autre catégorie
                    </button>
                  </div>

                  {/* 1. INFORMATIONS ESSENTIELLES */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5 shadow-2xs">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-forest-900 text-xs font-black text-limeglow-400">
                        1
                      </span>
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                        Informations principales
                      </h4>
                    </div>

                    {/* Photos : Multi-photos ou Photo simple */}
                    {activeSpec.multiPhotos ? (
                      <MultiImageUploader
                        purpose="product"
                        maxImages={10}
                        label="Photos du produit (jusqu’à 10 photos — POS & Vitrine QR)"
                        hint="La photo #1 est l’image principale affichée sur la vitrine."
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

                    {/* Nom & Prix de vente & Unité */}
                    <div className="grid gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-6">
                        <label className="block text-xs font-semibold text-slate-700">
                          Nom de l'article *
                        </label>
                        <input
                          required
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder={`Ex. ${selectedCategory?.name ? selectedCategory.name.slice(0, -1) : 'Produit'} Nike Air Jordan`}
                          className="sc-input mt-1"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-semibold text-slate-700 whitespace-nowrap">
                          Prix de vente (XOF) *
                        </label>
                        <input
                          type="number"
                          min={0}
                          required
                          value={form.salePriceXof}
                          onChange={(e) =>
                            setForm({ ...form, salePriceXof: Number(e.target.value) })
                          }
                          className="sc-input mt-1 tabular font-bold text-slate-900"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-semibold text-slate-700">
                          Unité de vente
                        </label>
                        <input
                          value={form.unit}
                          onChange={(e) => setForm({ ...form, unit: e.target.value })}
                          className="sc-input mt-1"
                        />
                      </div>
                    </div>

                    {/* Pastilles d'unités suggérées */}
                    {activeSpec.suggestedUnits.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] text-slate-500">Suggestions :</span>
                        {activeSpec.suggestedUnits.map((u) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, unit: u }))}
                            className={`rounded-lg px-2.5 py-0.5 text-[11px] font-bold transition ${form.unit === u
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

                  {/* 2. STOCK & DÉCLINAISONS (TAILLES / POINTURES / COULEURS) */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-forest-900 text-xs font-black text-limeglow-400">
                          2
                        </span>
                        <div>
                          <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                            Stock & Déclinaisons
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            {activeSpec.sizeMode !== 'NONE' || activeSpec.showColors
                              ? 'Gérez un stock distinct pour chaque pointure / taille / couleur, ou un stock unique.'
                              : 'Définissez la quantité physique disponible en magasin.'}
                          </p>
                        </div>
                      </div>
                      {form.variants.length > 0 && (
                        <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-extrabold text-emerald-800">
                          ✨ Total en stock : {form.variants.reduce((acc, v) => acc + (Number(v.initialStockQty) || 0), 0)} {form.unit || activeSpec.defaultUnit}
                        </span>
                      )}
                    </div>

                    {/* Sélecteur Tailles / Pointures / Couleurs */}
                    {(activeSpec.sizeMode !== 'NONE' || activeSpec.showColors) && (
                      <div className="space-y-3 rounded-xl border border-slate-200/80 bg-porcelain-50 p-3.5">
                        {activeSpec.sizeMode !== 'NONE' && (
                          <div className="space-y-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                              <Ruler className="h-3.5 w-3.5 text-brand-700" />
                              {activeSpec.sizeMode === 'SHOES'
                                ? `Pointures disponibles (${form.availableSizes.length})`
                                : activeSpec.sizeMode === 'CLOTHING'
                                  ? `Tailles disponibles (${form.availableSizes.length})`
                                  : `Formats disponibles (${form.availableSizes.length})`}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {presetSizesForActiveSpec.map((size) => {
                                const active = form.availableSizes.includes(size);
                                return (
                                  <button
                                    key={size}
                                    type="button"
                                    onClick={() => toggleSize(size)}
                                    className={`rounded-xl px-2.5 py-1 text-xs font-bold transition ${active
                                      ? 'bg-forest-900 text-limeglow-400 shadow-xs'
                                      : 'border border-slate-200 bg-white text-slate-700 hover:border-brand-400'
                                      }`}
                                  >
                                    {size}
                                  </button>
                                );
                              })}
                              {form.availableSizes
                                .filter((s) => !presetSizesForActiveSpec.includes(s))
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
                            <div className="flex gap-2 pt-1">
                              <input
                                value={customSize}
                                onChange={(e) => setCustomSize(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addCustomSize();
                                  }
                                }}
                                placeholder={
                                  activeSpec.sizeMode === 'SHOES'
                                    ? 'Autre pointure (ex. 35, 47)…'
                                    : activeSpec.sizeMode === 'CLOTHING'
                                      ? 'Autre taille (ex. 4XL, 6 ans)…'
                                      : 'Autre format (ex. 28 pouces, 100 ml)…'
                                }
                                className="sc-input py-1.5 text-xs bg-white"
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
                        )}

                        {activeSpec.showColors && (
                          <div className="space-y-1.5 border-t border-slate-200/80 pt-2.5">
                            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                              <Palette className="h-3.5 w-3.5 text-brand-700" />
                              Couleurs / Teintes disponibles ({form.availableColors.length})
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {PRESET_COLORS.map((c) => {
                                const active = form.availableColors.includes(c.name);
                                return (
                                  <button
                                    key={c.name}
                                    type="button"
                                    onClick={() => toggleColor(c.name)}
                                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition ${active
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
                            <div className="flex gap-2 pt-1">
                              <input
                                value={customColor}
                                onChange={(e) => setCustomColor(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addCustomColor();
                                  }
                                }}
                                placeholder="Autre couleur ou teinte (ex. Caramel, Nude, Bordeaux)…"
                                className="sc-input py-1.5 text-xs bg-white"
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
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5">
                          <p className="text-[11px] text-slate-600">
                            Créez les variantes pour ventiler le stock par pointure ou couleur :
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {form.availableSizes.length > 0 || form.availableColors.length > 0 ? (
                              <button
                                type="button"
                                onClick={generateVariantCombinations}
                                className="inline-flex items-center gap-1 rounded-xl bg-forest-900 px-3 py-1.5 text-xs font-bold text-limeglow-400 hover:bg-forest-800"
                                title="Générer automatiquement toutes les combinaisons"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                ⚡ Générer ({form.availableSizes.length || 1} × {form.availableColors.length || 1} variantes)
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={addManualVariant}
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              + Variante manuelle
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Alerte si le produit dispose de stock principal non encore ventilé sur les variantes */}
                    {editing && form.variants.length > 0 && (() => {
                      const totalVarStock = form.variants.reduce((sum, v) => sum + (v.stockPhysical || 0), 0);
                      const baseStock = Math.max(0, (editing.stockPhysical || 0) - totalVarStock);
                      if (baseStock <= 0) return null;
                      return (
                        <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-3.5 space-y-2">
                          <div className="flex items-center gap-2 text-amber-950 font-extrabold text-xs">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                            <span>Stock principal général à ventiler ({baseStock} {form.unit})</span>
                          </div>
                          <p className="text-[11px] text-amber-900 leading-relaxed">
                            Ce produit dispose de <strong>{baseStock} {form.unit}</strong> enregistrées sur le stock de base global, alors que les <strong>{form.variants.length} variantes</strong> ci-dessous doivent être approvisionnées.
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const count = form.variants.length;
                              const perVar = Math.floor(baseStock / count);
                              let rem = baseStock % count;
                              const nextVars = form.variants.map((v) => {
                                const add = perVar + (rem > 0 ? 1 : 0);
                                if (rem > 0) rem--;
                                const current = v.stockPhysical ?? 0;
                                return {
                                  ...v,
                                  targetStockQty: current + add,
                                  stockPhysical: current + add,
                                };
                              });
                              setForm((f) => ({ ...f, variants: nextVars }));
                              setInfoMsg(
                                `Répartition équitable calculée (+${perVar} par variante = ${baseStock} total). Cliquez sur "Enregistrer les modifications" ci-dessous pour appliquer.`,
                              );
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 shadow-xs"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            ⚡ Répartir automatiquement les {baseStock} {form.unit} sur les {form.variants.length} variantes
                          </button>
                        </div>
                      );
                    })()}

                    {/* Cas 1 : Variantes créées (Ventilation du stock) */}
                    {form.variants.length > 0 ? (
                      <div className="space-y-3">
                        {/* Vue Mobile : Fiches variantes empilées 100% responsive */}
                        <div className="space-y-3 sm:hidden">
                          {form.variants.map((v, vIdx) => (
                            <div
                              key={`vm-${vIdx}`}
                              className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 space-y-2.5 shadow-2xs"
                            >
                              <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-forest-900 px-2.5 py-0.5 text-xs font-bold text-limeglow-400">
                                  Variante #{vIdx + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeVariant(vIdx)}
                                  className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-100"
                                  title="Supprimer la variante"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <div>
                                <label className="text-[11px] font-bold text-slate-700">Nom / Déclinaison *</label>
                                <input
                                  value={v.name}
                                  onChange={(e) => updateVariant(vIdx, { name: e.target.value })}
                                  placeholder="Ex: Taille 42 / Noir"
                                  className="sc-input mt-1 bg-white text-xs font-semibold"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[11px] font-bold text-slate-700">
                                    {editing ? 'Stock physique' : 'Stock initial'}
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={
                                      editing
                                        ? (v.targetStockQty !== undefined ? v.targetStockQty : (v.stockPhysical ?? 0))
                                        : (v.initialStockQty ?? 0)
                                    }
                                    onChange={(e) => {
                                      const val = Number(e.target.value) || 0;
                                      updateVariant(vIdx, {
                                        initialStockQty: val,
                                        targetStockQty: val,
                                        stockPhysical: val,
                                      });
                                    }}
                                    className="sc-input mt-1 bg-white text-center tabular font-extrabold text-emerald-800 text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-bold text-slate-700">Prix vente (XOF)</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={v.salePriceXof}
                                    onChange={(e) =>
                                      updateVariant(vIdx, {
                                        salePriceXof: Number(e.target.value) || 0,
                                      })
                                    }
                                    className="sc-input mt-1 bg-white text-xs font-semibold tabular"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[11px] font-bold text-slate-700">Code EAN-13 / SKU</label>
                                  <input
                                    value={v.barcode || ''}
                                    onChange={(e) =>
                                      updateVariant(vIdx, { barcode: e.target.value })
                                    }
                                    placeholder="Code-barres..."
                                    className="sc-input mt-1 bg-white text-xs font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-bold text-slate-700">Seuil alerte</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={v.alertThreshold}
                                    onChange={(e) =>
                                      updateVariant(vIdx, {
                                        alertThreshold: Number(e.target.value) || 0,
                                      })
                                    }
                                    className="sc-input mt-1 bg-white text-center tabular text-xs font-semibold"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Vue Tablette & Desktop : Table scrollable fluide */}
                        <div className="hidden sm:block overflow-x-auto">
                          <table className="min-w-[620px] w-full divide-y divide-slate-200 text-xs">
                            <thead>
                              <tr className="text-left font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                                <th className="py-2 pr-2">Nom variante</th>
                                <th className="py-2 px-2 text-center w-24">
                                  {editing ? 'Stock phys.' : 'Stock init.'}
                                </th>
                                <th className="py-2 px-2 w-28">Prix vente (XOF)</th>
                                <th className="py-2 px-2">Code-barres EAN-13</th>
                                <th className="py-2 px-2 text-center w-20">Seuil</th>
                                <th className="py-2 pl-2 text-right">Suppr.</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {form.variants.map((v, vIdx) => (
                                <tr key={`v-${vIdx}`}>
                                  <td className="py-2 pr-2">
                                    <input
                                      value={v.name}
                                      onChange={(e) => updateVariant(vIdx, { name: e.target.value })}
                                      placeholder="Ex: Taille M / Noir"
                                      className="sc-input bg-white py-1 text-xs"
                                    />
                                  </td>
                                  <td className="py-2 px-2 w-24">
                                    <input
                                      type="number"
                                      min={0}
                                      value={
                                        editing
                                          ? (v.targetStockQty !== undefined ? v.targetStockQty : (v.stockPhysical ?? 0))
                                          : (v.initialStockQty ?? 0)
                                      }
                                      onChange={(e) => {
                                        const val = Number(e.target.value) || 0;
                                        updateVariant(vIdx, {
                                          initialStockQty: val,
                                          targetStockQty: val,
                                          stockPhysical: val,
                                        });
                                      }}
                                      className="sc-input bg-white py-1 text-center text-xs tabular font-bold text-slate-900"
                                    />
                                  </td>
                                  <td className="py-2 px-2 w-28">
                                    <input
                                      type="number"
                                      min={0}
                                      value={v.salePriceXof}
                                      onChange={(e) =>
                                        updateVariant(vIdx, {
                                          salePriceXof: Number(e.target.value) || 0,
                                        })
                                      }
                                      className="sc-input bg-white py-1 text-xs tabular"
                                    />
                                  </td>
                                  <td className="py-2 px-2">
                                    <input
                                      value={v.barcode || ''}
                                      onChange={(e) =>
                                        updateVariant(vIdx, { barcode: e.target.value })
                                      }
                                      placeholder="EAN-13 auto..."
                                      className="sc-input bg-white py-1 text-xs font-mono"
                                    />
                                  </td>
                                  <td className="py-2 px-2 w-20">
                                    <input
                                      type="number"
                                      min={0}
                                      value={v.alertThreshold}
                                      onChange={(e) =>
                                        updateVariant(vIdx, {
                                          alertThreshold: Number(e.target.value) || 0,
                                        })
                                      }
                                      className="sc-input bg-white py-1 text-center text-xs tabular"
                                    />
                                  </td>
                                  <td className="py-2 pl-2 text-right">
                                    <button
                                      type="button"
                                      onClick={() => removeVariant(vIdx)}
                                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      /* Cas 2 : Aucune variante (Article unique standard) */
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            Article unique (sans déclinaison de pointure ou couleur)
                          </span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {!editing ? (
                            <div>
                              <label className="block text-xs font-semibold text-slate-700">
                                Stock initial disponible ({form.unit || activeSpec.defaultUnit})
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={form.initialStockQty}
                                onChange={(e) =>
                                  setForm({ ...form, initialStockQty: Number(e.target.value) || 0 })
                                }
                                className="sc-input mt-1 bg-white tabular"
                                placeholder="Ex. 180"
                              />
                              <p className="mt-1 text-[11px] text-slate-500">
                                Quantité physique présente actuellement en rayon.
                              </p>
                            </div>
                          ) : null}
                          <div>
                            <label className="block text-xs font-semibold text-slate-700">
                              Seuil d'alerte stock bas ({form.unit || activeSpec.defaultUnit})
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={form.alertThreshold}
                              onChange={(e) =>
                                setForm({ ...form, alertThreshold: Number(e.target.value) || 0 })
                              }
                              className="sc-input mt-1 bg-white tabular"
                            />
                            <p className="mt-1 text-[11px] text-slate-500">
                              Alerte automatique quand le stock descend sous cette limite.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. OPTIONS AVANCÉES (ACCORDÉON REPLIABLE) */}
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex w-full items-center justify-between p-3.5 bg-slate-50/80 hover:bg-slate-100/80 transition text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 text-slate-700">
                          <Settings className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                            ⚙️ Options avancées
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            Code-barres, Coût d’achat, SKU manuel, Gros & Détail, DLC, Garantie...
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-brand-700">
                        <span>{showAdvanced ? 'Masquer' : 'Afficher'}</span>
                        {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>

                    {showAdvanced && (
                      <div className="p-4 border-t border-slate-100 space-y-4">
                        {/* Coût d'achat (propriétaire/finance uniquement) & Code-barres & SKU */}
                        <div className={`grid gap-3 ${canReadCost ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                          {canReadCost ? (
                            <div>
                              <label className="block text-xs font-semibold text-slate-700">
                                Coût d’achat (XOF)
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={form.costPriceXof}
                                onChange={(e) => setForm({ ...form, costPriceXof: e.target.value })}
                                placeholder="Optionnel (pour marge brute)"
                                className="sc-input mt-1 tabular"
                              />
                            </div>
                          ) : null}

                          <div>
                            <div className="flex items-center justify-between gap-1">
                              <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                                Code-barres (EAN-13)
                              </label>
                              {!editing ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBarcodeManual(false);
                                    setCodeSeed(Math.floor(1000 + Math.random() * 9000));
                                  }}
                                  className="text-[10px] font-bold text-brand-700 hover:underline whitespace-nowrap"
                                >
                                  Regénérer
                                </button>
                              ) : null}
                            </div>
                            <input
                              value={form.barcode}
                              onChange={(e) => {
                                setBarcodeManual(true);
                                setForm({ ...form, barcode: e.target.value });
                              }}
                              placeholder="Auto EAN-13…"
                              className="sc-input mt-1 font-mono"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between gap-1">
                              <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                                SKU / Référence
                              </label>
                              {!editing ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSkuManual(false);
                                    setCodeSeed(Math.floor(1000 + Math.random() * 9000));
                                  }}
                                  className="text-[10px] font-bold text-brand-700 hover:underline whitespace-nowrap"
                                >
                                  Regénérer
                                </button>
                              ) : null}
                            </div>
                            <input
                              required
                              value={form.sku}
                              onChange={(e) => {
                                setSkuManual(true);
                                setForm({ ...form, sku: e.target.value });
                              }}
                              placeholder="Généré auto…"
                              className="sc-input mt-1 font-mono"
                            />
                          </div>
                        </div>

                        {/* Marque / Modèle / Contenance (si applicable) */}
                        {activeSpec.showBrand || activeSpec.showModel || activeSpec.showVolumeDimension ? (
                          <div className="grid gap-3 rounded-xl border border-slate-200 bg-porcelain-50 p-3 sm:grid-cols-3">
                            {activeSpec.showBrand ? (
                              <div>
                                <label className="block text-xs font-semibold text-slate-700">
                                  Marque
                                </label>
                                <input
                                  value={form.brand}
                                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                                  placeholder="Ex. Nike, Adidas, Zara…"
                                  className="sc-input mt-1 bg-white"
                                />
                              </div>
                            ) : null}
                            {activeSpec.showModel ? (
                              <div>
                                <label className="block text-xs font-semibold text-slate-700">
                                  {activeSpec.modelLabel || 'Modèle / Série'}
                                </label>
                                <input
                                  value={form.modelName}
                                  onChange={(e) => setForm({ ...form, modelName: e.target.value })}
                                  placeholder="Ex. Air Jordan 4…"
                                  className="sc-input mt-1 bg-white"
                                />
                              </div>
                            ) : null}
                            {activeSpec.showVolumeDimension ? (
                              <div>
                                <label className="block text-xs font-semibold text-slate-700">
                                  {activeSpec.volumeLabelTitle || 'Contenance / Format'}
                                </label>
                                <input
                                  value={form.volumeLabel}
                                  onChange={(e) => setForm({ ...form, volumeLabel: e.target.value })}
                                  placeholder={activeSpec.volumePlaceholder || 'Ex. 250 ml, 500 g…'}
                                  className="sc-input mt-1 bg-white"
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Description */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-700">
                            Description du produit
                          </label>
                          <textarea
                            rows={2}
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            placeholder="Détails, composition ou caractéristiques utiles aux clients…"
                            className="sc-input mt-1"
                          />
                        </div>

                        {/* Statut vitrine & Épingler caisse */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700">
                              Statut vitrine
                            </label>
                            <select
                              value={form.status}
                              onChange={(e) =>
                                setForm({ ...form, status: e.target.value as ProductStatus })
                              }
                              className="sc-input mt-1 bg-white"
                            >
                              {PRODUCT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {PRODUCT_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </div>

                          {activeSpec.showPosFavoriteToggle ? (
                            <div className="flex items-end">
                              <label className="flex w-full items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/50 p-2.5 text-xs font-semibold text-slate-800">
                                <input
                                  type="checkbox"
                                  checked={form.isPinnedPos}
                                  onChange={(e) =>
                                    setForm({ ...form, isPinnedPos: e.target.checked })
                                  }
                                  className="h-4 w-4 accent-brand-700"
                                />
                                <span className="flex items-center gap-1.5">
                                  <Pin className="h-3.5 w-3.5 text-amber-700" />
                                  Épingler en haut de caisse POS Express
                                </span>
                              </label>
                            </div>
                          ) : null}
                        </div>

                        {/* Vente au montant / fraction */}
                        {activeSpec.showAmountFractionalSale ? (
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
                              Autoriser la vente au montant / fraction (ex. 250 F de{' '}
                              {form.name || selectedCategory?.name || 'produit'})
                            </span>
                          </label>
                        ) : null}

                        {/* Conditionnement Gros ↔ Détail */}
                        {activeSpec.showBulkPackaging ? (
                          <div className="space-y-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3.5">
                            <span className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-950">
                              <Boxes className="h-3.5 w-3.5 text-brand-700" />
                              Vente en Gros & Détail ({activeSpec.defaultBulkUnitLabel || 'carton / sac / douzaine'} — optionnel)
                            </span>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-700">
                                  Unité de gros
                                </label>
                                <input
                                  value={form.bulkUnitLabel}
                                  onChange={(e) => setForm({ ...form, bulkUnitLabel: e.target.value })}
                                  placeholder={`Ex. ${activeSpec.defaultBulkUnitLabel || 'carton, sac, douzaine'}`}
                                  className="sc-input mt-1 bg-white py-1.5 text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-700">
                                  Nb de ({form.unit || activeSpec.defaultUnit}) par{' '}
                                  {form.bulkUnitLabel || activeSpec.defaultBulkUnitLabel || 'gros'}
                                </label>
                                <input
                                  type="number"
                                  min={2}
                                  value={form.unitsPerBulk}
                                  onChange={(e) => setForm({ ...form, unitsPerBulk: e.target.value })}
                                  placeholder="Ex. 12, 24 ou 50"
                                  className="sc-input mt-1 bg-white py-1.5 text-xs tabular"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-slate-700">
                                  Prix du {form.bulkUnitLabel || activeSpec.defaultBulkUnitLabel || 'gros'} (XOF)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  value={form.bulkSalePriceXof}
                                  onChange={(e) =>
                                    setForm({ ...form, bulkSalePriceXof: e.target.value })
                                  }
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

                        {/* Date de péremption & Lots */}
                        {activeSpec.showExpiryDlc ? (
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

                        {/* Garantie & N° série */}
                        {activeSpec.showWarranty || activeSpec.showSerialNumber ? (
                          <div className="grid gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3.5 sm:grid-cols-2">
                            {activeSpec.showWarranty ? (
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
                                  onChange={(e) =>
                                    setForm({ ...form, warrantyMonths: e.target.value })
                                  }
                                  placeholder="Ex. 12 (imprimé sur ticket & facture PDF)"
                                  className="sc-input mt-1 bg-white py-1.5 text-xs tabular"
                                />
                              </div>
                            ) : null}
                            {activeSpec.showSerialNumber ? (
                              <label className="mt-4 flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-white p-2.5 text-xs font-semibold text-slate-800">
                                <input
                                  type="checkbox"
                                  checked={form.trackSerialNumber}
                                  onChange={(e) =>
                                    setForm({ ...form, trackSerialNumber: e.target.checked })
                                  }
                                  className="h-4 w-4 accent-brand-700"
                                />
                                <span>
                                  Exiger la saisie du{' '}
                                  <strong>{activeSpec.serialLabel || 'N° de série / IMEI'}</strong> lors
                                  de la vente POS
                                </span>
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                    {editing && canDelete ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDeleteTarget(editing);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        Supprimer ce produit
                      </button>
                    ) : <div />}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setModalOpen(false)}
                        className="sc-btn-ghost"
                      >
                        Annuler
                      </button>
                      <button type="submit" disabled={busy} className="sc-btn-primary">
                        {busy
                          ? 'Enregistrement…'
                          : editing
                            ? 'Enregistrer les modifications'
                            : 'Créer le produit'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : null}

        {/* Modal Demande d'ajout d'un nouveau type de boutique au Super Admin */}
        {requestTypeOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">
                    Demander l’ajout d’un nouveau type / rayon au Super Admin
                  </h2>
                  <p className="text-xs text-slate-500">
                    Vous souhaitez vendre une nouvelle famille de produits ? Envoyez la demande en 1 clic au Super Admin.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequestTypeOpen(false)}
                  className="rounded-xl p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleRequestShopType} className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {SHOP_TYPES.map((t) => {
                    const alreadyActive = enabledShopTypes.includes(t);
                    const selected = requestedShopType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={alreadyActive}
                        onClick={() => setRequestedShopType(t)}
                        className={`rounded-xl border p-2.5 text-left transition ${alreadyActive
                          ? 'cursor-not-allowed border-emerald-200 bg-emerald-50/60 text-emerald-800 opacity-75'
                          : selected
                            ? 'border-forest-900 bg-forest-900 text-white shadow-xs'
                            : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-brand-400'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-extrabold">{SHOP_TYPE_SHORT_LABELS[t]}</p>
                          {alreadyActive ? (
                            <span className="rounded-full bg-emerald-200 px-1.5 py-0.5 text-[9px] font-black text-emerald-950">
                              Actif
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={`mt-0.5 line-clamp-2 text-[10px] leading-snug ${selected && !alreadyActive ? 'text-emerald-100/85' : 'text-slate-500'
                            }`}
                        >
                          {SHOP_TYPE_DESCRIPTIONS[t]}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Message pour le Super Admin (optionnel)
                  </label>
                  <textarea
                    rows={2}
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder="Ex. Je souhaite ajouter un rayon vêtements & chaussures à ma boutique…"
                    className="sc-input mt-1 text-xs"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRequestTypeOpen(false)}
                    className="sc-btn-ghost text-xs"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {busy ? 'Envoi…' : 'Envoyer la demande'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
        {/* Modal d'impression et prévisualisation d'étiquettes code-barres EAN-13 */}
        {barcodeTarget ? (
          <BarcodeLabelsModal
            open={true}
            shopName={activeShop?.shopName ?? ''}
            onClose={() => setBarcodeTarget(null)}
            items={[
              // Produit de base s'il a un code-barres
              ...(barcodeTarget.barcode
                ? [{
                    id: barcodeTarget.id,
                    name: barcodeTarget.name,
                    sku: barcodeTarget.sku,
                    barcode: barcodeTarget.barcode,
                    salePriceXof: barcodeTarget.salePriceXof,
                  }]
                : []),
              // Variantes avec code-barres
              ...(barcodeTarget.variants ?? [])
                .filter((v) => v.barcode)
                .map((v) => ({
                  id: v.id ?? `${barcodeTarget.id}_${v.name}`,
                  name: barcodeTarget.name,
                  variantName: v.name,
                  sku: v.sku ?? barcodeTarget.sku,
                  barcode: v.barcode!,
                  salePriceXof: v.salePriceXof ?? barcodeTarget.salePriceXof,
                })),
            ]}
          />
        ) : null}

        {/* Modal d'aperçu rapide fiche produit (Point 8) */}
        {previewProduct ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-3 backdrop-blur-xs sm:p-4">
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6 space-y-4">
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  {previewProduct.imageUrls?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewProduct.imageUrls[0]}
                      alt={previewProduct.name}
                      className="h-14 w-14 rounded-2xl border border-slate-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                      <Package className="h-7 w-7" />
                    </div>
                  )}
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-extrabold text-slate-900 sm:text-lg">
                        {previewProduct.name}
                      </h2>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          previewProduct.status === 'PUBLISHED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : previewProduct.status === 'DRAFT'
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {PRODUCT_STATUS_LABELS[previewProduct.status]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      <code className="font-mono text-slate-700">{previewProduct.sku}</code>
                      {previewProduct.categoryName ? ` · Rayon : ${previewProduct.categoryName}` : ''}
                      {previewProduct.barcode ? ` · Code : ${previewProduct.barcode}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewProduct(null)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Cartes métriques */}
              <div className={`grid gap-2.5 ${canReadCost ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div className="rounded-2xl border border-slate-200 bg-porcelain-50 p-3 text-center">
                  <p className="text-[11px] font-semibold text-slate-500">Prix de vente</p>
                  <p className="text-base font-extrabold text-slate-900 tabular">
                    {formatXof(previewProduct.salePriceXof)}
                  </p>
                </div>
                {canReadCost ? (
                  <div className="rounded-2xl border border-slate-200 bg-porcelain-50 p-3 text-center">
                    <p className="text-[11px] font-semibold text-slate-500">Coût d'achat (CMP)</p>
                    <p className="text-base font-semibold text-slate-700 tabular">
                      {previewProduct.costPriceXof !== null ? formatXof(previewProduct.costPriceXof) : 'Estimé'}
                    </p>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-slate-200 bg-porcelain-50 p-3 text-center">
                  <p className="text-[11px] font-semibold text-slate-500">Stock disponible</p>
                  <p
                    className={`text-base font-extrabold tabular ${
                      previewProduct.stockAvailable <= 0
                        ? 'text-rose-600'
                        : previewProduct.stockAvailable <= previewProduct.alertThreshold
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                    }`}
                  >
                    {previewProduct.stockAvailableDecimal ?? previewProduct.stockAvailable} {previewProduct.unit}
                  </p>
                </div>
              </div>

              {/* Variantes détaillées */}
              {previewProduct.variants && previewProduct.variants.length > 0 ? (
                <div className="rounded-2xl border border-slate-200 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-900">
                      Déclinaisons & Variantes ({previewProduct.variants.length})
                    </span>
                    {canWrite &&
                    previewProduct.stockPhysical > 0 &&
                    previewProduct.variants.every((v) => (v.stockPhysical || 0) === 0) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAutoVentilate(previewProduct)}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-bold text-white hover:bg-amber-600 shadow-2xs"
                      >
                        <Sparkles className="h-3 w-3" />
                        Ventiler {previewProduct.stockPhysical} {previewProduct.unit}
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 text-xs">
                    {previewProduct.variants.map((v, i) => (
                      <div key={v.id || i} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-slate-800 truncate">{v.name}</p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            {v.sku || 'SKU auto'} {v.barcode ? `· ${v.barcode}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={`font-extrabold tabular ${
                              (v.stockPhysical || 0) <= (v.alertThreshold || 0)
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {v.stockPhysical ?? 0} en stock
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Seuil alerte : {v.alertThreshold ?? 5}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Caractéristiques sectorielles */}
              <div className="grid grid-cols-2 gap-2 text-xs rounded-2xl bg-slate-50 p-3">
                {previewProduct.brand ? (
                  <div>
                    <span className="text-slate-400">Marque :</span>{' '}
                    <strong className="text-slate-800">{previewProduct.brand}</strong>
                  </div>
                ) : null}
                {previewProduct.modelName ? (
                  <div>
                    <span className="text-slate-400">Modèle :</span>{' '}
                    <strong className="text-slate-800">{previewProduct.modelName}</strong>
                  </div>
                ) : null}
                {previewProduct.volumeLabel ? (
                  <div>
                    <span className="text-slate-400">Contenance :</span>{' '}
                    <strong className="text-slate-800">{previewProduct.volumeLabel}</strong>
                  </div>
                ) : null}
                {previewProduct.bulkUnitLabel ? (
                  <div>
                    <span className="text-slate-400">Conditionnement :</span>{' '}
                    <strong className="text-slate-800">
                      {previewProduct.bulkUnitLabel} ×{previewProduct.unitsPerBulk}
                    </strong>
                  </div>
                ) : null}
                {previewProduct.expiryDate ? (
                  <div>
                    <span className="text-slate-400">DLC :</span>{' '}
                    <strong className="text-amber-800">
                      {new Date(previewProduct.expiryDate).toLocaleDateString('fr-FR')}
                    </strong>
                  </div>
                ) : null}
                {previewProduct.warrantyMonths ? (
                  <div>
                    <span className="text-slate-400">Garantie :</span>{' '}
                    <strong className="text-indigo-800">{previewProduct.warrantyMonths} mois</strong>
                  </div>
                ) : null}
                {previewProduct.description ? (
                  <div className="col-span-2 pt-1 text-slate-600 border-t border-slate-200 mt-1">
                    {previewProduct.description}
                  </div>
                ) : null}
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => {
                      const p = previewProduct;
                      setPreviewProduct(null);
                      setDeleteTarget(p);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    Supprimer
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const p = previewProduct;
                      setPreviewProduct(null);
                      setBarcodeTarget(p);
                    }}
                    className="sc-btn-ghost py-2 text-xs"
                  >
                    <Printer className="h-4 w-4" />
                    Étiquettes
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        const p = previewProduct;
                        setPreviewProduct(null);
                        openEdit(p);
                      }}
                      className="sc-btn-primary py-2 text-xs"
                    >
                      <Pencil className="h-4 w-4" />
                      Modifier
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal de confirmation de suppression / archivage */}
        {deleteTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
                  <Trash2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Supprimer le produit</h3>
                  <p className="text-xs text-slate-500">Action sécurisée avec conservation comptable</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Êtes-vous sûr de vouloir supprimer le produit{' '}
                <strong className="text-slate-900 font-bold">« {deleteTarget.name} »</strong> ({deleteTarget.sku}) ?
              </p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">Règle de gestion :</p>
                <p>
                  • Si ce produit n’a jamais été vendu : il sera <strong>définitivement supprimé</strong> de votre base.
                </p>
                <p>
                  • S’il a déjà des ventes enregistrées : il sera <strong>archivé</strong> (masqué de la caisse tout en préservant l’intégrité de vos rapports financiers).
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleteTarget(null)}
                  className="sc-btn-ghost"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDeleteProduct(deleteTarget)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 shadow-xs disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {busy ? 'Suppression…' : 'Confirmer la suppression'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
