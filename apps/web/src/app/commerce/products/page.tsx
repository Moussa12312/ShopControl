'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { BarcodeLabelsModal } from '@/components/commerce/BarcodeLabelsModal';
import { ImageUploader, MultiImageUploader } from '@/components/ui/ImageUploader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

const PRESET_CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Taille unique'];
const PRESET_SHOE_SIZES = ['21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];
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
  const canWrite = isOwner || Boolean(activeShop?.permissions['products:create']);
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
  const [codeSeed, setCodeSeed] = useState(() => Math.floor(1000 + Math.random() * 9000));
  const [barcodeTarget, setBarcodeTarget] = useState<ProductRow | null>(null);

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
    setCodeSeed(Math.floor(1000 + Math.random() * 9000));
    setForm({
      name: '',
      sku: '',
      barcode: '',
      description: '',
      categoryId: '',
      unit: 'pièce',
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
    setModalStep('PICK_CATEGORY');
    setModalOpen(true);
  };

  const openEdit = (p: ProductRow) => {
    setEditing(p);
    setFormErr(null);
    setCustomSize('');
    setCustomColor('');
    setSkuManual(true);
    setBarcodeManual(true);
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
                id: v.id,
                name: v.name.trim(),
                sku: v.sku?.trim() || undefined,
                barcode: v.barcode?.trim() || undefined,
                salePriceXof: Math.round(Number(v.salePriceXof) || form.salePriceXof || 0),
                costPriceXof:
                  v.costPriceXof !== undefined && v.costPriceXof !== null && String(v.costPriceXof).trim() !== ''
                    ? Math.round(Number(v.costPriceXof))
                    : null,
                alertThreshold: Math.round(Number(v.alertThreshold) || form.alertThreshold || 0),
                initialStockQty: Math.max(0, Math.round(Number(v.initialStockQty) || 0)),
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

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setBarcodeTarget(p)}
                        className="sc-btn-ghost flex-1 py-2 text-xs"
                        title="Imprimer ou prévisualiser les étiquettes code-barres"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Étiquettes
                      </button>
                      {canWrite ? (
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="sc-btn-ghost flex-1 py-2 text-xs"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Modifier
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tableau desktop (>= md) */}
            <div className="sc-card hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-porcelain-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3.5 whitespace-nowrap">Produit & Catégorie</th>
                    <th className="px-4 py-3.5">Caractéristiques</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">Prix vente</th>
                    {canReadCost ? <th className="px-4 py-3.5 whitespace-nowrap">Coût (CMP)</th> : null}
                    <th className="px-4 py-3.5 whitespace-nowrap">Stock dispo</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">Vitrine</th>
                    {canWrite ? <th className="px-4 py-3.5 text-right whitespace-nowrap">Action</th> : null}
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
                                {p.variants && p.variants.length > 0 ? (
                                  <span className="rounded-full bg-forest-900 px-2 py-0.5 text-[9px] font-extrabold text-limeglow-400">
                                    {p.variants.length} variantes
                                  </span>
                                ) : null}
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
                                    Garantie {p.warrantyMonths} mois
                                    {p.trackSerialNumber ? ' · Série/IMEI' : ''}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {sizes.length === 0 && colors.length === 0 ? (
                            <span className="text-xs text-slate-400">
                              Unité : <strong>{p.unit}</strong>
                            </span>
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
                                    <span className="text-[10px] text-slate-400">
                                      +{sizes.length - 5}
                                    </span>
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
                        {canWrite ? (
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setBarcodeTarget(p)}
                                className="sc-btn-ghost px-2.5 py-1.5 text-xs"
                                title="Imprimer les étiquettes code-barres"
                              >
                                <Printer className="h-3.5 w-3.5" />
                                Étiquettes
                              </button>
                              <button
                                type="button"
                                onClick={() => openEdit(p)}
                                className="sc-btn-ghost px-3 py-1.5 text-xs"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Modifier
                              </button>
                            </div>
                          </td>
                        ) : (
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setBarcodeTarget(p)}
                              className="sc-btn-ghost px-2.5 py-1.5 text-xs"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Étiquettes
                            </button>
                          </td>
                        )}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-3 backdrop-blur-xs sm:p-4">
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
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
                /* ÉTAPE 2 : FORMULAIRE PRODUIT 100 % PILOTÉ PAR LA CATÉGORIE CHOISIE */
                <form onSubmit={handleSave} className="mt-4 space-y-4">
                  {/* Bandeau récapitulatif de la catégorie choisie + bouton Changer de catégorie */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-forest-950 px-4 py-3 text-white">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-200">
                          Catégorie :
                        </span>
                        <span className="text-sm font-extrabold text-white">
                          {selectedCategory?.name || 'Non classé'}
                        </span>
                        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold text-limeglow-400">
                          {activeSpec.shortLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-emerald-100/80">
                        {activeSpec.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setModalStep('PICK_CATEGORY')}
                      className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-bold text-limeglow-400 hover:bg-white/20"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Changer de catégorie
                    </button>
                  </div>

                  {/* 1. IDENTITÉ DU PRODUIT */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5 shadow-2xs">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-forest-900 text-xs font-black text-limeglow-400">
                        1
                      </span>
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                        Identité du produit
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

                    {/* Nom & SKU */}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700">
                          Nom du produit *
                        </label>
                        <input
                          required
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder={`Ex. Produit de ${selectedCategory?.name || 'la catégorie'}`}
                          className="sc-input mt-1"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
                            <span>SKU / Référence *</span>
                            {!editing && !skuManual ? (
                              <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[9px] font-extrabold text-emerald-800 whitespace-nowrap">
                                Auto
                              </span>
                            ) : null}
                          </label>
                          {!editing ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSkuManual(false);
                                setCodeSeed(Math.floor(1000 + Math.random() * 9000));
                              }}
                              className="inline-flex !min-h-0 items-center gap-1 text-[10px] font-bold text-brand-700 hover:underline whitespace-nowrap"
                            >
                              <RefreshCw className="h-3 w-3" />
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
                          placeholder="Générée automatiquement…"
                          className="sc-input mt-1 font-mono"
                        />
                      </div>
                    </div>

                    {/* Marque / Modèle / Contenance-Dimension (si applicable) */}
                    {activeSpec.showBrand || activeSpec.showModel || activeSpec.showVolumeDimension ? (
                      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5 sm:grid-cols-3">
                        {activeSpec.showBrand ? (
                          <div>
                            <label className="block text-xs font-semibold text-slate-700">
                              Marque
                            </label>
                            <input
                              value={form.brand}
                              onChange={(e) => setForm({ ...form, brand: e.target.value })}
                              placeholder="Ex. Nivea, Samsung, Nike, Toyota…"
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
                              placeholder="Ex. Référence ou modèle…"
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
                        Description (affichée sur la fiche produit et la vitrine QR)
                      </label>
                      <textarea
                        rows={2}
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="Détails, composition ou caractéristiques utiles aux clients…"
                        className="sc-input mt-1"
                      />
                    </div>
                  </div>

                  {/* 2. PRIX & VENTE */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5 shadow-2xs">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-forest-900 text-xs font-black text-limeglow-400">
                        2
                      </span>
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                        Prix & Vente
                      </h4>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Prix de vente par {form.unit || activeSpec.defaultUnit} (XOF) *
                        </label>
                        <input
                          type="number"
                          min={0}
                          required
                          value={form.salePriceXof}
                          onChange={(e) =>
                            setForm({ ...form, salePriceXof: Number(e.target.value) })
                          }
                          className="sc-input mt-1 tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Coût d’achat par {form.unit || activeSpec.defaultUnit} (XOF)
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
                        <label className="block text-xs font-semibold text-slate-700">
                          Unité de vente
                        </label>
                        <input
                          value={form.unit}
                          onChange={(e) => setForm({ ...form, unit: e.target.value })}
                          className="sc-input mt-1"
                        />
                        {activeSpec.suggestedUnits.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {activeSpec.suggestedUnits.map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() => setForm((f) => ({ ...f, unit: u }))}
                                className={`rounded-lg px-2 py-0.5 text-[10px] font-bold transition ${form.unit === u
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
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
                            <span>Code-barres (EAN-13)</span>
                            {!editing && !barcodeManual ? (
                              <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[9px] font-extrabold text-emerald-800 whitespace-nowrap">
                                Auto
                              </span>
                            ) : null}
                          </label>
                          {!editing ? (
                            <button
                              type="button"
                              onClick={() => {
                                setBarcodeManual(false);
                                setCodeSeed(Math.floor(1000 + Math.random() * 9000));
                              }}
                              className="inline-flex !min-h-0 items-center gap-1 text-[10px] font-bold text-brand-700 hover:underline whitespace-nowrap"
                            >
                              <RefreshCw className="h-3 w-3" />
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
                          placeholder="Généré auto ou scan…"
                          className="sc-input mt-1 font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 3. STOCK & DÉCLINAISONS (TAILLES / POINTURES / COULEURS) */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-forest-900 text-xs font-black text-limeglow-400">
                          3
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

                    {/* Cas 1 : Variantes créées (Ventilation du stock) */}
                    {form.variants.length > 0 ? (
                      <div className="space-y-3">
                        {/* Vue Mobile : Fiches variantes empilées */}
                        <div className="space-y-2.5 sm:hidden">
                          {form.variants.map((v, vIdx) => (
                            <div
                              key={`vm-${vIdx}`}
                              className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 shadow-2xs"
                            >
                              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                                <span className="text-xs font-bold text-slate-800">
                                  Variante #{vIdx + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeVariant(vIdx)}
                                  className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                  title="Supprimer la variante"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <div>
                                <label className="text-[11px] font-semibold text-slate-600">Nom variante</label>
                                <input
                                  value={v.name}
                                  onChange={(e) => updateVariant(vIdx, { name: e.target.value })}
                                  placeholder="Ex: Taille 42 / Noir"
                                  className="sc-input mt-0.5 bg-slate-50 py-1.5 text-xs"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {!editing ? (
                                  <div>
                                    <label className="text-[11px] font-semibold text-slate-600">Stock initial</label>
                                    <input
                                      type="number"
                                      min={0}
                                      value={v.initialStockQty ?? 0}
                                      onChange={(e) =>
                                        updateVariant(vIdx, {
                                          initialStockQty: Number(e.target.value) || 0,
                                        })
                                      }
                                      className="sc-input mt-0.5 bg-slate-50 py-1.5 text-xs text-center tabular"
                                    />
                                  </div>
                                ) : null}
                                <div className={editing ? 'col-span-2' : ''}>
                                  <label className="text-[11px] font-semibold text-slate-600">Prix vente (XOF)</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={v.salePriceXof}
                                    onChange={(e) =>
                                      updateVariant(vIdx, {
                                        salePriceXof: Number(e.target.value) || 0,
                                      })
                                    }
                                    className="sc-input mt-0.5 bg-slate-50 py-1.5 text-xs tabular"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                  <label className="text-[11px] font-semibold text-slate-600">Code EAN-13</label>
                                  <input
                                    value={v.barcode || ''}
                                    onChange={(e) =>
                                      updateVariant(vIdx, { barcode: e.target.value })
                                    }
                                    placeholder="Auto EAN-13..."
                                    className="sc-input mt-0.5 bg-slate-50 py-1.5 text-xs font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-semibold text-slate-600">Seuil alerte</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={v.alertThreshold}
                                    onChange={(e) =>
                                      updateVariant(vIdx, {
                                        alertThreshold: Number(e.target.value) || 0,
                                      })
                                    }
                                    className="sc-input mt-0.5 bg-slate-50 py-1.5 text-xs text-center tabular"
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
                                {!editing ? <th className="py-2 px-2 text-center w-24">Stock init.</th> : null}
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
                                  {!editing ? (
                                    <td className="py-2 px-2 w-24">
                                      <input
                                        type="number"
                                        min={0}
                                        value={v.initialStockQty ?? 0}
                                        onChange={(e) =>
                                          updateVariant(vIdx, {
                                            initialStockQty: Number(e.target.value) || 0,
                                          })
                                        }
                                        className="sc-input bg-white py-1 text-center text-xs tabular"
                                      />
                                    </td>
                                  ) : null}
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

                  {/* 4. PARAMÈTRES & VITRINE */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3.5 shadow-2xs">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-forest-900 text-xs font-black text-limeglow-400">
                        4
                      </span>
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                        Paramètres & Vitrine
                      </h4>
                    </div>

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

                  <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
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
                          ? 'Mettre à jour'
                          : 'Créer le produit'}
                    </button>
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
      </div>
    </AppShell>
  );
}
