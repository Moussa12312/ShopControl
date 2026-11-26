'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Layers,
  Package,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  ShoppingCart,
  Tag,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import {
  formatDateTimeInTimezone,
  formatXof,
  STOCK_MOVEMENT_LABELS,
  StockMovementType,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import {
  BarcodeLabelsModal,
  BarcodePrintItem,
} from '@/components/commerce/BarcodeLabelsModal';
import { BarcodeScannerModal } from '@/components/commerce/BarcodeScannerModal';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface StockAlert {
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  name: string;
  sku: string;
  categoryName?: string | null;
  unit: string;
  costPriceXof: number | null;
  salePriceXof: number;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
  alertThreshold: number;
  severity: 'NEGATIVE_CONFLICT' | 'OUT_OF_STOCK' | 'LOW_STOCK';
}

interface ValuationVariant {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  salePriceXof: number;
  costPriceXof: number | null;
  alertThreshold: number;
  stockPhysical: number;
  stockReserved: number;
  stockAvailable: number;
  stockStatus: string;
  retailValueXof: number;
  costValueXof: number | null;
  estimatedMarginXof: number | null;
}

interface ValuationItem {
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  salePriceXof: number;
  costPriceXof: number | null;
  alertThreshold: number;
  stockPhysical: number;
  stockReserved: number;
  stockAvailable: number;
  stockStatus: string;
  retailValueXof: number;
  costValueXof: number | null;
  estimatedMarginXof: number | null;
  hasVariants: boolean;
  variants: ValuationVariant[];
}

interface ValuationResponse {
  canReadCost: boolean;
  categories: Array<{ id: string; name: string }>;
  summary: {
    totalProductsCount: number;
    totalVariantsCount: number;
    totalUnitsPhysical: number;
    totalUnitsReserved: number;
    totalUnitsAvailable: number;
    totalRetailValueXof: number;
    totalCostValueXof: number | null;
    totalEstimatedMarginXof: number | null;
    lowStockCount: number;
    outOfStockCount: number;
    unitsBreakdown?: Array<{
      unit: string;
      available: number;
      physical: number;
      productsCount: number;
    }>;
  };
  items: ValuationItem[];
}

interface MovementRow {
  id: string;
  productId: string;
  productName: string;
  variantId?: string | null;
  variantName?: string | null;
  sku: string;
  unit: string;
  movementType: StockMovementType;
  quantityDelta: number;
  qtyBefore: number;
  qtyAfter: number;
  unitCostXof?: number | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  declaredOperatorName: string | null;
  createdAt: string;
}

interface SupplierOpt {
  id: string;
  name: string;
  phone: string | null;
  suppliedProducts: string | null;
}

interface ExpiryItem {
  batchId: string | null;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  batchNumber: string | null;
  expiryDate: string;
  remainingQty: number;
  initialQty: number;
  daysRemaining: number;
  severity: 'EXPIRED' | 'EXPIRING_7D' | 'EXPIRING_30D' | 'OK';
  estimatedLossCostXof: number;
  notes: string | null;
}

interface ExpiryAlertsResponse {
  summary: {
    expiredCount: number;
    expiring7dCount: number;
    expiring30dCount: number;
    totalTrackedBatches: number;
    expiredEstimatedCostXof: number;
  };
  items: ExpiryItem[];
}

interface InventorySessionRow {
  id: string;
  sessionNumber: string;
  reason: string;
  status: string;
  totalItemsChecked: number;
  discrepanciesCount: number;
  totalLossXof: number | null;
  totalGainXof: number | null;
  netVarianceXof: number | null;
  declaredOperatorName: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    productId: string;
    variantId?: string | null;
    productName: string;
    sku: string;
    expectedQty: number;
    countedQty: number;
    varianceQty: number;
    unitCostXof: number | null;
    varianceValueXof: number | null;
  }>;
}

export default function StockPage() {
  const { activeOperator } = useAuth();
  const { shopId, activeShop, selectShop, isOwner } = useActiveOperationalShop();

  // Navigation par onglets fluide
  const [tab, setTab] = useState<'valuation' | 'movements' | 'adjust' | 'inventory' | 'expiry' | 'sessions'>(
    'valuation',
  );

  const [valuationData, setValuationData] = useState<ValuationResponse | null>(null);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [expiryData, setExpiryData] = useState<ExpiryAlertsResponse | null>(null);
  const [inventorySessions, setInventorySessions] = useState<InventorySessionRow[]>([]);

  // Filtres onglet État & Valeur
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockStatusFilter, setStockStatusFilter] = useState('ALL');
  const [unitFilter, setUnitFilter] = useState('ALL');
  const [expandedVariants, setExpandedVariants] = useState<Record<string, boolean>>({});

  // Filtres onglet Mouvements
  const [mvtSearch, setMvtSearch] = useState('');
  const [mvtTypeFilter, setMvtTypeFilter] = useState('');

  // Modales
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<'adjust' | 'inventory'>('adjust');
  const [barcodeLabelsOpen, setBarcodeLabelsOpen] = useState(false);
  const [barcodeLabelsItems, setBarcodeLabelsItems] = useState<BarcodePrintItem[]>([]);

  // Modal Réapprovisionnement rapide 1-clic
  const [quickRestockOpen, setQuickRestockOpen] = useState(false);
  const [restockProduct, setRestockProduct] = useState<{
    productId: string;
    variantId?: string | null;
    name: string;
    sku: string;
    suggestedQty: number;
    unitCost: number;
  } | null>(null);
  const [restockSupplierId, setRestockSupplierId] = useState('');
  const [restockQty, setRestockQty] = useState(10);
  const [restockCost, setRestockCost] = useState(1000);
  const [restockNotes, setRestockNotes] = useState('');

  // Formulaire Correction
  const [adjProductId, setAdjProductId] = useState('');
  const [adjVariantId, setAdjVariantId] = useState('');
  const [adjType, setAdjType] = useState<
    'INVENTORY_ADJUSTMENT' | 'MANUAL_IN' | 'MANUAL_OUT' | 'RETURN_DAMAGED_LOSS'
  >('INVENTORY_ADJUSTMENT');
  const [adjDelta, setAdjDelta] = useState(0);
  const [adjReason, setAdjReason] = useState('');

  // Formulaire Inventaire
  const [invReason, setInvReason] = useState('Inventaire physique régulier');
  const [countedMap, setCountedMap] = useState<Record<string, string>>({});
  const [quickScanInput, setQuickScanInput] = useState('');
  const [flashedRowKey, setFlashedRowKey] = useState<string | null>(null);

  // Formulaire Lot DLC
  const [batchForm, setBatchForm] = useState({
    productId: '',
    batchNumber: '',
    expiryDate: '',
    quantity: 10,
    notes: '',
  });

  // Détail session d'inventaire passée
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const valQs = new URLSearchParams();
      if (searchQuery.trim()) valQs.set('search', searchQuery.trim());
      if (categoryFilter) valQs.set('categoryId', categoryFilter);
      if (stockStatusFilter !== 'ALL') valQs.set('stockStatus', stockStatusFilter);

      const mvtQs = new URLSearchParams({ limit: '60' });
      if (mvtSearch.trim()) mvtQs.set('search', mvtSearch.trim());
      if (mvtTypeFilter) mvtQs.set('movementType', mvtTypeFilter);

      const [val, al, mv, sups, ex, sess] = await Promise.all([
        apiFetch<ValuationResponse>(`/shops/${shopId}/stock/valuation?${valQs.toString()}`, {
          shopId,
        }),
        apiFetch<StockAlert[]>(`/shops/${shopId}/stock/alerts`, { shopId }),
        apiFetch<{ items: MovementRow[] }>(`/shops/${shopId}/stock/movements?${mvtQs.toString()}`, {
          shopId,
        }),
        apiFetch<SupplierOpt[]>(`/shops/${shopId}/suppliers`, { shopId }).catch(() => []),
        apiFetch<ExpiryAlertsResponse>(`/shops/${shopId}/stock/expiry-alerts`, { shopId }).catch(
          () => null,
        ),
        apiFetch<InventorySessionRow[]>(`/shops/${shopId}/stock/inventories`, { shopId }).catch(
          () => [],
        ),
      ]);

      setValuationData(val);
      setAlerts(al);
      setMovements(mv.items);
      setSuppliers(sups);
      setExpiryData(ex);
      setInventorySessions(sess);

      if (val.items[0]) {
        setAdjProductId((prev) => (prev && val.items.some((x) => x.productId === prev) ? prev : val.items[0].productId));
        setBatchForm((f) => ({
          ...f,
          productId: f.productId && val.items.some((x) => x.productId === f.productId) ? f.productId : val.items[0].productId,
        }));
      }
      if (sups[0]) {
        setRestockSupplierId((prev) => (prev && sups.some((s) => s.id === prev) ? prev : sups[0].id));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des stocks.');
    } finally {
      setLoading(false);
    }
  }, [shopId, searchQuery, categoryFilter, stockStatusFilter, mvtSearch, mvtTypeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Unités disponibles et filtrage des articles par unité
  const availableUnits = useMemo(() => {
    if (!valuationData?.summary?.unitsBreakdown) return [];
    return valuationData.summary.unitsBreakdown.map((u) => u.unit);
  }, [valuationData?.summary?.unitsBreakdown]);

  const filteredValuationItems = useMemo(() => {
    if (!valuationData?.items) return [];
    if (unitFilter === 'ALL') return valuationData.items;
    return valuationData.items.filter(
      (item) => item.unit?.toLowerCase() === unitFilter.toLowerCase(),
    );
  }, [valuationData?.items, unitFilter]);

  // Détection du produit sélectionné pour la correction
  const selectedAdjProduct = useMemo(
    () => valuationData?.items.find((p) => p.productId === adjProductId) || null,
    [valuationData, adjProductId],
  );

  // Ouvre le réapprovisionnement 1-clic
  const openQuickRestock = (item: {
    productId: string;
    variantId?: string | null;
    name: string;
    sku: string;
    suggestedQty?: number;
    unitCost?: number | null;
  }) => {
    const cost = item.unitCost && item.unitCost > 0 ? item.unitCost : 1000;
    const qty = item.suggestedQty && item.suggestedQty > 0 ? item.suggestedQty : 10;
    setRestockProduct({
      productId: item.productId,
      variantId: item.variantId ?? null,
      name: item.name,
      sku: item.sku,
      suggestedQty: qty,
      unitCost: cost,
    });
    setRestockQty(qty);
    setRestockCost(cost);
    setRestockNotes(`Réapprovisionnement rapide alerte stock (${item.name})`);
    if (suppliers[0]) setRestockSupplierId(suppliers[0].id);
    setQuickRestockOpen(true);
  };

  const handleCreateQuickRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !restockProduct || !restockSupplierId) return;
    setBusy(true);
    try {
      const created = await apiFetch<{ poNumber: string; totalOrderedXof: number }>(
        `/shops/${shopId}/purchases`,
        {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: {
            supplierId: restockSupplierId,
            notes: restockNotes.trim() || undefined,
            items: [
              {
                productId: restockProduct.productId,
                variantId: restockProduct.variantId || undefined,
                orderedQty: restockQty,
                unitCostXof: restockCost,
              },
            ],
          },
        },
      );
      setQuickRestockOpen(false);
      setMsg(
        `Commande fournisseur ${created.poNumber} créée avec succès (${formatXof(created.totalOrderedXof)}). Le stock sera crédité lors de la réception.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création de commande impossible.');
    } finally {
      setBusy(false);
    }
  };

  // Traitement code-barres scanné via BarcodeScannerModal
  const handleBarcodeScanned = (code: string) => {
    const clean = code.trim().toLowerCase();
    if (!clean || !valuationData) return;

    if (scannerTarget === 'adjust') {
      // Trouve le produit ou la variante correspondante
      for (const p of valuationData.items) {
        if (p.barcode?.toLowerCase() === clean || p.sku.toLowerCase() === clean) {
          setAdjProductId(p.productId);
          setAdjVariantId('');
          setMsg(`Produit sélectionné : ${p.name}`);
          return;
        }
        for (const v of p.variants) {
          if (v.barcode?.toLowerCase() === clean || v.sku?.toLowerCase() === clean) {
            setAdjProductId(p.productId);
            setAdjVariantId(v.id);
            setMsg(`Variante sélectionnée : ${p.name} (${v.name})`);
            return;
          }
        }
      }
      setMsg(`Code non trouvé dans le catalogue : ${code}`);
    } else if (scannerTarget === 'inventory') {
      // Incrémente le comptage de +1 sur la ligne correspondante
      for (const p of valuationData.items) {
        if (p.hasVariants && p.variants.length > 0) {
          for (const v of p.variants) {
            if (v.barcode?.toLowerCase() === clean || v.sku?.toLowerCase() === clean) {
              const key = `${p.productId}::${v.id}`;
              const current = Number(countedMap[key]) || 0;
              setCountedMap((prev) => ({ ...prev, [key]: String(current + 1) }));
              setFlashedRowKey(key);
              setTimeout(() => setFlashedRowKey(null), 1000);
              return;
            }
          }
        } else {
          if (p.barcode?.toLowerCase() === clean || p.sku.toLowerCase() === clean) {
            const key = p.productId;
            const current = Number(countedMap[key]) || 0;
            setCountedMap((prev) => ({ ...prev, [key]: String(current + 1) }));
            setFlashedRowKey(key);
            setTimeout(() => setFlashedRowKey(null), 1000);
            return;
          }
        }
      }
      setMsg(`Code-barres inconnu : ${code}`);
    }
  };

  const handleQuickDouchetteScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleBarcodeScanned(quickScanInput);
    setQuickScanInput('');
  };

  const openLabelsModalForProduct = (p: ValuationItem, v?: ValuationVariant) => {
    if (v) {
      if (!v.barcode) {
        setError(`Cette variante « ${v.name} » n'a pas encore de code-barres.`);
        return;
      }
      setBarcodeLabelsItems([
        {
          id: v.id,
          name: p.name,
          variantName: v.name,
          sku: v.sku || p.sku,
          barcode: v.barcode,
          salePriceXof: v.salePriceXof,
        },
      ]);
    } else {
      if (p.hasVariants && p.variants.length > 0) {
        const withCode = p.variants
          .filter((x) => x.barcode && x.barcode.length === 13)
          .map((x) => ({
            id: x.id,
            name: p.name,
            variantName: x.name,
            sku: x.sku || p.sku,
            barcode: x.barcode!,
            salePriceXof: x.salePriceXof,
          }));
        if (withCode.length === 0) {
          setError(`Aucun code-barres valide sur les variantes de « ${p.name} ».`);
          return;
        }
        setBarcodeLabelsItems(withCode);
      } else {
        if (!p.barcode || p.barcode.length !== 13) {
          setError(`Le produit « ${p.name} » n'a pas de code-barres EAN-13 valide.`);
          return;
        }
        setBarcodeLabelsItems([
          {
            id: p.productId,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            salePriceXof: p.salePriceXof,
          },
        ]);
      }
    }
    setBarcodeLabelsOpen(true);
  };

  const openAllLabelsModal = () => {
    if (!valuationData) return;
    const all: BarcodePrintItem[] = [];
    for (const p of valuationData.items) {
      if (p.hasVariants && p.variants.length > 0) {
        for (const v of p.variants) {
          if (v.barcode && v.barcode.length === 13) {
            all.push({
              id: v.id,
              name: p.name,
              variantName: v.name,
              sku: v.sku || p.sku,
              barcode: v.barcode,
              salePriceXof: v.salePriceXof,
            });
          }
        }
      } else if (p.barcode && p.barcode.length === 13) {
        all.push({
          id: p.productId,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          salePriceXof: p.salePriceXof,
        });
      }
    }
    if (all.length === 0) {
      setError('Aucun produit avec code-barres EAN-13 à imprimer.');
      return;
    }
    setBarcodeLabelsItems(all);
    setBarcodeLabelsOpen(true);
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !adjProductId) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await apiFetch(`/shops/${shopId}/stock/adjustments`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          productId: adjProductId,
          variantId: adjVariantId || undefined,
          movementType: adjType,
          quantityDelta: Math.round(Number(adjDelta)),
          reason: adjReason.trim(),
        },
      });
      setMsg('Correction de stock enregistrée et journalisée.');
      setAdjDelta(0);
      setAdjReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Correction refusée.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;

    const items: Array<{ productId: string; variantId?: string | null; countedQty: number }> = [];
    for (const [key, val] of Object.entries(countedMap)) {
      if (val.trim() === '') continue;
      const count = Math.max(0, Math.round(Number(val)));
      if (key.includes('::')) {
        const [pId, vId] = key.split('::');
        items.push({ productId: pId, variantId: vId, countedQty: count });
      } else {
        items.push({ productId: key, countedQty: count });
      }
    }

    if (items.length === 0) {
      setError('Veuillez renseigner au moins un stock compté.');
      return;
    }

    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await apiFetch<{
        sessionNumber: string;
        checkedCount: number;
        discrepanciesCount: number;
        totalLossXof: number;
        totalGainXof: number;
        netVarianceXof: number;
      }>(`/shops/${shopId}/stock/inventory`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { reason: invReason, items },
      });
      setMsg(
        `Session ${res.sessionNumber} clôturée : ${res.checkedCount} article(s) vérifié(s), ${res.discrepanciesCount} écart(s) corrigé(s) (Pertes : ${formatXof(res.totalLossXof)}, Gains : ${formatXof(res.totalGainXof)}).`,
      );
      setCountedMap({});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Validation de l’inventaire refusée.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !batchForm.productId || !batchForm.expiryDate) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/stock/batches`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          productId: batchForm.productId,
          batchNumber: batchForm.batchNumber.trim() || undefined,
          expiryDate: new Date(`${batchForm.expiryDate}T23:59:59.000Z`).toISOString(),
          quantity: Math.max(1, Math.round(Number(batchForm.quantity) || 1)),
          notes: batchForm.notes.trim() || undefined,
        },
      });
      setMsg('Lot enregistré avec succès et stock crédité.');
      setBatchForm((f) => ({ ...f, batchNumber: '', expiryDate: '', quantity: 10, notes: '' }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création du lot impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleWriteOffBatch = async (item: ExpiryItem) => {
    if (!shopId || !item.batchId) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/stock/batches/${item.batchId}/write-off`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          reason: `Mise au rebut lot ${item.batchNumber || item.sku} (DLC ${new Date(item.expiryDate).toLocaleDateString('fr-FR')})`,
        },
      });
      setMsg(
        `Lot ${item.batchNumber || ''} de « ${item.productName} » (${item.remainingQty} ${item.unit}) mis au rebut en perte.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mise au rebut refusée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['OWNER', 'AGENT']}
      title="Gestion des Stocks & Valorisation"
      subtitle="Valorisation financière CMP, stock par variante, scan code-barres et réapprovisionnement pro."
    >
      {/* Wrapper sombre : toute la page stock est conçue en dark theme */}
      <div className="min-h-[calc(100vh-5rem)] space-y-4 rounded-2xl bg-[#071615] p-3 sm:p-4 -mx-3 sm:-mx-5 lg:-mx-6 -mt-0">
        {/* Barre d'onglets principale horizontale swipeable (< md & desktop) */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 border-b border-[#1b3d3b]/80">
          <button
            type="button"
            onClick={() => setTab('valuation')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              tab === 'valuation'
                ? 'bg-[#a3e635] text-[#051413] font-black shadow border border-[#a3e635]'
                : 'bg-[#0d2a27] text-white border border-[#214f4a] hover:bg-[#133c37] hover:border-[#a3e635]/60'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>État & Valeur</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              tab === 'movements'
                ? 'bg-[#a3e635] text-[#051413] font-black shadow border border-[#a3e635]'
                : 'bg-[#0d2a27] text-white border border-[#214f4a] hover:bg-[#133c37] hover:border-[#a3e635]/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Mouvements</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('adjust')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              tab === 'adjust'
                ? 'bg-[#a3e635] text-[#051413] font-black shadow border border-[#a3e635]'
                : 'bg-[#0d2a27] text-white border border-[#214f4a] hover:bg-[#133c37] hover:border-[#a3e635]/60'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Correction</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('inventory')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              tab === 'inventory'
                ? 'bg-[#a3e635] text-[#051413] font-black shadow border border-[#a3e635]'
                : 'bg-[#0d2a27] text-white border border-[#214f4a] hover:bg-[#133c37] hover:border-[#a3e635]/60'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Inventaire</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('expiry')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              tab === 'expiry'
                ? 'bg-[#a3e635] text-[#051413] font-black shadow border border-[#a3e635]'
                : 'bg-[#0d2a27] text-white border border-[#214f4a] hover:bg-[#133c37] hover:border-[#a3e635]/60'
            }`}
          >
            <CalendarClock className="w-4 h-4" />
            <span>Péremptions (DLC)</span>
            {expiryData &&
            expiryData.summary.expiredCount + expiryData.summary.expiring7dCount > 0 ? (
              <span className="rounded-full bg-rose-600 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                {expiryData.summary.expiredCount + expiryData.summary.expiring7dCount}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => setTab('sessions')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              tab === 'sessions'
                ? 'bg-[#a3e635] text-[#051413] font-black shadow border border-[#a3e635]'
                : 'bg-[#0d2a27] text-white border border-[#214f4a] hover:bg-[#133c37] hover:border-[#a3e635]/60'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Historique ({inventorySessions.length})</span>
          </button>
        </div>

        {/* Bannière alertes de stock */}
        {alerts.length > 0 && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-white">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <span>{alerts.length} alerte(s) de stock (rupture ou seuil bas atteint)</span>
              </div>
              {isOwner ? (
                <span className="text-xs text-white/60 hidden sm:inline">
                  Cliquez sur « Commander » pour réapprovisionner en 1 clic
                </span>
              ) : null}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {alerts.slice(0, 10).map((a, i) => (
                <div
                  key={`${a.productId}-${a.variantId || 'base'}-${i}`}
                  className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                    a.severity === 'NEGATIVE_CONFLICT'
                      ? 'bg-rose-950/80 border border-rose-500 text-rose-200'
                      : a.severity === 'OUT_OF_STOCK'
                        ? 'bg-red-950/80 border border-red-500 text-red-200'
                        : 'bg-amber-950/80 border border-amber-500 text-amber-200'
                  }`}
                >
                  <div>
                    <span className="font-bold">{a.name}</span>
                    <span className="ml-1 opacity-70">
                      : {a.availableQty} {a.unit} (seuil {a.alertThreshold})
                    </span>
                  </div>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() =>
                        openQuickRestock({
                          productId: a.productId,
                          variantId: a.variantId,
                          name: a.name,
                          sku: a.sku,
                          suggestedQty: Math.max(10, a.alertThreshold * 2 - a.availableQty),
                          unitCost: a.costPriceXof,
                        })
                      }
                      className="ml-1 px-2 py-0.5 rounded-lg bg-[#a3e635] text-[#051413] hover:bg-[#bef264] text-[10px] font-black uppercase tracking-wider transition-colors"
                    >
                      Commander
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs sm:text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="flex-1">{msg}</span>
            <button type="button" onClick={() => setMsg(null)} className="text-white/40 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs sm:text-sm text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-white/40 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3 pt-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 w-full animate-pulse rounded-xl bg-white/10" />
            ))}
          </div>
        ) : tab === 'valuation' ? (
          /* ========================================================================
             ONGLET 1 : ÉTAT & VALORISATION FINANCIÈRE COMPLÈTE DU STOCK
             ======================================================================== */
          <div className="space-y-4">
            {/* KPI Cards de valorisation */}
            {valuationData?.summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 sm:p-4 text-white flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                      Stock & Unités disponibles
                    </span>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-black text-[#a3e635] font-mono">
                        {valuationData.summary.totalUnitsAvailable}
                      </span>
                      <span className="text-xs text-white/60">total cumulé</span>
                    </div>
                    <div className="mt-1 text-[11px] text-white/45 flex items-center gap-2 font-mono">
                      <span>{valuationData.summary.totalProductsCount} prods</span>
                      {valuationData.summary.totalVariantsCount > 0 && (
                        <span>· {valuationData.summary.totalVariantsCount} variantes</span>
                      )}
                    </div>
                  </div>

                  {/* Distinction par unité de mesure (kg, pièces, litres...) */}
                  {valuationData.summary.unitsBreakdown && valuationData.summary.unitsBreakdown.length > 0 ? (
                    <div className="mt-2.5 pt-2 border-t border-[#1b3d3b]/80">
                      <p className="text-[10px] text-white/40 mb-1 font-semibold uppercase tracking-wider">
                        Détail par unité :
                      </p>
                      <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                        {valuationData.summary.unitsBreakdown.map((u) => (
                          <span
                            key={u.unit}
                            className="inline-flex items-center gap-1 rounded-md bg-[#0a2320] border border-[#214f4a] px-1.5 py-0.5 text-[10px] font-mono font-bold text-white"
                            title={`${u.productsCount} produit(s) en ${u.unit} (dispo : ${u.available}, physique : ${u.physical})`}
                          >
                            <span className="text-[#a3e635]">{u.available}</span>
                            <span className="text-white/80">{u.unit}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-white/30 leading-tight">
                      Total toutes unités confondues
                    </p>
                  )}
                </div>

                {isOwner ? (
                  <div className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 sm:p-4 text-white">
                    <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                      Valeur vente potentielle
                    </span>
                    <div className="mt-1 text-2xl font-black text-white font-mono">
                      {formatXof(valuationData.summary.totalRetailValueXof)}
                    </div>
                    <span className="mt-1 text-[11px] text-white/45 block">Prix public TTC</span>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 sm:p-4 text-white">
                    <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                      Unités en réserve / rayon
                    </span>
                    <div className="mt-1 text-2xl font-black text-white font-mono">
                      {valuationData.summary.totalUnitsPhysical}
                    </div>
                    <span className="mt-1 text-[11px] text-white/45 block">
                      Physique total ({valuationData.summary.totalUnitsReserved} réservé)
                    </span>
                  </div>
                )}

                {isOwner && valuationData.canReadCost && valuationData.summary.totalCostValueXof !== null ? (
                  <div className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 sm:p-4 text-white">
                    <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                      Valeur coût (CMP)
                    </span>
                    <div className="mt-1 text-2xl font-black text-amber-300 font-mono">
                      {formatXof(valuationData.summary.totalCostValueXof)}
                    </div>
                    {valuationData.summary.totalEstimatedMarginXof !== null && (
                      <span className="mt-1 text-[11px] text-[#a3e635] font-bold block">
                        Marge : {formatXof(valuationData.summary.totalEstimatedMarginXof)}
                      </span>
                    )}
                  </div>
                ) : !isOwner ? null : (
                  <div className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 sm:p-4 text-white">
                    <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                      Unités physiques
                    </span>
                    <div className="mt-1 text-2xl font-black text-white font-mono">
                      {valuationData.summary.totalUnitsPhysical}
                    </div>
                    <span className="mt-1 text-[11px] text-white/45 block">
                      Réservé : {valuationData.summary.totalUnitsReserved}
                    </span>
                  </div>
                )}

                <div className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 sm:p-4 text-white">
                  <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                    Alertes & Ruptures
                  </span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-rose-400 font-mono">
                      {valuationData.summary.outOfStockCount}
                    </span>
                    <span className="text-xs text-rose-300">rupture(s)</span>
                  </div>
                  <span className="mt-1 text-[11px] text-amber-300 font-medium block">
                    {valuationData.summary.lowStockCount} sous le seuil d’alerte
                  </span>
                </div>
              </div>
            )}

            {/* Barre de recherche, filtres et actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-[#091f1e] border border-[#1b3d3b] rounded-2xl p-3">
              <div className="flex flex-1 items-center gap-2 min-w-0">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher par nom, SKU ou code-barres..."
                    className="w-full bg-[#0a2320] border border-[#1b3d3b] rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm text-white placeholder-white/50 focus:outline-none focus:border-[#a3e635]"
                  />
                </div>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-[#0a2320] border border-[#1b3d3b] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#a3e635] max-w-[140px] [&>option]:bg-slate-800 [&>option]:text-white"
                >
                  <option value="">Toutes catégories</option>
                  {valuationData?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  value={stockStatusFilter}
                  onChange={(e) => setStockStatusFilter(e.target.value)}
                  className="bg-[#0a2320] border border-[#1b3d3b] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#a3e635] max-w-[130px] [&>option]:bg-slate-800 [&>option]:text-white"
                >
                  <option value="ALL">Tous statuts</option>
                  <option value="LOW_STOCK">Stock bas</option>
                  <option value="OUT_OF_STOCK">Rupture</option>
                  <option value="IN_STOCK">En stock</option>
                </select>

                {availableUnits.length > 0 && (
                  <select
                    value={unitFilter}
                    onChange={(e) => setUnitFilter(e.target.value)}
                    className="bg-[#0a2320] border border-[#1b3d3b] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#a3e635] max-w-[130px] [&>option]:bg-slate-800 [&>option]:text-white"
                    title="Filtrer par unité de mesure (kg, pièce, etc.)"
                  >
                    <option value="ALL">Toutes unités</option>
                    {availableUnits.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                {/* Export CSV UTF-8 */}
                <a
                  href={`/api/v1/shops/${shopId}/stock/export.csv`}
                  download
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-colors flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-4 h-4 text-[#a3e635]" />
                  <span className="hidden sm:inline">Export CSV</span>
                </a>

                {/* Impression Fiche Stock */}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-colors flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span className="hidden sm:inline">Imprimer / PDF</span>
                </button>

                {/* Étiquettes code-barres */}
                <button
                  type="button"
                  onClick={openAllLabelsModal}
                  className="px-3 py-2 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-[#051413] text-xs font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow"
                >
                  <Tag className="w-4 h-4" />
                  <span>Étiquettes</span>
                </button>
              </div>
            </div>

            {/* Tableau / Cartes État & Valeur */}
            {!valuationData || filteredValuationItems.length === 0 ? (
              <EmptyState
                title="Aucun article trouvé"
                description="Aucun produit ne correspond à vos filtres de stock ou unité sélectionnée."
              />
            ) : (
              <div className="space-y-3">
                {/* Cartes Mobile (< md) */}
                <div className="space-y-2.5 md:hidden">
                  {filteredValuationItems.map((item) => {
                    const isExpanded = Boolean(expandedVariants[item.productId]);
                    return (
                      <div
                        key={`val-m-${item.productId}`}
                        className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 text-xs text-white"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm text-white truncate">{item.name}</p>
                            <p className="font-mono text-[11px] text-white/50 flex items-center gap-2 mt-0.5">
                              <span>SKU: {item.sku}</span>
                              {item.categoryName && <span>· {item.categoryName}</span>}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              item.stockStatus === 'NEGATIVE_CONFLICT'
                                ? 'bg-rose-950 border border-rose-500 text-rose-300'
                                : item.stockStatus === 'OUT_OF_STOCK'
                                  ? 'bg-red-950 border border-red-500 text-red-300'
                                  : item.stockStatus === 'LOW_STOCK'
                                    ? 'bg-amber-950 border border-amber-500 text-amber-300'
                                    : 'bg-emerald-950 border border-emerald-500 text-emerald-300'
                            }`}
                          >
                            {item.stockStatus === 'OUT_OF_STOCK'
                              ? 'Rupture'
                              : item.stockStatus === 'LOW_STOCK'
                                ? 'Stock bas'
                                : 'En stock'}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 bg-black/30 p-2.5 rounded-xl font-mono text-[11px]">
                          <div>
                            <span className="text-white/40 block text-[10px]">Stock disponible</span>
                            <span className="font-bold text-white text-sm">
                              {item.stockAvailable} {item.unit}
                            </span>
                          </div>
                          <div>
                            <span className="text-white/40 block text-[10px]">Valeur vente</span>
                            <span className="font-bold text-[#a3e635] text-sm">
                              {formatXof(item.retailValueXof)}
                            </span>
                          </div>
                          {valuationData.canReadCost && item.costPriceXof !== null && (
                            <div>
                              <span className="text-white/40 block text-[10px]">Coût unitaire (CMP)</span>
                              <span className="text-white/80">{formatXof(item.costPriceXof)}</span>
                            </div>
                          )}
                          {valuationData.canReadCost && item.costValueXof !== null && (
                            <div>
                              <span className="text-white/40 block text-[10px]">Valeur coût</span>
                              <span className="text-amber-300 font-bold">{formatXof(item.costValueXof)}</span>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex items-center justify-between pt-2 border-t border-[#1b3d3b]/60">
                          {item.hasVariants ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedVariants((prev) => ({
                                  ...prev,
                                  [item.productId]: !prev[item.productId],
                                }))
                              }
                              className="text-xs font-semibold text-[#a3e635] hover:underline flex items-center gap-1"
                            >
                              <span>
                                {item.variants.length} variante(s){' '}
                                {isExpanded ? '▲ masquer' : '▼ détails'}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openLabelsModalForProduct(item)}
                              className="text-xs text-white/60 hover:text-white flex items-center gap-1"
                            >
                              <Tag className="w-3.5 h-3.5 text-[#a3e635]" />
                              <span>Étiquettes</span>
                            </button>
                          )}

                          {isOwner ? (
                            <button
                              type="button"
                              onClick={() =>
                                openQuickRestock({
                                  productId: item.productId,
                                  name: item.name,
                                  sku: item.sku,
                                  suggestedQty: Math.max(10, item.alertThreshold * 2 - item.stockAvailable),
                                  unitCost: item.costPriceXof,
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-[#a3e635] text-[#051413] hover:bg-[#bef264] text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1"
                            >
                              <ShoppingCart className="w-3 h-3" />
                              <span>Commander</span>
                            </button>
                          ) : null}
                        </div>

                        {/* Variantes dépliées sur mobile */}
                        {isExpanded && item.hasVariants && (
                          <div className="mt-2.5 space-y-2 border-t border-[#1b3d3b] pt-2 pl-2">
                            {item.variants.map((v) => (
                              <div
                                key={v.id}
                                className="p-2 rounded-xl bg-black/40 border border-[#1b3d3b]/80 text-[11px] flex items-center justify-between"
                              >
                                <div>
                                  <span className="font-bold text-white block">{v.name}</span>
                                  <span className="text-white/50 font-mono text-[10px]">
                                    {v.sku} · Dispo : {v.stockAvailable}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[#a3e635] font-bold">
                                    {formatXof(v.salePriceXof)}
                                  </span>
                                  {isOwner ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openQuickRestock({
                                          productId: item.productId,
                                          variantId: v.id,
                                          name: `${item.name} (${v.name})`,
                                          sku: v.sku || item.sku,
                                          suggestedQty: Math.max(5, v.alertThreshold * 2 - v.stockAvailable),
                                          unitCost: v.costPriceXof ?? item.costPriceXof,
                                        })
                                      }
                                      className="p-1 rounded bg-white/10 hover:bg-[#a3e635] hover:text-[#051413] transition-colors"
                                      title="Commander cette variante"
                                    >
                                      <ShoppingCart className="w-3.5 h-3.5" />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Tableau Desktop (>= md) */}
                <div className="hidden md:block overflow-x-auto rounded-2xl border border-[#1b3d3b] bg-[#091f1e]">
                  <table className="min-w-full divide-y divide-[#1b3d3b] text-xs">
                    <thead className="bg-[#0a2320] text-left text-white/80 uppercase tracking-wider text-[10px] font-bold">
                      <tr>
                        <th className="px-4 py-3">Produit & Réf</th>
                        <th className="px-3 py-3">Catégorie</th>
                        <th className="px-3 py-3 text-right">Prix Vente</th>
                        {valuationData.canReadCost && (
                          <th className="px-3 py-3 text-right">Coût CMP</th>
                        )}
                        <th className="px-3 py-3 text-center">Physique</th>
                        <th className="px-3 py-3 text-center">Disponible</th>
                        <th className="px-3 py-3 text-center">Statut</th>
                        <th className="px-3 py-3 text-right">Valeur Vente</th>
                        {valuationData.canReadCost && (
                          <th className="px-3 py-3 text-right">Valeur Coût</th>
                        )}
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b3d3b]/50 text-white">
                      {filteredValuationItems.map((item) => {
                        const isExpanded = Boolean(expandedVariants[item.productId]);
                        return (
                          <React.Fragment key={item.productId}>
                            <tr className="hover:bg-white/[0.02] transition-colors">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  {item.hasVariants ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedVariants((prev) => ({
                                          ...prev,
                                          [item.productId]: !prev[item.productId],
                                        }))
                                      }
                                      className="p-1 rounded text-[#a3e635] hover:bg-white/10"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="w-4 h-4" />
                                      ) : (
                                        <ChevronRight className="w-4 h-4" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="w-4" />
                                  )}
                                  <div>
                                    <p className="font-bold text-sm text-white">{item.name}</p>
                                    <p className="font-mono text-[11px] text-white/50">
                                      {item.sku}
                                      {item.barcode ? ` · ${item.barcode}` : ''}
                                      {item.hasVariants ? ` · (${item.variants.length} variantes)` : ''}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-white/70">
                                {item.categoryName || 'Général'}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono font-bold">
                                {formatXof(item.salePriceXof)}
                              </td>
                              {valuationData.canReadCost && (
                                <td className="px-3 py-2.5 text-right font-mono text-white/70">
                                  {item.costPriceXof !== null ? formatXof(item.costPriceXof) : '—'}
                                </td>
                              )}
                              <td className="px-3 py-2.5 text-center font-mono">
                                {item.stockPhysical} {item.unit}
                              </td>
                              <td className="px-3 py-2.5 text-center font-mono font-bold text-white">
                                {item.stockAvailable} {item.unit}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span
                                  className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    item.stockStatus === 'NEGATIVE_CONFLICT'
                                      ? 'bg-rose-950 border border-rose-500 text-rose-300'
                                      : item.stockStatus === 'OUT_OF_STOCK'
                                        ? 'bg-red-950 border border-red-500 text-red-300'
                                        : item.stockStatus === 'LOW_STOCK'
                                          ? 'bg-amber-950 border border-amber-500 text-amber-300'
                                          : 'bg-emerald-950 border border-emerald-500 text-emerald-300'
                                  }`}
                                >
                                  {item.stockStatus === 'OUT_OF_STOCK'
                                    ? 'Rupture'
                                    : item.stockStatus === 'LOW_STOCK'
                                      ? 'Stock bas'
                                      : 'En stock'}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono font-bold text-[#a3e635]">
                                {formatXof(item.retailValueXof)}
                              </td>
                              {valuationData.canReadCost && (
                                <td className="px-3 py-2.5 text-right font-mono text-amber-300 font-bold">
                                  {item.costValueXof !== null ? formatXof(item.costValueXof) : '—'}
                                </td>
                              )}
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openLabelsModalForProduct(item)}
                                    title="Imprimer étiquette code-barres"
                                    className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                                  >
                                    <Tag className="w-3.5 h-3.5 text-[#a3e635]" />
                                  </button>
                                  {isOwner ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openQuickRestock({
                                          productId: item.productId,
                                          name: item.name,
                                          sku: item.sku,
                                          suggestedQty: Math.max(10, item.alertThreshold * 2 - item.stockAvailable),
                                          unitCost: item.costPriceXof,
                                        })
                                      }
                                      title="Commander au fournisseur"
                                      className="px-2 py-1 rounded-lg bg-[#a3e635] text-[#051413] hover:bg-[#bef264] text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1"
                                    >
                                      <ShoppingCart className="w-3 h-3" />
                                      <span>Commander</span>
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>

                            {/* Lignes variantes dépliées */}
                            {isExpanded &&
                              item.variants.map((v) => (
                                <tr
                                  key={v.id}
                                  className="bg-black/40 text-[11px] border-b border-[#1b3d3b]/40 text-white/80"
                                >
                                  <td className="pl-12 pr-4 py-2 font-medium flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-[#a3e635]" />
                                    <span className="font-bold text-white">{v.name}</span>
                                    <span className="font-mono text-white/40 text-[10px]">
                                      ({v.sku || item.sku})
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-white/50">Variante</td>
                                  <td className="px-3 py-2 text-right font-mono font-bold text-white">
                                    {formatXof(v.salePriceXof)}
                                  </td>
                                  {valuationData.canReadCost && (
                                    <td className="px-3 py-2 text-right font-mono text-white/60">
                                      {v.costPriceXof !== null ? formatXof(v.costPriceXof) : '—'}
                                    </td>
                                  )}
                                  <td className="px-3 py-2 text-center font-mono">{v.stockPhysical}</td>
                                  <td className="px-3 py-2 text-center font-mono font-bold text-white">
                                    {v.stockAvailable}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span
                                      className={`inline-block rounded-full px-2 py-0.2 text-[9px] font-bold ${
                                        v.stockStatus === 'OUT_OF_STOCK'
                                          ? 'bg-red-950 text-red-300'
                                          : v.stockStatus === 'LOW_STOCK'
                                            ? 'bg-amber-950 text-amber-300'
                                            : 'bg-emerald-950 text-emerald-300'
                                      }`}
                                    >
                                      {v.stockStatus === 'OUT_OF_STOCK'
                                        ? 'Rupture'
                                        : v.stockStatus === 'LOW_STOCK'
                                          ? 'Bas'
                                          : 'OK'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-[#a3e635]">
                                    {formatXof(v.retailValueXof)}
                                  </td>
                                  {valuationData.canReadCost && (
                                    <td className="px-3 py-2 text-right font-mono text-amber-300">
                                      {v.costValueXof !== null ? formatXof(v.costValueXof) : '—'}
                                    </td>
                                  )}
                                  <td className="px-4 py-2 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => openLabelsModalForProduct(item, v)}
                                        title="Imprimer étiquette variante"
                                        className="p-1 rounded text-white/50 hover:text-white"
                                      >
                                        <Tag className="w-3 h-3 text-[#a3e635]" />
                                      </button>
                                      {isOwner ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openQuickRestock({
                                              productId: item.productId,
                                              variantId: v.id,
                                              name: `${item.name} (${v.name})`,
                                              sku: v.sku || item.sku,
                                              suggestedQty: Math.max(5, v.alertThreshold * 2 - v.stockAvailable),
                                              unitCost: v.costPriceXof ?? item.costPriceXof,
                                            })
                                          }
                                          className="px-2 py-0.5 rounded bg-white/10 hover:bg-[#a3e635] hover:text-[#051413] text-[9px] font-bold transition-colors"
                                        >
                                          Commander
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : tab === 'movements' ? (
          /* ========================================================================
             ONGLET 2 : MOUVEMENTS IMMUABLES AVEC RECHERCHE
             ======================================================================== */
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-[#091f1e] border border-[#1b3d3b] rounded-2xl p-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={mvtSearch}
                  onChange={(e) => setMvtSearch(e.target.value)}
                  placeholder="Filtrer les mouvements (motif, SKU, référence, produit)..."
                  className="w-full bg-[#0a2320] border border-[#1b3d3b] rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm text-white placeholder-white/50 focus:outline-none focus:border-[#a3e635]"
                />
              </div>

              <select
                value={mvtTypeFilter}
                onChange={(e) => setMvtTypeFilter(e.target.value)}
                className="bg-[#0a2320] border border-[#1b3d3b] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#a3e635] [&>option]:bg-slate-800 [&>option]:text-white"
              >
                <option value="">Tous les types</option>
                <option value="SALE_OUT">Ventes comptoir (SALE_OUT)</option>
                <option value="PURCHASE_RECEIPT">Réceptions fournisseurs (PURCHASE_RECEIPT)</option>
                <option value="INVENTORY_ADJUSTMENT">Ajustements inventaire</option>
                <option value="MANUAL_IN">Entrées manuelles</option>
                <option value="MANUAL_OUT">Sorties manuelles</option>
                <option value="RETURN_DAMAGED_LOSS">Pertes / Casse</option>
              </select>
            </div>

            {movements.length === 0 ? (
              <EmptyState
                title="Aucun mouvement de stock"
                description="Les réceptions fournisseurs, ventes, retours et inventaires apparaîtront ici."
              />
            ) : (
              <div className="space-y-2">
                {/* Mobile */}
                <div className="space-y-2.5 md:hidden">
                  {movements.map((m) => (
                    <div
                      key={`m-${m.id}`}
                      className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 text-xs text-white shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-sm text-white">{m.productName}</p>
                          <p className="font-mono text-[11px] text-white/50 flex items-center gap-2">
                            <span>SKU: {m.sku}</span>
                            {m.variantName && (
                              <span className="px-1.5 py-0.2 rounded bg-[#a3e635]/20 text-[#a3e635] font-semibold text-[10px]">
                                {m.variantName}
                              </span>
                            )}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono font-bold ${
                            m.quantityDelta > 0
                              ? 'bg-emerald-950 border border-emerald-500 text-emerald-300'
                              : m.quantityDelta < 0
                                ? 'bg-red-950 border border-red-500 text-red-300'
                                : 'bg-white/10 text-white/70'
                          }`}
                        >
                          {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta} ({m.qtyBefore} →{' '}
                          {m.qtyAfter})
                        </span>
                      </div>
                      <p className="mt-2 font-medium text-white/80">
                        {STOCK_MOVEMENT_LABELS[m.movementType] || m.movementType}
                      </p>
                      {m.reason && <p className="mt-0.5 text-white/50">{m.reason}</p>}
                      <div className="mt-1.5 flex flex-wrap justify-between gap-1 text-[11px] text-white/40">
                        <span>{m.declaredOperatorName ? `Op. ${m.declaredOperatorName}` : '—'}</span>
                        <span>{formatDateTimeInTimezone(m.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto rounded-2xl border border-[#1b3d3b] bg-[#091f1e]">
                  <table className="min-w-full divide-y divide-[#1b3d3b] text-xs">
                    <thead className="bg-[#0a2320] text-left text-white/80 uppercase tracking-wider text-[10px] font-bold">
                      <tr>
                        <th className="px-4 py-3">Produit & Réf</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Delta (Avant → Après)</th>
                        <th className="px-4 py-3">Motif / Réf</th>
                        <th className="px-4 py-3">Opérateur</th>
                        <th className="px-4 py-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b3d3b]/50 text-white">
                      {movements.map((m) => (
                        <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-2.5">
                            <p className="font-bold text-sm text-white">{m.productName}</p>
                            <p className="font-mono text-[11px] text-white/50 flex items-center gap-1.5">
                              <span>{m.sku}</span>
                              {m.variantName && (
                                <span className="px-1.5 py-0.2 rounded bg-[#a3e635]/20 text-[#a3e635] text-[10px] font-semibold">
                                  {m.variantName}
                                </span>
                              )}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 text-white/80">
                            {STOCK_MOVEMENT_LABELS[m.movementType] || m.movementType}
                          </td>
                          <td className="px-4 py-2.5 font-mono">
                            <span
                              className={`font-bold ${
                                m.quantityDelta > 0
                                  ? 'text-[#a3e635]'
                                  : m.quantityDelta < 0
                                    ? 'text-rose-400'
                                    : 'text-white/50'
                              }`}
                            >
                              {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                            </span>{' '}
                            <span className="text-white/40">
                              ({m.qtyBefore} → {m.qtyAfter})
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-white/70">
                            <p>{m.reason || '—'}</p>
                            {m.referenceId && (
                              <p className="font-mono text-[10px] text-white/40">Ref: {m.referenceId}</p>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-white/60">
                            {m.declaredOperatorName || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-white/50 font-mono text-[11px]">
                            {formatDateTimeInTimezone(m.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : tab === 'adjust' ? (
          /* ========================================================================
             ONGLET 3 : CORRECTION / PERTE DE STOCK AVEC SCANNER
             ======================================================================== */
          <form
            onSubmit={handleAdjust}
            className="w-full max-w-2xl space-y-4 rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-4 sm:p-6 text-white"
          >
            <div className="flex items-center justify-between border-b border-[#1b3d3b]/80 pb-3">
              <div>
                <h2 className="text-base font-bold text-white">Correction ou perte de stock</h2>
                <p className="text-xs text-white/60">
                  Mouvement unitaire audité avec motif obligatoire
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setScannerTarget('adjust');
                  setScannerOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-[#a3e635] hover:text-[#051413] text-xs font-bold transition-colors flex items-center gap-1.5"
              >
                <Camera className="w-4 h-4" />
                <span>Scanner code-barres</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-white/80">Produit *</label>
              <select
                required
                value={adjProductId}
                onChange={(e) => {
                  setAdjProductId(e.target.value);
                  setAdjVariantId('');
                }}
                className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-[#0a2320] px-3.5 py-2.5 text-sm text-white [&>option]:bg-[#0d2b28] [&>option]:text-white focus:outline-none focus:border-[#a3e635]"
              >
                {valuationData?.items.map((p) => (
                  <option key={p.productId} value={p.productId}>
                    {p.name} ({p.sku}) — Stock total : {p.stockPhysical} {p.unit}
                  </option>
                ))}
              </select>
            </div>

            {/* Sélecteur de variante si le produit sélectionné en possède */}
            {selectedAdjProduct && selectedAdjProduct.hasVariants && (
              <div>
                <label className="block text-xs font-semibold text-white/80">
                  Variante ciblée (Taille / Couleur) *
                </label>
                <select
                  value={adjVariantId}
                  onChange={(e) => setAdjVariantId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-[#0a2320] px-3.5 py-2.5 text-sm text-white [&>option]:bg-[#0d2b28] [&>option]:text-white focus:outline-none focus:border-[#a3e635]"
                >
                  <option value="">Sélectionnez la variante...</option>
                  {selectedAdjProduct.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.sku || selectedAdjProduct.sku}) — Stock : {v.stockPhysical}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-white/80">Nature du mouvement</label>
                <select
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-[#0a2320] px-3.5 py-2.5 text-sm text-white [&>option]:bg-[#0d2b28] [&>option]:text-white focus:outline-none focus:border-[#a3e635]"
                >
                  <option value="INVENTORY_ADJUSTMENT">Correction d’inventaire</option>
                  <option value="MANUAL_IN">Entrée manuelle (+)</option>
                  <option value="MANUAL_OUT">Sortie manuelle (-)</option>
                  <option value="RETURN_DAMAGED_LOSS">Casse / Perte (-)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-white/80">
                  Variation quantité (+ ou -) *
                </label>
                <input
                  type="number"
                  required
                  value={adjDelta}
                  onChange={(e) => setAdjDelta(Number(e.target.value))}
                  placeholder="Ex: -2 ou +5"
                  className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-black/40 px-3.5 py-2.5 text-sm font-bold text-white font-mono focus:outline-none focus:border-[#a3e635]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-white/80">Motif obligatoire *</label>
              <textarea
                rows={2}
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="Ex. Bouteille brisée en rayon lors de la mise en place..."
                className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-black/40 p-3 text-sm text-white placeholder-white/35 focus:outline-none focus:border-[#a3e635]"
              />
            </div>

            <button
              type="submit"
              disabled={busy || adjDelta === 0}
              className="w-full rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-[#051413] px-5 py-2.5 text-xs font-black uppercase tracking-wider transition-colors shadow disabled:opacity-50 sm:w-auto"
            >
              Valider le mouvement tracé
            </button>
          </form>
        ) : tab === 'inventory' ? (
          /* ========================================================================
             ONGLET 4 : INVENTAIRE PHYSIQUE AVEC DOUCHETTE ET VARIANTES
             ======================================================================== */
          <form
            onSubmit={handleSubmitInventory}
            className="space-y-4 rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-4 sm:p-6 text-white"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1b3d3b]/80 pb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-[#a3e635]" />
                  <span>Comptage physique & Détection d’écarts</span>
                </h2>
                <p className="text-xs text-white/60 mt-0.5">
                  Flashez les articles à la douchette pour +1 instantané ou saisissez le comptage
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  required
                  value={invReason}
                  onChange={(e) => setInvReason(e.target.value)}
                  className="bg-black/40 border border-[#1b3d3b] rounded-xl px-3 py-1.5 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[#a3e635] w-full sm:w-64"
                  placeholder="Motif de l’inventaire"
                />
                <button
                  type="button"
                  onClick={() => {
                    setScannerTarget('inventory');
                    setScannerOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-[#a3e635] hover:text-[#051413] text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <ScanLine className="w-4 h-4" />
                  <span>Scanner (+1)</span>
                </button>
              </div>
            </div>

            {/* Champ douchette rapide pour flasher en continu */}
            <div className="p-3 rounded-xl bg-black/40 border border-[#1b3d3b] flex items-center gap-3">
              <ScanLine className="w-5 h-5 text-[#a3e635] animate-pulse shrink-0" />
              <input
                type="text"
                value={quickScanInput}
                onChange={(e) => setQuickScanInput(e.target.value)}
                onKeyDown={handleQuickDouchetteScan}
                placeholder="Flashez avec la douchette USB/Bluetooth pour incrémenter de +1..."
                className="flex-1 bg-transparent border-none text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none font-mono"
              />
              <span className="text-[11px] text-white/40 font-mono hidden sm:inline">
                Mode douchette actif
              </span>
            </div>

            {/* Table de comptage physique détaillée (avec variantes) */}
            <div className="space-y-2">
              {valuationData?.items.map((p) => {
                if (p.hasVariants && p.variants.length > 0) {
                  return (
                    <div
                      key={`inv-group-${p.productId}`}
                      className="border border-[#1b3d3b] rounded-xl overflow-hidden bg-black/20"
                    >
                      <div className="px-3.5 py-2 bg-white/5 font-bold text-xs text-white flex items-center justify-between">
                        <span>
                          {p.name} ({p.variants.length} variantes)
                        </span>
                        <span className="text-[11px] font-mono text-white/50">SKU: {p.sku}</span>
                      </div>
                      <div className="divide-y divide-[#1b3d3b]/40">
                        {p.variants.map((v) => {
                          const key = `${p.productId}::${v.id}`;
                          const isFlashed = flashedRowKey === key;
                          const countedVal = countedMap[key] ?? '';
                          const countedNum = countedVal.trim() !== '' ? Number(countedVal) : null;
                          const delta =
                            countedNum !== null ? countedNum - v.stockPhysical : null;

                          return (
                            <div
                              key={key}
                              className={`p-3 flex items-center justify-between gap-3 text-xs transition-colors ${
                                isFlashed ? 'bg-[#a3e635]/20' : 'hover:bg-white/[0.02]'
                              }`}
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-white block">{v.name}</span>
                                <span className="text-[11px] font-mono text-white/50">
                                  {v.sku || p.sku} · Théorique :{' '}
                                  <strong className="text-white">{v.stockPhysical}</strong>
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                {delta !== null && delta !== 0 && (
                                  <span
                                    className={`font-mono text-xs font-bold ${
                                      delta > 0 ? 'text-[#a3e635]' : 'text-rose-400'
                                    }`}
                                  >
                                    {delta > 0 ? `+${delta}` : delta}
                                  </span>
                                )}
                                <input
                                  type="number"
                                  min={0}
                                  placeholder={String(v.stockPhysical)}
                                  value={countedVal}
                                  onChange={(e) =>
                                    setCountedMap({ ...countedMap, [key]: e.target.value })
                                  }
                                  className="w-24 bg-black/40 border border-[#1b3d3b] rounded-lg px-2.5 py-1.5 text-center text-xs sm:text-sm font-bold text-white font-mono focus:outline-none focus:border-[#a3e635]"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                const key = p.productId;
                const isFlashed = flashedRowKey === key;
                const countedVal = countedMap[key] ?? '';
                const countedNum = countedVal.trim() !== '' ? Number(countedVal) : null;
                const delta = countedNum !== null ? countedNum - p.stockPhysical : null;

                return (
                  <div
                    key={`inv-row-${key}`}
                    className={`flex items-center justify-between gap-3 rounded-xl border border-[#1b3d3b] bg-black/20 p-3 text-xs transition-colors ${
                      isFlashed ? 'bg-[#a3e635]/20' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-white truncate">{p.name}</p>
                      <p className="font-mono text-[11px] text-white/50">
                        {p.sku} · Théorique :{' '}
                        <strong className="text-white">
                          {p.stockPhysical} {p.unit}
                        </strong>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {delta !== null && delta !== 0 && (
                        <span
                          className={`font-mono text-xs font-bold ${
                            delta > 0 ? 'text-[#a3e635]' : 'text-rose-400'
                          }`}
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </span>
                      )}
                      <input
                        type="number"
                        min={0}
                        placeholder={String(p.stockPhysical)}
                        value={countedVal}
                        onChange={(e) =>
                          setCountedMap({ ...countedMap, [key]: e.target.value })
                        }
                        className="w-24 bg-black/40 border border-[#1b3d3b] rounded-lg px-2.5 py-1.5 text-center text-xs sm:text-sm font-bold text-white font-mono focus:outline-none focus:border-[#a3e635]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-[#051413] text-xs font-black uppercase tracking-wider transition-colors shadow disabled:opacity-50"
              >
                Clôturer la session d’inventaire & Corriger les écarts
              </button>
            </div>
          </form>
        ) : tab === 'sessions' ? (
          /* ========================================================================
             ONGLET 5 : HISTORIQUE DES SESSIONS D'INVENTAIRE ET PERTES/GAINS
             ======================================================================== */
          <div className="space-y-3">
            {inventorySessions.length === 0 ? (
              <EmptyState
                title="Aucune session d’inventaire passée"
                description="Les inventaires physiques validés seront historisés ici avec leurs gains et pertes en FCFA."
              />
            ) : (
              <div className="space-y-3">
                {inventorySessions.map((session) => {
                  const isExpanded = expandedSessionId === session.id;
                  return (
                    <div
                      key={session.id}
                      className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-4 text-white space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1b3d3b]/80 pb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-[#a3e635]/15 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]">
                            <History className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-mono font-bold text-sm text-[#a3e635]">
                              {session.sessionNumber}
                            </span>
                            <h3 className="font-bold text-sm text-white">{session.reason}</h3>
                          </div>
                        </div>

                        <div className="text-right text-xs text-white/50 font-mono">
                          <p>{formatDateTimeInTimezone(session.createdAt)}</p>
                          <p>{session.declaredOperatorName ? `Op. ${session.declaredOperatorName}` : ''}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-black/30 p-3 rounded-xl font-mono text-xs">
                        <div>
                          <span className="text-white/40 block text-[10px]">Articles vérifiés</span>
                          <span className="font-bold text-white text-sm">
                            {session.totalItemsChecked}
                          </span>
                        </div>
                        <div>
                          <span className="text-white/40 block text-[10px]">Écarts corrigés</span>
                          <span className="font-bold text-amber-300 text-sm">
                            {session.discrepanciesCount}
                          </span>
                        </div>
                        {session.totalLossXof !== null && (
                          <div>
                            <span className="text-white/40 block text-[10px]">Pertes (XOF)</span>
                            <span className="font-bold text-rose-400 text-sm">
                              -{formatXof(session.totalLossXof)}
                            </span>
                          </div>
                        )}
                        {session.totalGainXof !== null && (
                          <div>
                            <span className="text-white/40 block text-[10px]">Gains (XOF)</span>
                            <span className="font-bold text-[#a3e635] text-sm">
                              +{formatXof(session.totalGainXof)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSessionId(isExpanded ? null : session.id)
                          }
                          className="text-xs font-semibold text-[#a3e635] hover:underline flex items-center gap-1"
                        >
                          <span>
                            {isExpanded ? 'Masquer le détail des écarts' : 'Voir le détail des écarts'}
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      {/* Détail des écarts */}
                      {isExpanded && (
                        <div className="pt-2 border-t border-[#1b3d3b]/60">
                          <div className="overflow-x-auto rounded-xl border border-[#1b3d3b]/80 bg-black/40">
                            <table className="min-w-full divide-y divide-[#1b3d3b] text-xs">
                              <thead className="text-[10px] uppercase font-bold text-white/50">
                                <tr>
                                  <th className="px-3 py-2 text-left">Article</th>
                                  <th className="px-3 py-2 text-left">Réf</th>
                                  <th className="px-3 py-2 text-center">Théorique</th>
                                  <th className="px-3 py-2 text-center">Compté</th>
                                  <th className="px-3 py-2 text-center">Écart</th>
                                  {session.totalLossXof !== null && (
                                    <th className="px-3 py-2 text-right">Valeur écart</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#1b3d3b]/40 text-white/80">
                                {session.items.map((item) => (
                                  <tr key={item.id} className="hover:bg-white/[0.02]">
                                    <td className="px-3 py-2 font-medium text-white">
                                      {item.productName}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-white/50">{item.sku}</td>
                                    <td className="px-3 py-2 text-center font-mono">
                                      {item.expectedQty}
                                    </td>
                                    <td className="px-3 py-2 text-center font-mono">
                                      {item.countedQty}
                                    </td>
                                    <td className="px-3 py-2 text-center font-mono font-bold">
                                      <span
                                        className={
                                          item.varianceQty > 0
                                            ? 'text-[#a3e635]'
                                            : item.varianceQty < 0
                                              ? 'text-rose-400'
                                              : 'text-white/40'
                                        }
                                      >
                                        {item.varianceQty > 0
                                          ? `+${item.varianceQty}`
                                          : item.varianceQty}
                                      </span>
                                    </td>
                                    {session.totalLossXof !== null && (
                                      <td className="px-3 py-2 text-right font-mono">
                                        {item.varianceValueXof !== null
                                          ? formatXof(item.varianceValueXof)
                                          : '—'}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ========================================================================
             ONGLET 6 : PÉREMPTIONS (DLC) & LOTS FEFO
             ======================================================================== */
          <div className="space-y-4">
            {expiryData && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 sm:p-4 text-white">
                  <span className="text-[11px] font-bold text-rose-300 uppercase tracking-wider">
                    Lots périmés
                  </span>
                  <div className="mt-1 text-2xl font-black text-rose-400 font-mono">
                    {expiryData.summary.expiredCount}
                  </div>
                  {expiryData.summary.expiredEstimatedCostXof > 0 && (
                    <span className="mt-0.5 text-[11px] font-semibold text-rose-300 block font-mono">
                      Perte : {formatXof(expiryData.summary.expiredEstimatedCostXof)}
                    </span>
                  )}
                </div>

                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 sm:p-4 text-white">
                  <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider">
                    Expirent sous 7 j
                  </span>
                  <div className="mt-1 text-2xl font-black text-amber-400 font-mono">
                    {expiryData.summary.expiring7dCount}
                  </div>
                </div>

                <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-3.5 sm:p-4 text-white">
                  <span className="text-[11px] font-bold text-yellow-300 uppercase tracking-wider">
                    Expirent sous 30 j
                  </span>
                  <div className="mt-1 text-2xl font-black text-yellow-400 font-mono">
                    {expiryData.summary.expiring30dCount}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-3.5 sm:p-4 text-white">
                  <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                    Lots suivis FEFO
                  </span>
                  <div className="mt-1 text-2xl font-black text-white font-mono">
                    {expiryData.summary.totalTrackedBatches}
                  </div>
                </div>
              </div>
            )}

            {/* Formulaire nouveau lot */}
            <form
              onSubmit={handleCreateBatch}
              className="rounded-2xl border border-[#1b3d3b] bg-[#091f1e] p-4 sm:p-5 text-white"
            >
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-[#a3e635]" />
                <h2 className="text-base font-bold text-white">
                  Enregistrer un nouveau lot avec date de péremption (DLC)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-white/60">
                Crédite le stock et active la déduction FEFO automatique (lots les plus proches de
                péremption écoulés en priorité).
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <label className="block text-xs font-semibold text-white/80">Produit *</label>
                  <select
                    required
                    value={batchForm.productId}
                    onChange={(e) => setBatchForm({ ...batchForm, productId: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-[#0a2320] px-3.5 py-2.5 text-xs sm:text-sm text-white [&>option]:bg-[#0d2b28] [&>option]:text-white focus:outline-none focus:border-[#a3e635]"
                  >
                    {valuationData?.items.map((p) => (
                      <option key={p.productId} value={p.productId}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-white/80">Quantité *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={batchForm.quantity}
                    onChange={(e) =>
                      setBatchForm({ ...batchForm, quantity: Number(e.target.value) || 1 })
                    }
                    className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-[#0a2320] px-3.5 py-2.5 text-xs sm:text-sm text-white [&>option]:bg-[#0d2b28] [&>option]:text-white font-mono font-bold focus:outline-none focus:border-[#a3e635]"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-semibold text-white/80">
                    Date de péremption *
                  </label>
                  <input
                    type="date"
                    required
                    value={batchForm.expiryDate}
                    onChange={(e) => setBatchForm({ ...batchForm, expiryDate: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-[#0a2320] px-3.5 py-2.5 text-xs sm:text-sm text-white [&>option]:bg-[#0d2b28] [&>option]:text-white focus:outline-none focus:border-[#a3e635]"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-semibold text-white/80">N° de lot</label>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      value={batchForm.batchNumber}
                      onChange={(e) =>
                        setBatchForm({ ...batchForm, batchNumber: e.target.value })
                      }
                      placeholder="Ex. LOT-12"
                      className="flex-1 rounded-xl border border-[#1b3d3b] bg-black/40 px-3 py-2 text-xs sm:text-sm text-white font-mono focus:outline-none focus:border-[#a3e635]"
                    />
                    <button
                      type="submit"
                      disabled={busy || !batchForm.expiryDate}
                      className="px-4 py-2 bg-[#a3e635] hover:bg-[#bef264] text-[#051413] rounded-xl font-bold text-xs uppercase tracking-wider transition-colors shadow disabled:opacity-50"
                    >
                      Ajouter
                    </button>
                  </div>
                </div>
              </div>
            </form>

            {/* Liste des lots actifs */}
            {!expiryData || expiryData.items.length === 0 ? (
              <EmptyState
                title="Aucun lot avec date de péremption"
                description="Renseignez une DLC lors de l’ajout produit, d’une réception fournisseur ou via le formulaire ci-dessus."
              />
            ) : (
              <div className="space-y-2.5">
                {expiryData.items.map((item, idx) => (
                  <div
                    key={item.batchId || `${item.productId}-${idx}`}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-xs ${
                      item.severity === 'EXPIRED'
                        ? 'border-rose-500/40 bg-rose-950/30'
                        : item.severity === 'EXPIRING_7D'
                          ? 'border-amber-500/40 bg-amber-950/30'
                          : 'border-[#1b3d3b] bg-[#091f1e]'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">{item.productName}</span>
                        <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-white/70">
                          {item.sku}
                        </code>
                        {item.batchNumber && (
                          <span className="rounded bg-[#a3e635]/20 text-[#a3e635] px-2 py-0.5 font-mono text-[10px] font-bold">
                            Lot : {item.batchNumber}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                            item.severity === 'EXPIRED'
                              ? 'bg-rose-600 text-white'
                              : item.severity === 'EXPIRING_7D'
                                ? 'bg-amber-600 text-white'
                                : item.severity === 'EXPIRING_30D'
                                  ? 'bg-yellow-200 text-yellow-950'
                                  : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {item.severity === 'EXPIRED'
                            ? `PÉRIMÉ (${Math.abs(item.daysRemaining)} j)`
                            : `DLC dans ${item.daysRemaining} j`}
                        </span>
                      </div>
                      <p className="text-white/70">
                        Expire le :{' '}
                        <strong className="text-white">
                          {new Date(item.expiryDate).toLocaleDateString('fr-FR')}
                        </strong>{' '}
                        · Quantité restante :{' '}
                        <strong className="text-white">
                          {item.remainingQty} / {item.initialQty} {item.unit}
                        </strong>
                        {item.estimatedLossCostXof > 0 && (
                          <span className="text-amber-300 font-mono">
                            {' '}
                            · Coût : {formatXof(item.estimatedLossCostXof)}
                          </span>
                        )}
                      </p>
                    </div>

                    {item.batchId && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleWriteOffBatch(item)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-3.5 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Mettre au rebut (Perte)</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modale Réapprovisionnement Rapide Fournisseur 1-clic */}
      {quickRestockOpen && restockProduct && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm"
          onClick={() => setQuickRestockOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[#091f1e] border border-[#1b3d3b] rounded-2xl p-5 shadow-2xl flex flex-col gap-4 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#1b3d3b]/80 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#a3e635]/15 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Commander au fournisseur</h3>
                  <p className="text-xs text-white/60">
                    Réapprovisionnement rapide pour {restockProduct.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQuickRestockOpen(false)}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateQuickRestock} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-white/80">
                  Fournisseur * (produits fournis affichés)
                </label>
                <select
                  required
                  value={restockSupplierId}
                  onChange={(e) => setRestockSupplierId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-[#0a2320] px-3.5 py-2.5 text-sm text-white [&>option]:bg-[#0d2b28] [&>option]:text-white focus:outline-none focus:border-[#a3e635]"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.suppliedProducts ? ` — Fournit : ${s.suppliedProducts}` : ''}
                    </option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="text-[11px] text-amber-300 mt-1">
                    Aucun fournisseur enregistré.{' '}
                    <Link
                      href="/commerce/purchases"
                      className="underline font-bold text-[#a3e635]"
                    >
                      Ajouter un fournisseur ici
                    </Link>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-white/80">
                    Quantité à commander *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={restockQty}
                    onChange={(e) => setRestockQty(Math.max(1, Number(e.target.value) || 1))}
                    className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-black/40 px-3.5 py-2.5 text-sm font-bold text-white font-mono focus:outline-none focus:border-[#a3e635]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-white/80">
                    Coût unitaire d’achat (XOF) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={restockCost}
                    onChange={(e) => setRestockCost(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-black/40 px-3.5 py-2.5 text-sm font-bold text-white font-mono focus:outline-none focus:border-[#a3e635]"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-black/40 border border-[#1b3d3b] text-xs flex justify-between items-center">
                <span className="text-white/60">Total prévisionnel commande :</span>
                <span className="font-mono font-black text-sm text-[#a3e635]">
                  {formatXof(restockQty * restockCost)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/80">
                  Notes / Instructions fournisseur
                </label>
                <input
                  type="text"
                  value={restockNotes}
                  onChange={(e) => setRestockNotes(e.target.value)}
                  placeholder="Ex: Livraison urgente avant vendredi..."
                  className="mt-1 w-full rounded-xl border border-[#1b3d3b] bg-black/40 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-[#a3e635]"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#1b3d3b]/80">
                <Link
                  href={`/commerce/purchases?productId=${restockProduct.productId}&qty=${restockQty}`}
                  className="text-xs text-white/60 hover:text-white underline"
                  onClick={() => setQuickRestockOpen(false)}
                >
                  Ouvrir dans Achats & Réceptions →
                </Link>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuickRestockOpen(false)}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 text-xs font-semibold transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={busy || suppliers.length === 0}
                    className="px-5 py-2 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-[#051413] text-xs font-black uppercase tracking-wider transition-colors shadow disabled:opacity-50"
                  >
                    Créer la commande
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale scanner code-barres (Caméra + Douchette) */}
      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleBarcodeScanned}
        title={
          scannerTarget === 'inventory'
            ? 'Scanner pour inventaire physique (+1)'
            : 'Scanner pour sélectionner produit / variante'
        }
        continuous={scannerTarget === 'inventory'}
      />

      {/* Modale d'impression étiquettes code-barres EAN-13 */}
      <BarcodeLabelsModal
        open={barcodeLabelsOpen}
        onClose={() => setBarcodeLabelsOpen(false)}
        shopName={activeShop?.shopName || 'ShopControl'}
        items={barcodeLabelsItems}
      />

      {/* Zone imprimable Fiche de valorisation stock (.sc-printable-area visible UNIQUEMENT à l'impression) */}
      <div className="sc-printable-area hidden">
        <div style={{ color: '#000', padding: '5mm', fontFamily: 'sans-serif' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: '3mm' }}>
            <div>
              <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: 0 }}>{activeShop?.shopName || 'ShopControl'}</h1>
              <p style={{ fontSize: '11pt', margin: '2mm 0 0 0', color: '#555' }}>
                Fiche d’État & Valorisation du Stock · {new Date().toLocaleDateString('fr-FR')}
              </p>
            </div>
            <div style={{ textAlign: 'right', fontSize: '9pt', color: '#555' }}>
              <p style={{ margin: 0 }}>Opérateur : {activeOperator?.firstName || 'Responsable Stock'}</p>
              <p style={{ margin: '1mm 0 0 0' }}>Chakir’s Entreprise</p>
            </div>
          </div>

          {valuationData?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3mm', margin: '5mm 0', border: '1px solid #ddd', padding: '3mm', borderRadius: '4px' }}>
              <div>
                <span style={{ fontSize: '8pt', color: '#666', textTransform: 'uppercase' }}>Unités en Stock</span>
                <p style={{ fontSize: '14pt', fontWeight: 'bold', margin: '1mm 0 0 0' }}>{valuationData.summary.totalUnitsPhysical}</p>
              </div>
              <div>
                <span style={{ fontSize: '8pt', color: '#666', textTransform: 'uppercase' }}>Valeur Vente (TTC)</span>
                <p style={{ fontSize: '14pt', fontWeight: 'bold', margin: '1mm 0 0 0' }}>{formatXof(valuationData.summary.totalRetailValueXof)}</p>
              </div>
              {valuationData.canReadCost && valuationData.summary.totalCostValueXof !== null && (
                <div>
                  <span style={{ fontSize: '8pt', color: '#666', textTransform: 'uppercase' }}>Valeur Coût (CMP)</span>
                  <p style={{ fontSize: '14pt', fontWeight: 'bold', margin: '1mm 0 0 0' }}>{formatXof(valuationData.summary.totalCostValueXof)}</p>
                </div>
              )}
              <div>
                <span style={{ fontSize: '8pt', color: '#666', textTransform: 'uppercase' }}>Alertes / Ruptures</span>
                <p style={{ fontSize: '14pt', fontWeight: 'bold', margin: '1mm 0 0 0', color: '#b91c1c' }}>
                  {valuationData.summary.outOfStockCount} rupture(s) · {valuationData.summary.lowStockCount} bas
                </p>
              </div>
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', marginTop: '4mm' }}>
            <thead>
              <tr style={{ background: '#f3f4f6', borderBottom: '1px solid #000', textAlign: 'left' }}>
                <th style={{ padding: '2mm' }}>Réf (SKU)</th>
                <th style={{ padding: '2mm' }}>Produit / Variante</th>
                <th style={{ padding: '2mm', textAlign: 'right' }}>Prix Vente</th>
                {valuationData?.canReadCost && <th style={{ padding: '2mm', textAlign: 'right' }}>Coût CMP</th>}
                <th style={{ padding: '2mm', textAlign: 'center' }}>Stock Dispo</th>
                <th style={{ padding: '2mm', textAlign: 'right' }}>Valeur Vente</th>
                {valuationData?.canReadCost && <th style={{ padding: '2mm', textAlign: 'right' }}>Valeur Coût</th>}
              </tr>
            </thead>
            <tbody>
              {valuationData?.items.map((item) => (
                <tr key={`print-${item.productId}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '2mm', fontFamily: 'monospace' }}>{item.sku}</td>
                  <td style={{ padding: '2mm', fontWeight: 'bold' }}>
                    {item.name}
                    {item.hasVariants ? ` (${item.variants.length} var)` : ''}
                  </td>
                  <td style={{ padding: '2mm', textAlign: 'right' }}>{formatXof(item.salePriceXof)}</td>
                  {valuationData?.canReadCost && (
                    <td style={{ padding: '2mm', textAlign: 'right' }}>
                      {item.costPriceXof !== null ? formatXof(item.costPriceXof) : '—'}
                    </td>
                  )}
                  <td style={{ padding: '2mm', textAlign: 'center', fontWeight: 'bold' }}>
                    {item.stockAvailable} {item.unit}
                  </td>
                  <td style={{ padding: '2mm', textAlign: 'right', fontWeight: 'bold' }}>
                    {formatXof(item.retailValueXof)}
                  </td>
                  {valuationData?.canReadCost && (
                    <td style={{ padding: '2mm', textAlign: 'right' }}>
                      {item.costValueXof !== null ? formatXof(item.costValueXof) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}








