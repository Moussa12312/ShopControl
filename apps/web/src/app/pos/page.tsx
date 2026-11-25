'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Camera,
  CheckCircle2,
  FileText,
  Minus,
  Package,
  Pin,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Undo2,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  calculateSaleTotals,
  formatDateTimeInTimezone,
  formatXof,
  normalizeBusinessProfile,
  normalizeShopType,
  PaymentMethodConfig,
  TaxMode,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { PosGrowthPanel } from '@/components/commerce/PosGrowthPanel';
import {
  cacheShopProducts,
  enqueueOfflineSale,
  getCachedShopProducts,
  getPendingOfflineSales,
  OfflineOperationItem,
  updateOfflineSaleStatus,
} from '@/lib/local-db';
import { useAuth } from '@/components/providers/AuthProvider';
import { useNetworkStatus } from '@/components/providers/NetworkStatusProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { ReceiptModal, SaleDocumentView } from '@/components/commerce/ReceiptModal';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface ProductVariant {
  id: string;
  name: string;
  sku?: string;
  barcode?: string | null;
  salePriceXof?: number | null;
  stockAvailable?: number;
  isActive?: boolean;
}

interface ProductItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  salePriceXof: number;
  stockAvailable: number;
  stockAvailableDecimal?: number;
  status: string;
  unit: string;
  imageUrls?: string[];
  brand?: string | null;
  modelName?: string | null;
  isPinnedPos?: boolean;
  bulkUnitLabel?: string | null;
  unitsPerBulk?: number | null;
  bulkSalePriceXof?: number | null;
  allowFractionalSale?: boolean;
  warrantyMonths?: number | null;
  trackSerialNumber?: boolean;
  variants?: ProductVariant[];
}

interface ClientItem {
  id: string;
  fullName: string;
  phone: string;
  creditLimitXof: number;
  outstandingDebtXof: number;
}

interface CartItem {
  key: string;
  product: ProductItem;
  quantity: number;
  soldInBulk: boolean;
  customAmountXof: number | null;
  serialNumber: string;
  variantId: string | null;
  variantName: string | null;
  /** Pour la vente au poids/volume : quantité décimale (ex: 0.5 kg). Le prix = round(weightQty × salePriceXof) */
  weightQty: number | null;
  /** Label affiché dans le panier pour la vente au poids (ex: "½ kg", "250g") */
  weightLabel: string | null;
}

interface SaleRow {
  id: string;
  saleNumber: string;
  status: string;
  offlineSynced: boolean;
  stockConflict: boolean;
  client: { id: string; fullName: string; phone: string } | null;
  totalXof: number;
  paidAmountXof: number;
  dueAmountXof: number;
  refundedAmountXof: number;
  cancelReason: string | null;
  declaredOperatorName: string | null;
  lines: Array<{
    id: string;
    productName: string;
    quantity: number;
    returnedQty: number;
    unitPriceXof: number;
    lineTotalXof: number;
    serialNumber?: string | null;
    warrantyEndsAt?: string | null;
  }>;
  payments: Array<{ paymentMethodCode: string; amountXof: number; transactionRef: string | null }>;
  createdAt: string;
}

// Option « Dette » : pseudo moyen de paiement côté interface (aucun paiement envoyé, la vente reste due).
const DEBT_METHOD = '__DEBT__';

export default function PosPage() {
  const { activeOperator } = useAuth();
  const { isOnline, apiReachable } = useNetworkStatus();
  const { shopId, activeShop, selectShop } = useActiveOperationalShop();
  const shopType = normalizeShopType(activeShop?.shopType);
  const profile = normalizeBusinessProfile(shopType, activeShop?.businessProfile);

  const [variantTarget, setVariantTarget] = useState<ProductItem | null>(null);
  const [fractionTarget, setFractionTarget] = useState<ProductItem | null>(null);
  const [fractionCustom, setFractionCustom] = useState('');

  const [tab, setTab] = useState<'pos' | 'history'>('pos');
  const [mobilePosPane, setMobilePosPane] = useState<'catalog' | 'cart'>('catalog');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualScanCode, setManualScanCode] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [taxMode, setTaxMode] = useState<TaxMode>('NONE');
  const [taxRateBps, setTaxRateBps] = useState(0);
  const [pendingOffline, setPendingOffline] = useState<OfflineOperationItem[]>([]);
  const [activePromos, setActivePromos] = useState<
    Array<{ id: string; name: string; discountPercent: number; appliesToAll: boolean; productIds: string[] }>
  >([]);

  useEffect(() => {
    if (!shopId) return;
    apiFetch<typeof activePromos>(`/shops/${shopId}/promotions/active`, { shopId, requiresOnline: false })
      .then(setActivePromos)
      .catch(() => setActivePromos([]));
  }, [shopId]);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [cashRoundingStep, setCashRoundingStep] = useState<0 | 5 | 25>(0);
  const [paymentMethodCode, setPaymentMethodCode] = useState('');
  const [amountPaidXof, setAmountPaidXof] = useState<string>('');
  const [transactionRef, setTransactionRef] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [debtDueDate, setDebtDueDate] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err' | 'warn'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Modales historique (Ticket / Annulation / Retour / Remboursement)
  const [activeDoc, setActiveDoc] = useState<SaleDocumentView | null>(null);
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [cancelSaleTarget, setCancelSaleTarget] = useState<SaleRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [returnTarget, setReturnTarget] = useState<SaleRow | null>(null);
  const [returnLineId, setReturnLineId] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnCondition, setReturnCondition] = useState<'RESELLABLE' | 'DAMAGED_LOSS'>('RESELLABLE');
  const [returnReason, setReturnReason] = useState('');
  const [refundTarget, setRefundTarget] = useState<SaleRow | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundMethodCode, setRefundMethodCode] = useState('CASH');
  const [refundReason, setRefundReason] = useState('');

  const loadOfflineQueue = useCallback(async () => {
    if (!shopId) return;
    const queued = await getPendingOfflineSales(shopId);
    setPendingOffline(queued);
  }, [shopId]);

  const loadData = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    await loadOfflineQueue();

    try {
      const [shopDetails, prodRes, clientRes, salesRes] = await Promise.all([
        apiFetch<{
          paymentMethods: PaymentMethodConfig[];
          taxMode: TaxMode;
          defaultTaxRateBps: number;
        }>(`/shops/${shopId}`, { shopId, requiresOnline: false }),
        apiFetch<{ items: ProductItem[] }>(`/shops/${shopId}/products?limit=1000`, {
          shopId,
          requiresOnline: false,
        }),
        apiFetch<ClientItem[]>(`/shops/${shopId}/clients`, { shopId, requiresOnline: false }).catch(
          () => [],
        ),
        apiFetch<{ items: SaleRow[] }>(`/shops/${shopId}/sales?limit=30`, {
          shopId,
          requiresOnline: false,
        }),
      ]);

      const enabledMethods = (shopDetails.paymentMethods || []).filter((m) => m.enabled);
      setPaymentMethods(enabledMethods);
      setPaymentMethodCode((prev) =>
        prev && enabledMethods.some((m) => m.code === prev) ? prev : enabledMethods[0]?.code || '',
      );
      setRefundMethodCode((prev) =>
        prev && enabledMethods.some((m) => m.code === prev) ? prev : enabledMethods[0]?.code || '',
      );
      setTaxMode(shopDetails.taxMode || 'NONE');
      setTaxRateBps(shopDetails.defaultTaxRateBps || 0);

      const sellable = prodRes.items.filter((p) => p.status !== 'ARCHIVED');
      setProducts(sellable);
      setClients(clientRes);
      setSales(salesRes.items);

      // Met à jour le cache local IndexedDB pour le mode dégradé comptoir Option B
      await cacheShopProducts(
        shopId,
        sellable.map((p) => ({ ...p, shopId, cachedAt: new Date().toISOString() })),
      );
    } catch (err) {
      // Fallback sur le cache local IndexedDB si hors-ligne (Option B — Section 14.3)
      const cached = await getCachedShopProducts(shopId);
      if (cached.length > 0) {
        setProducts(cached);
      } else {
        setError(err instanceof ApiError ? err.message : 'Erreur de chargement du point de vente.');
      }
    } finally {
      setLoading(false);
    }
  }, [shopId, loadOfflineQueue]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resolveCartItemUnitPrice = (item: CartItem): number => {
    if (item.customAmountXof && item.customAmountXof > 0) {
      return item.customAmountXof;
    }
    if (item.soldInBulk && item.product.unitsPerBulk && item.product.unitsPerBulk >= 2) {
      return (
        item.product.bulkSalePriceXof ??
        item.product.salePriceXof * item.product.unitsPerBulk
      );
    }
    return item.product.salePriceXof;
  };

  const totals = useMemo(() => {
    if (cart.length === 0) return null;
    return calculateSaleTotals({
      lines: cart.map((c) => {
        // Même règle que le serveur : meilleure promotion active du produit, sans cumul.
        const promoPct = activePromos.reduce(
          (best, p) =>
            (p.appliesToAll || p.productIds.includes(c.product.id)) && p.discountPercent > best ? p.discountPercent : best,
          0,
        );
        return {
          quantity: c.customAmountXof && c.customAmountXof > 0 ? 1 : c.quantity,
          unitPriceXof: resolveCartItemUnitPrice(c),
          ...(promoPct > 0 ? { discountType: 'PERCENT' as const, discountValue: promoPct } : {}),
        };
      }),
      globalDiscountType: discountPercent > 0 ? 'PERCENT' : 'NONE',
      globalDiscountValue: discountPercent,
      taxMode,
      defaultTaxRateBps: taxRateBps,
      cashRoundingStep: paymentMethodCode === 'CASH' ? cashRoundingStep : 0,
    });
  }, [cart, discountPercent, taxMode, taxRateBps, paymentMethodCode, cashRoundingStep, activePromos]);

  const isDebt = paymentMethodCode === DEBT_METHOD;
  const activeMethod = isDebt
    ? undefined
    : paymentMethods.find((m) => m.code === paymentMethodCode) || paymentMethods[0];
  const effectivePaid = isDebt
    ? 0
    : amountPaidXof.trim() === ''
      ? (totals?.totalXof ?? 0)
      : Math.max(0, Math.round(Number(amountPaidXof) || 0));
  const changeDue = totals ? Math.max(0, effectivePaid - totals.totalXof) : 0;
  const creditDue = totals ? Math.max(0, totals.totalXof - effectivePaid) : 0;

  // Création rapide du client débiteur directement depuis la caisse (nom + téléphone).
  const handleCreateDebtClient = async () => {
    if (!shopId) return;
    const fullName = newClientName.trim();
    const phone = newClientPhone.trim();
    if (fullName.length < 2 || phone.length < 6) {
      setFeedback({ type: 'err', msg: 'Renseignez le nom et le téléphone du client débiteur.' });
      return;
    }
    setCreatingClient(true);
    try {
      const created = await apiFetch<ClientItem>(`/shops/${shopId}/clients`, {
        method: 'POST',
        shopId,
        // Plafond = montant de cette dette ; le propriétaire peut l'ajuster ensuite dans « Clients ».
        body: { fullName, phone, creditLimitXof: totals?.totalXof ?? 0 },
      });
      setClients((prev) => [created, ...prev]);
      setSelectedClientId(created.id);
      setNewClientName('');
      setNewClientPhone('');
      setFeedback(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof ApiError ? err.message : 'Impossible de créer le client.',
      });
    } finally {
      setCreatingClient(false);
    }
  };

  const pinnedFavorites = useMemo(
    () => products.filter((p) => p.isPinnedPos),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.modelName && p.modelName.toLowerCase().includes(q)),
    );
  }, [products, search]);

  const filteredSales = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter(
      (s) =>
        s.saleNumber.toLowerCase().includes(q) ||
        (s.client?.fullName && s.client.fullName.toLowerCase().includes(q)) ||
        (s.client?.phone && s.client.phone.toLowerCase().includes(q)) ||
        s.lines.some((l) => l.serialNumber && l.serialNumber.toLowerCase().includes(q)),
    );
  }, [sales, historySearch]);

  // ─── Vente au poids / volume ───────────────────────────────────────────────
  const WEIGHT_UNITS = new Set(['kg', 'Kg', 'KG', 'g', 'G', 'litre', 'Litre', 'l', 'L', 'cl', 'CL', 'ml', 'mL', 'tonne', 't', 'T']);

  const isWeightUnit = (unit: string) => WEIGHT_UNITS.has(unit.trim());

  interface WeightPreset { qty: number; label: string; }

  const getWeightPresets = (unit: string): WeightPreset[] => {
    const u = unit.trim().toLowerCase();
    if (u === 'g') {
      return [
        { qty: 100, label: '100 g' },
        { qty: 250, label: '250 g' },
        { qty: 500, label: '½ kg' },
        { qty: 750, label: '750 g' },
        { qty: 1000, label: '1 kg' },
      ];
    }
    if (u === 'cl' || u === 'ml') {
      return [
        { qty: 25, label: '25 cl' },
        { qty: 50, label: '50 cl' },
        { qty: 75, label: '75 cl' },
        { qty: 100, label: '1 L' },
      ];
    }
    if (u === 'tonne' || u === 't') {
      return [
        { qty: 0.5, label: '½ tonne' },
        { qty: 1, label: '1 tonne' },
        { qty: 2, label: '2 tonnes' },
        { qty: 5, label: '5 tonnes' },
      ];
    }
    // kg, L, litre (par défaut)
    return [
      { qty: 0.25, label: `¼ ${unit}` },
      { qty: 0.5, label: `½ ${unit}` },
      { qty: 0.75, label: `¾ ${unit}` },
      { qty: 1, label: `1 ${unit}` },
      { qty: 1.5, label: `1½ ${unit}` },
      { qty: 2, label: `2 ${unit}` },
      { qty: 3, label: `3 ${unit}` },
      { qty: 5, label: `5 ${unit}` },
    ];
  };

  const addWeightToCart = (product: ProductItem, weightQty: number, weightLabel: string) => {
    const amountXof = Math.round(weightQty * product.salePriceXof);
    setFeedback(null);
    setCart((prev) => {
      // Cherche une ligne existante avec le même poids pour incrémenter
      const idx = prev.findIndex(
        (i) => i.product.id === product.id && i.weightQty === weightQty && i.variantId === null,
      );
      if (idx >= 0) {
        return prev.map((item, i) =>
          i === idx
            ? { ...item, quantity: item.quantity + 1, customAmountXof: (item.customAmountXof ?? 0) + amountXof }
            : item,
        );
      }
      return [
        ...prev,
        {
          key: `${product.id}_w${weightQty}_${Date.now()}`,
          product,
          quantity: 1,
          soldInBulk: false,
          customAmountXof: amountXof,
          serialNumber: '',
          variantId: null,
          variantName: null,
          weightQty,
          weightLabel,
        },
      ];
    });
  };

  const addToCart = (product: ProductItem, soldInBulk = false, variant?: ProductVariant) => {
    setFeedback(null);
    setCart((prev) => {
      // Si l'article nécessite un IMEI/N° de série, chaque unité peut être une ligne ou incrémentée
      const idx = prev.findIndex(
        (i) =>
          i.product.id === product.id &&
          i.soldInBulk === soldInBulk &&
          i.variantId === (variant?.id ?? null) &&
          i.customAmountXof === null &&
          !product.trackSerialNumber,
      );
      if (idx >= 0) {
        return prev.map((item, i) =>
          i === idx ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      const effectivePrice = variant?.salePriceXof ?? product.salePriceXof;
      return [
        ...prev,
        {
          key: `${product.id}_${variant?.id ?? 'base'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          product: { ...product, salePriceXof: effectivePrice },
          quantity: 1,
          soldInBulk,
          customAmountXof: null,
          serialNumber: '',
          variantId: variant?.id ?? null,
          variantName: variant?.name ?? null,
          weightQty: null,
          weightLabel: null,
        },
      ];
    });
  };

  const updateCartQty = (cartKey: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.key !== cartKey) return i;
          const nextQty = i.quantity + delta;
          if (nextQty <= 0) return { ...i, quantity: 0 };
          const nextCustom = i.weightQty
            ? Math.round(i.weightQty * nextQty * i.product.salePriceXof)
            : i.customAmountXof;
          return { ...i, quantity: nextQty, customAmountXof: nextCustom };
        })
        .filter((i) => i.quantity > 0),
    );
  };

  const toggleCartItemBulk = (cartKey: string, soldInBulk: boolean) => {
    setCart((prev) =>
      prev.map((i) =>
        i.key === cartKey
          ? { ...i, soldInBulk, customAmountXof: soldInBulk ? null : i.customAmountXof }
          : i,
      ),
    );
  };

  const updateCartItemCustomAmount = (cartKey: string, rawVal: string) => {
    const num = rawVal.trim() === '' ? null : Math.max(0, Math.round(Number(rawVal) || 0));
    setCart((prev) =>
      prev.map((i) =>
        i.key === cartKey
          ? {
            ...i,
            customAmountXof: num && num > 0 ? num : null,
            soldInBulk: num && num > 0 ? false : i.soldInBulk,
            quantity: num && num > 0 ? 1 : i.quantity,
          }
          : i,
      ),
    );
  };

  const updateCartItemSerial = (cartKey: string, serialNumber: string) => {
    setCart((prev) =>
      prev.map((i) => (i.key === cartKey ? { ...i, serialNumber } : i)),
    );
  };

  // Permet la validation rapide par lecteur code-barres + Entrée
  const handleBarcodeCode = useCallback(
    (code: string): boolean => {
      const clean = code.trim().toLowerCase();
      if (!clean) return false;
      // Chercher d'abord sur le produit de base
      const exact = products.find(
        (p) => p.barcode?.toLowerCase() === clean || p.sku.toLowerCase() === clean,
      );
      if (exact) {
        addToCart(exact);
        setFeedback({ type: 'ok', msg: `Article scanné : ${exact.name}` });
        return true;
      }
      // Chercher dans les variantes
      for (const p of products) {
        if (!p.variants?.length) continue;
        const matchVariant = p.variants.find(
          (v) => v.barcode?.toLowerCase() === clean || v.sku?.toLowerCase() === clean,
        );
        if (matchVariant) {
          addToCart(p, false, matchVariant);
          setFeedback({ type: 'ok', msg: `Article scanné : ${p.name} — ${matchVariant.name}` });
          return true;
        }
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products],
  );

  const handleBarcodeEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (handleBarcodeCode(search)) {
      e.preventDefault();
      setSearch('');
    }
  };

  // Scanner caméra code-barres (BarcodeDetector natif si supporté + saisie rapide)
  useEffect(() => {
    if (!scannerOpen) return;
    let stream: MediaStream | null = null;
    let active = true;
    let timer: number | null = null;

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (BarcodeDetectorCtor) {
          const detector = new BarcodeDetectorCtor({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'qr_code'],
          });
          const detectLoop = async () => {
            if (!active || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes?.length > 0 && codes[0].rawValue) {
                if (handleBarcodeCode(codes[0].rawValue)) {
                  setScannerOpen(false);
                  return;
                }
              }
            } catch {
              // ignore frame errors
            }
            if (active) {
              timer = window.setTimeout(detectLoop, 450);
            }
          };
          timer = window.setTimeout(detectLoop, 600);
        }
      } catch {
        // camera permission denied or unavailable; manual/USB input inside modal still works
      }
    };

    void startCamera();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [scannerOpen, handleBarcodeCode]);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !totals || cart.length === 0) return;

    // Vente à crédit : client identifié + date d'engagement de paiement obligatoires (base des relances).
    if (creditDue > 0) {
      if (!selectedClientId) {
        setFeedback({ type: 'err', msg: 'Choisissez ou créez le client débiteur (nom + téléphone).' });
        return;
      }
      if (!debtDueDate) {
        setFeedback({ type: 'err', msg: 'Indiquez la date à laquelle le client paiera sa dette.' });
        return;
      }
    }

    setBusy(true);
    setFeedback(null);

    const payload = {
      clientOperationId: crypto.randomUUID(),
      clientId: selectedClientId || null,
      ...(creditDue > 0 && debtDueDate
        ? { debtDueDate: new Date(`${debtDueDate}T18:00:00`).toISOString() }
        : {}),
      lines: cart.map((c) => ({
        productId: c.product.id,
        ...(c.variantId ? { variantId: c.variantId } : {}),
        quantity: c.customAmountXof && c.customAmountXof > 0 ? 1 : c.quantity,
        soldInBulk: c.soldInBulk,
        ...(c.weightQty && c.weightQty > 0
          ? {
            fractionalQtyMilli: Math.max(1, Math.round(c.weightQty * c.quantity * 1000)),
            customAmountXof: Math.round(c.weightQty * c.quantity * c.product.salePriceXof),
          }
          : c.customAmountXof && c.customAmountXof > 0
            ? { customAmountXof: c.customAmountXof }
            : {}),
        ...(c.serialNumber.trim() ? { serialNumber: c.serialNumber.trim() } : {}),
      })),
      globalDiscountType: discountPercent > 0 ? 'PERCENT' : 'NONE',
      globalDiscountValue: discountPercent,
      cashRoundingStep: paymentMethodCode === 'CASH' ? cashRoundingStep : 0,
      payments:
        effectivePaid > 0
          ? [
            {
              paymentMethodCode,
              amountXof: effectivePaid,
              transactionRef: transactionRef.trim() || undefined,
            },
          ]
          : [],
    };

    try {
      // Option B (Section 14.3) : si hors-ligne, enregistrement local en file d'attente IndexedDB
      if (!isOnline || !apiReachable) {
        const queued = await enqueueOfflineSale(shopId, payload, totals.totalXof);
        setCart([]);
        setDiscountPercent(0);
        setAmountPaidXof('');
        setTransactionRef('');
        setDebtDueDate('');
        await loadOfflineQueue();
        setFeedback({
          type: 'ok',
          msg: `Vente #${queued.offlineSaleNumber} validée avec succès (${formatXof(totals.totalXof)} XOF).`,
        });
        return;
      }

      const created = await apiFetch<{
        id: string;
        saleNumber: string;
        totalXof: number;
        dueAmountXof: number;
      }>(`/shops/${shopId}/sales`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: payload,
      });

      setCart([]);
      setMobilePosPane('catalog');
      setDiscountPercent(0);
      setAmountPaidXof('');
      setTransactionRef('');
      setSelectedClientId('');
      setDebtDueDate('');
      setFeedback({
        type: 'ok',
        msg: `Vente ${created.saleNumber} validée (${formatXof(created.totalXof)})${created.dueAmountXof > 0 ? ` — Créance : ${formatXof(created.dueAmountXof)}` : ''
          }.`,
      });
      await loadData();
      // Ouvre immédiatement le ticket de caisse prêt à imprimer / PDF / WhatsApp (Lot 3)
      apiFetch<SaleDocumentView[]>(`/shops/${shopId}/documents/by-sale/${created.id}`, { shopId })
        .then((docs) => {
          const receipt = docs.find((d) => d.documentType === 'SALE_RECEIPT') || docs[0];
          if (receipt) setActiveDoc(receipt);
        })
        .catch(() => undefined);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof ApiError ? err.message : 'Erreur lors de la validation de la vente.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSyncOfflineQueue = useCallback(async () => {
    if (!shopId || pendingOffline.length === 0 || busy) return;
    setBusy(true);
    let syncedCount = 0;
    let conflictsCount = 0;

    for (const item of pendingOffline) {
      const currentRetries = item.retryCount ?? 0;
      try {
        const res = await apiFetch<{ stockConflict?: boolean }>(`/shops/${shopId}/sales/sync`, {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: item.payload,
        });
        await updateOfflineSaleStatus(item.id!, res.stockConflict ? 'CONFLICT' : 'SYNCED', undefined, currentRetries);
        syncedCount += 1;
        if (res.stockConflict) conflictsCount += 1;
      } catch (err) {
        const isFatal =
          err instanceof ApiError &&
          err.statusCode >= 400 &&
          err.statusCode < 500 &&
          err.statusCode !== 408 &&
          err.statusCode !== 429;
        const newStatus = isFatal || currentRetries >= 4 ? 'FAILED_FATAL' : 'ERROR';
        await updateOfflineSaleStatus(
          item.id!,
          newStatus,
          err instanceof ApiError ? err.message : 'Échec de synchronisation',
          currentRetries + 1,
        );
      }
    }

    await loadData();
    setBusy(false);
    if (conflictsCount > 0) {
      setFeedback({
        type: 'warn',
        msg: `${conflictsCount} conflit(s) de stock signalé(s) lors de la synchronisation.`,
      });
    }
  }, [shopId, pendingOffline, busy, activeOperator?.id, loadData]);

  // Synchronisation automatique en arrière-plan dès le rétablissement de la connectivité réseau
  useEffect(() => {
    if (isOnline && apiReachable && pendingOffline.length > 0 && !busy) {
      void handleSyncOfflineQueue();
    }
  }, [isOnline, apiReachable, pendingOffline.length, busy, handleSyncOfflineQueue]);

  const openSaleDocument = async (saleId: string, preferredType: 'SALE_RECEIPT' | 'CREDIT_NOTE' = 'SALE_RECEIPT') => {
    if (!shopId) return;
    try {
      const docs = await apiFetch<SaleDocumentView[]>(
        `/shops/${shopId}/documents/by-sale/${saleId}`,
        { shopId },
      );
      const chosen =
        docs.find((d) => d.documentType === preferredType) ||
        docs[docs.length - 1] ||
        null;
      if (chosen) setActiveDoc(chosen);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof ApiError ? err.message : 'Impossible d’ouvrir le justificatif.',
      });
    }
  };

  const handleCancelSale = async () => {
    if (!shopId || !cancelSaleTarget) return;
    setBusy(true);
    setModalErr(null);
    try {
      await apiFetch(`/shops/${shopId}/sales/${cancelSaleTarget.id}/cancel`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { reason: cancelReason, refundCashFromDrawer: true },
      });
      setCancelSaleTarget(null);
      setCancelReason('');
      setFeedback({ type: 'ok', msg: `Vente ${cancelSaleTarget.saleNumber} annulée et stock réintégré.` });
      await loadData();
    } catch (err) {
      setModalErr(err instanceof ApiError ? err.message : 'Annulation refusée.');
    } finally {
      setBusy(false);
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !returnTarget || !returnLineId) return;
    setBusy(true);
    setModalErr(null);
    try {
      await apiFetch(`/shops/${shopId}/sales/${returnTarget.id}/returns`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          reason: returnReason,
          items: [{ saleLineId: returnLineId, quantity: returnQty, condition: returnCondition }],
        },
      });
      setReturnTarget(null);
      setReturnReason('');
      setFeedback({ type: 'ok', msg: `Retour article enregistré sur ${returnTarget.saleNumber}.` });
      await loadData();
    } catch (err) {
      setModalErr(err instanceof ApiError ? err.message : 'Retour refusé.');
    } finally {
      setBusy(false);
    }
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !refundTarget) return;
    setBusy(true);
    setModalErr(null);
    try {
      const refunded = await apiFetch<{ creditNoteNumber?: string }>(
        `/shops/${shopId}/sales/${refundTarget.id}/refunds`,
        {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: {
            amountXof: Math.round(Number(refundAmount) || 0),
            paymentMethodCode: refundMethodCode,
            reason: refundReason.trim(),
          },
        },
      );
      const targetId = refundTarget.id;
      const targetNum = refundTarget.saleNumber;
      setRefundTarget(null);
      setRefundReason('');
      setFeedback({
        type: 'ok',
        msg: `Remboursement de ${formatXof(refundAmount)} enregistré sur ${targetNum}${refunded.creditNoteNumber ? ` (Avoir ${refunded.creditNoteNumber})` : ''
          }. Le chiffre d’affaires net a été actualisé.`,
      });
      await loadData();
      await openSaleDocument(targetId, 'CREDIT_NOTE');
    } catch (err) {
      setModalErr(err instanceof ApiError ? err.message : 'Remboursement refusé.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['OWNER', 'AGENT']}
      title="Ventes & Comptoir POS"
      subtitle="Validation atomique (stock + caisse + créances) · Montants entiers XOF · Mode hors-ligne."
      headerActions={
        <>
          <div className="inline-flex rounded-full border border-white/10 bg-forest-800/80 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTab('pos')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition ${tab === 'pos' ? 'bg-white font-bold text-forest-950' : 'text-[#8aa8a2] hover:text-white'
                }`}
            >
              <span>Comptoir POS</span>
              {pendingOffline.length > 0 ? (
                <span
                  className="inline-flex h-2 w-2 rounded-full bg-amber-400"
                  title={`${pendingOffline.length} vente(s) enregistrée(s) localement`}
                />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`rounded-full px-3 py-1 transition ${tab === 'history' ? 'bg-white font-bold text-forest-950' : 'text-[#8aa8a2] hover:text-white'
                }`}
            >
              Historique ({sales.length})
            </button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
        {feedback ? (
          <div
            role="alert"
            className={`flex items-center gap-2 rounded-xl border p-3.5 text-sm font-medium ${feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : feedback.type === 'warn'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-red-200 bg-red-50 text-red-900'
              }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0" />
            )}
            <span>{feedback.msg}</span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : !shopId ? (
          <EmptyState
            title="Aucune boutique sélectionnée"
            description="Créez ou sélectionnez une boutique pour ouvrir le comptoir de vente."
          />
        ) : tab === 'pos' ? (
          <div className="space-y-4">
            {/* Switcher mobile Catalogue ↔ Panier (< lg) */}
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-white p-1 text-xs font-bold lg:hidden">
              <button
                type="button"
                onClick={() => setMobilePosPane('catalog')}
                className={`rounded-xl py-2 text-center transition ${mobilePosPane === 'catalog'
                  ? 'bg-forest-900 text-white shadow-xs'
                  : 'text-slate-600'
                  }`}
              >
                Catalogue ({filteredProducts.length})
              </button>
              <button
                type="button"
                onClick={() => setMobilePosPane('cart')}
                className={`rounded-xl py-2 text-center transition ${mobilePosPane === 'cart'
                  ? 'bg-forest-900 text-white shadow-xs'
                  : 'text-slate-600'
                  }`}
              >
                Panier ({cart.reduce((a, b) => a + b.quantity, 0)})
              </button>
            </div>

            <div className="grid gap-5 lg:grid-cols-12">
              {/* Catalogue rapide */}
              <div
                className={`min-w-0 space-y-4 lg:col-span-7 xl:col-span-8 ${mobilePosPane === 'cart' ? 'hidden lg:block' : 'block'
                  }`}
              >
                {/* Barre Favoris POS Express (1 clic — Lot 9) */}
                {(profile.enableFastPosFavorites || pinnedFavorites.length > 0) &&
                  pinnedFavorites.length > 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-amber-900">
                      <Pin className="h-3.5 w-3.5 text-amber-700" />
                      <span>Favoris POS Express (ajout 1 clic)</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {pinnedFavorites.map((fav) => (
                        <button
                          key={`fav-${fav.id}`}
                          type="button"
                          onClick={() => addToCart(fav)}
                          className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-900 shadow-xs transition hover:border-forest-900 hover:bg-forest-900 hover:text-white"
                        >
                          <span>{fav.name}</span>
                          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-900 tabular">
                            {formatXof(fav.salePriceXof)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={handleBarcodeEnter}
                      placeholder="Rechercher par nom, SKU, marque ou scanner code-barres…"
                      className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm shadow-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setManualScanCode('');
                      setScannerOpen(true);
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-forest-900 px-3.5 py-2.5 text-xs font-bold text-limeglow-400 shadow-xs hover:bg-forest-800"
                    title="Scanner un code-barres avec la caméra ou lecteur USB"
                  >
                    <Camera className="h-4 w-4" />
                    <span className="hidden sm:inline">Scanner</span>
                  </button>
                </div>

                {filteredProducts.length === 0 ? (
                  <EmptyState
                    title="Aucun produit trouvé"
                    description="Ajoutez vos produits dans l’onglet Produits ou via Import CSV."
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredProducts.map((p) => {
                      const inCartQty = cart
                        .filter((c) => c.product.id === p.id)
                        .reduce((acc, c) => acc + c.quantity, 0);
                      const thumb = p.imageUrls?.[0];
                      const hasBulk = Boolean(p.unitsPerBulk && p.unitsPerBulk >= 2);
                      return (
                        <div
                          key={p.id}
                          className={`flex flex-col justify-between gap-2 rounded-2xl border bg-white p-3 text-left transition hover:border-forest-800 hover:shadow-card sm:p-3.5 ${inCartQty > 0 ? 'border-forest-900 ring-1 ring-forest-900/15' : 'border-slate-200'
                            }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (p.variants && p.variants.filter(v => v.isActive !== false).length > 0) {
                                setVariantTarget(p);
                              } else if (isWeightUnit(p.unit)) {
                                setFractionCustom('');
                                setFractionTarget(p);
                              } else {
                                addToCart(p, false);
                              }
                            }}
                            className="flex w-full flex-col gap-2.5 text-left"
                          >
                            <div className="flex w-full items-start justify-between gap-2">
                              {thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={thumb}
                                  alt={p.name}
                                  className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 object-cover bg-porcelain-50"
                                />
                              ) : (
                                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                                  <Package className="h-5 w-5" />
                                </span>
                              )}
                              <div className="flex flex-col items-end gap-1">
                                <span className="shrink-0 rounded-xl bg-brand-50 px-2.5 py-1 text-xs font-black text-brand-800 tabular sm:text-sm">
                                  {formatXof(p.salePriceXof)}
                                </span>
                                {inCartQty > 0 ? (
                                  <span className="shrink-0 rounded-full bg-forest-900 px-2 py-0.5 text-[10px] font-bold text-limeglow-400">
                                    ×{inCartQty} au panier
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="w-full min-w-0">
                              <p className="line-clamp-2 text-sm font-bold text-slate-900" title={p.name}>
                                {p.name}
                              </p>
                              <p className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                                <span className="truncate">{p.sku}</span>
                                <span
                                  className={
                                    (p.stockAvailableDecimal ?? p.stockAvailable) <= 0
                                      ? 'shrink-0 font-bold text-rose-600'
                                      : 'shrink-0 font-semibold text-emerald-700'
                                  }
                                >
                                  {p.stockAvailableDecimal ?? p.stockAvailable} {p.unit}
                                </span>
                              </p>
                            </div>
                          </button>

                          {(hasBulk || p.allowFractionalSale || p.warrantyMonths || (p.variants && p.variants.length > 0) || isWeightUnit(p.unit)) && (
                            <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-2">
                              <div className="flex flex-wrap gap-1">
                                {isWeightUnit(p.unit) ? (
                                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                    ⚖️ Vente ¼·½·¾ {p.unit}
                                  </span>
                                ) : null}
                                {p.variants && p.variants.length > 0 ? (
                                  <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">
                                    {p.variants.length} variante{p.variants.length > 1 ? 's' : ''}
                                  </span>
                                ) : null}
                                {p.allowFractionalSale ? (
                                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
                                    Vente au montant
                                  </span>
                                ) : null}
                                {p.warrantyMonths ? (
                                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                                    Garantie {p.warrantyMonths}m
                                  </span>
                                ) : null}
                              </div>
                              {hasBulk ? (
                                <button
                                  type="button"
                                  onClick={() => addToCart(p, true)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800 hover:bg-emerald-100"
                                >
                                  <Boxes className="h-3 w-3" />+ {p.bulkUnitLabel || 'carton'} (×{p.unitsPerBulk})
                                </button>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Panier & Encaissement */}
              <form
                onSubmit={handleCheckout}
                className={`min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5 lg:col-span-5 lg:flex xl:col-span-4 ${mobilePosPane === 'cart' ? 'flex' : 'hidden lg:flex'
                  }`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      {activeShop?.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activeShop.logoUrl}
                          alt={activeShop.shopName || 'Logo'}
                          className="h-8 w-8 rounded-xl border border-slate-200 bg-white object-contain p-0.5 shadow-2xs"
                        />
                      ) : (
                        <ShoppingCart className="h-5 w-5 text-brand-700" />
                      )}
                      <div>
                        <span className="leading-tight">Panier ({cart.reduce((a, b) => a + b.quantity, 0)})</span>
                        {activeShop?.shopName ? (
                          <p className="text-[10px] font-medium text-slate-500 leading-none mt-0.5">{activeShop.shopName}</p>
                        ) : null}
                      </div>
                    </div>
                    {cart.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setCart([])}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Vider
                      </button>
                    ) : null}
                  </div>

                  {cart.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-400">
                      Cliquez sur un article à gauche ou scannez son code-barres.
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                      {cart.map((item) => {
                        const unitPrice = resolveCartItemUnitPrice(item);
                        const effQty =
                          item.customAmountXof && item.customAmountXof > 0 ? 1 : item.quantity;
                        const hasBulk = Boolean(
                          item.product.unitsPerBulk && item.product.unitsPerBulk >= 2,
                        );
                        const computedFractionQty =
                          item.customAmountXof &&
                            item.customAmountXof > 0 &&
                            item.product.salePriceXof > 0
                            ? Number(
                              ((item.customAmountXof / item.product.salePriceXof)).toFixed(3),
                            )
                              .toString()
                              .replace('.', ',')
                            : null;

                        return (
                          <div
                            key={item.key}
                            className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-2.5 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-slate-900">
                                  {item.product.name}
                                  {item.soldInBulk
                                    ? ` [${item.product.bulkUnitLabel || 'carton'} ×${item.product.unitsPerBulk}]`
                                    : ''}
                                </p>
                                {item.variantName ? (
                                  <span className="inline-flex items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">
                                    {item.variantName}
                                  </span>
                                ) : null}
                                {item.weightLabel ? (
                                  <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                    ⚖️ {item.weightLabel}
                                  </span>
                                ) : null}
                                <p className="text-xs text-slate-500">
                                  {item.weightLabel ? (
                                    <span>
                                      Poids : <strong>{item.weightLabel}</strong> ({item.weightQty} {item.product.unit})
                                      {item.quantity > 1 ? ` × ${item.quantity}` : ''} ={' '}
                                      <strong>{formatXof(unitPrice)}</strong>
                                    </span>
                                  ) : computedFractionQty ? (
                                    <span>
                                      Montant libre : <strong>{formatXof(unitPrice)}</strong> ({computedFractionQty}{' '}
                                      {item.product.unit})
                                    </span>
                                  ) : (
                                    <span>
                                      {formatXof(unitPrice)} × {effQty} ={' '}
                                      <strong>{formatXof(unitPrice * effQty)}</strong>
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                {!computedFractionQty || item.weightLabel ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => updateCartQty(item.key, -1)}
                                      aria-label="Diminuer quantité"
                                      className="rounded-lg border border-slate-300 bg-white p-1 hover:bg-slate-100"
                                    >
                                      <Minus className="h-3.5 w-3.5" />
                                    </button>
                                    <span className="w-7 text-center font-bold">{item.quantity}</span>
                                    <button
                                      type="button"
                                      onClick={() => updateCartQty(item.key, 1)}
                                      aria-label="Augmenter quantité"
                                      className="rounded-lg border border-slate-300 bg-white p-1 hover:bg-slate-100"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => updateCartQty(item.key, -item.quantity)}
                                  aria-label="Retirer"
                                  className="ml-1 rounded-lg p-1 text-red-500 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Bascule Détail ↔ Gros (Carton/Sac — Lot 9) */}
                            {hasBulk ? (
                              <div className="grid grid-cols-2 gap-1 rounded-lg bg-white p-1 text-[11px] font-bold">
                                <button
                                  type="button"
                                  onClick={() => toggleCartItemBulk(item.key, false)}
                                  className={`rounded-md py-1 transition ${!item.soldInBulk
                                    ? 'bg-forest-900 text-white'
                                    : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                  Détail ({item.product.unit}) · {formatXof(item.product.salePriceXof)}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleCartItemBulk(item.key, true)}
                                  className={`rounded-md py-1 transition ${item.soldInBulk
                                    ? 'bg-forest-900 text-limeglow-400'
                                    : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                                >
                                  {item.product.bulkUnitLabel || 'Carton'} (×{item.product.unitsPerBulk}) ·{' '}
                                  {formatXof(
                                    item.product.bulkSalePriceXof ??
                                    item.product.salePriceXof * (item.product.unitsPerBulk || 1),
                                  )}
                                </button>
                              </div>
                            ) : null}

                            {/* Vente au montant / fraction (ex. 250 FCFA de sucre — Lot 9) */}
                            {item.product.allowFractionalSale && !item.soldInBulk ? (
                              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-1.5 text-[11px]">
                                <Scale className="h-3.5 w-3.5 shrink-0 text-sky-700" />
                                <span className="font-bold text-sky-950">Au montant (FCFA) :</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={item.customAmountXof ?? ''}
                                  onChange={(e) =>
                                    updateCartItemCustomAmount(item.key, e.target.value)
                                  }
                                  placeholder={`ex. 250 (= ${Number((250 / Math.max(1, item.product.salePriceXof)).toFixed(2))} ${item.product.unit})`}
                                  className="w-28 rounded-md border border-sky-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-900 tabular"
                                />
                                {[100, 250, 500].map((amt) => (
                                  <button
                                    key={amt}
                                    type="button"
                                    onClick={() => updateCartItemCustomAmount(item.key, String(amt))}
                                    className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-sky-800 shadow-2xs hover:bg-sky-100"
                                  >
                                    {amt} F
                                  </button>
                                ))}
                                {item.customAmountXof ? (
                                  <button
                                    type="button"
                                    onClick={() => updateCartItemCustomAmount(item.key, '')}
                                    className="text-[10px] font-bold text-rose-600 hover:underline"
                                  >
                                    Reset
                                  </button>
                                ) : null}
                              </div>
                            ) : null}

                            {/* N° de série / IMEI (Lot 10 Électronique) */}
                            {item.product.trackSerialNumber || profile.enableSerialWarranty ? (
                              <div className="flex items-center gap-1.5">
                                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-indigo-700" />
                                <input
                                  required={Boolean(item.product.trackSerialNumber)}
                                  value={item.serialNumber}
                                  onChange={(e) => updateCartItemSerial(item.key, e.target.value)}
                                  placeholder={
                                    item.product.trackSerialNumber
                                      ? 'N° de série / IMEI obligatoire *'
                                      : 'N° de série / IMEI (optionnel)'
                                  }
                                  className="w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1 font-mono text-xs"
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Remise globale (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={activeShop?.maxDiscountPercent ?? 100}
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(Number(e.target.value) || 0)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Client (requis si crédit)
                      </label>
                      <select
                        value={selectedClientId}
                        onChange={(e) => setSelectedClientId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                      >
                        <option value="">Client comptoir</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.fullName} ({c.phone})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Moyen de paiement
                      </label>
                      <select
                        value={paymentMethodCode}
                        onChange={(e) => setPaymentMethodCode(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                      >
                        {paymentMethods.map((m) => (
                          <option key={m.code} value={m.code}>
                            {m.label}
                          </option>
                        ))}
                        <option value={DEBT_METHOD}>Dette (paiement différé)</option>
                      </select>
                    </div>
                    {isDebt ? (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                        Aucun encaissement maintenant : {totals ? formatXof(totals.totalXof) : '0 F'} seront
                        enregistrés comme dette.
                      </div>
                    ) : (
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-slate-700">
                          Montant reçu (XOF)
                        </label>
                        {selectedClientId ? (
                          <button
                            type="button"
                            onClick={() => setAmountPaidXof('0')}
                            className="inline-flex items-center gap-1 text-[11px] font-extrabold text-amber-800 hover:underline"
                          >
                            <Wallet className="h-3 w-3" />
                            Mettre en dette (0 F)
                          </button>
                        ) : null}
                      </div>
                      <input
                        type="number"
                        min={0}
                        placeholder={totals ? String(totals.totalXof) : '0'}
                        value={amountPaidXof}
                        onChange={(e) => setAmountPaidXof(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold"
                      />
                    </div>
                    )}
                  </div>

                  {activeMethod && activeMethod.code !== 'CASH' ? (
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Référence transaction {activeMethod.label} (facultative, unique si saisie)
                      </label>
                      <input
                        value={transactionRef}
                        onChange={(e) => setTransactionRef(e.target.value)}
                        placeholder="ex. OM261119.123456"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                      />
                    </div>
                  ) : null}

                  {activePromos.length > 0 ? (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
                      Promotion en cours : {activePromos.map((p) => `${p.name} (−${p.discountPercent} %)`).join(', ')} —
                      appliquée automatiquement.
                    </p>
                  ) : null}

                  {shopId ? (
                    <PosGrowthPanel
                      shopId={shopId}
                      clientId={selectedClientId}
                    />
                  ) : null}

                  {creditDue > 0 ? (
                    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3">
                      <p className="text-xs font-extrabold text-amber-900">
                        Dette de {formatXof(creditDue)} — renseignez le débiteur et la date de paiement.
                        Des rappels automatiques seront envoyés avant et après l’échéance.
                      </p>
                      {selectedClientId ? (
                        <p className="text-xs text-amber-900">
                          Débiteur :{' '}
                          <strong>
                            {clients.find((c) => c.id === selectedClientId)?.fullName ?? 'client sélectionné'}
                          </strong>{' '}
                          ({clients.find((c) => c.id === selectedClientId)?.phone ?? ''})
                        </p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                          <input
                            value={newClientName}
                            onChange={(e) => setNewClientName(e.target.value)}
                            placeholder="Nom du client *"
                            aria-label="Nom du client débiteur"
                            maxLength={120}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm"
                          />
                          <input
                            value={newClientPhone}
                            onChange={(e) => setNewClientPhone(e.target.value)}
                            placeholder="Téléphone *"
                            aria-label="Téléphone du client débiteur"
                            inputMode="tel"
                            maxLength={30}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => void handleCreateDebtClient()}
                            disabled={creatingClient}
                            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                          >
                            {creatingClient ? '…' : 'Ajouter'}
                          </button>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-amber-900">
                          Date de paiement promise *
                        </label>
                        <input
                          type="date"
                          required
                          min={new Date().toISOString().slice(0, 10)}
                          value={debtDueDate}
                          onChange={(e) => setDebtDueDate(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                  ) : null}

                  {paymentMethodCode === 'CASH' ? (
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>Arrondi espèces tracé :</span>
                      <div className="inline-flex gap-1">
                        {([0, 5, 25] as const).map((step) => (
                          <button
                            key={step}
                            type="button"
                            onClick={() => setCashRoundingStep(step)}
                            className={`rounded-md px-2 py-1 font-semibold ${cashRoundingStep === step
                              ? 'bg-brand-700 text-white'
                              : 'bg-slate-100 text-slate-700'
                              }`}
                          >
                            {step === 0 ? 'Aucun' : `${step} F`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Récapitulatif XOF & validation */}
                <div className="mt-5 space-y-2 border-t border-slate-200 pt-4 text-sm">
                  {totals ? (
                    <>
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>Sous-total brut</span>
                        <span>{formatXof(totals.grossSubtotalXof)}</span>
                      </div>
                      {totals.discountTotalXof > 0 ? (
                        <div className="flex justify-between text-xs text-emerald-700">
                          <span>Remise ({totals.effectiveDiscountPercent} %)</span>
                          <span>- {formatXof(totals.discountTotalXof)}</span>
                        </div>
                      ) : null}
                      {totals.taxTotalXof > 0 ? (
                        <div className="flex justify-between text-xs text-slate-600">
                          <span>Taxes ({taxMode})</span>
                          <span>{formatXof(totals.taxTotalXof)}</span>
                        </div>
                      ) : null}
                      {totals.roundingXof !== 0 ? (
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>Ligne d’arrondi</span>
                          <span>{totals.roundingXof > 0 ? '+' : ''}{formatXof(totals.roundingXof)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between text-lg font-bold text-slate-900">
                        <span>TOTAL À PAYER</span>
                        <span>{formatXof(totals.totalXof)}</span>
                      </div>
                      {changeDue > 0 ? (
                        <p className="text-xs font-semibold text-emerald-700">
                          Monnaie à rendre : {formatXof(changeDue)}
                        </p>
                      ) : null}
                      {creditDue > 0 ? (
                        <p className="text-xs font-semibold text-amber-800">
                          Solde dû (créance client) : {formatXof(creditDue)}
                        </p>
                      ) : null}
                    </>
                  ) : null}

                  <button
                    type="submit"
                    disabled={busy || cart.length === 0}
                    className="mt-2 w-full rounded-xl bg-forest-900 px-4 py-3 text-sm font-bold text-white hover:bg-forest-800 disabled:opacity-50"
                  >
                    {busy
                      ? 'Validation…'
                      : !isOnline || !apiReachable
                        ? 'Enregistrer localement (Hors-ligne)'
                        : 'Valider la vente'}
                  </button>
                </div>
              </form>
            </div>

            {/* Barre flottante mobile d'accès rapide au panier (au-dessus du dock mobile) */}
            {mobilePosPane === 'catalog' && cart.length > 0 && totals ? (
              <div className="fixed inset-x-3 bottom-[68px] z-20 flex items-center justify-between gap-3 rounded-2xl border border-limeglow-400/30 bg-forest-950 px-4 py-3 text-white shadow-2xl lg:hidden">
                <div className="min-w-0">
                  <p className="text-[11px] text-emerald-200/80">
                    {cart.reduce((a, b) => a + b.quantity, 0)} article(s) dans le panier
                  </p>
                  <p className="truncate text-base font-bold text-white">
                    {formatXof(totals.totalXof)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobilePosPane('cart')}
                  className="shrink-0 rounded-full bg-limeglow-400 px-4 py-2 text-xs font-bold text-forest-950 shadow-sm"
                >
                  Encaisser →
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          /* Historique des ventes + Recherche SAV N° de série / IMEI */
          <div className="space-y-3">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Rechercher N° vente, client ou N° de série / IMEI (SAV)…"
                className="sc-input pl-10"
              />
            </div>

            {filteredSales.length === 0 ? (
              <EmptyState
                title="Aucune vente trouvée"
                description="Les ventes validées au comptoir POS ou correspondant à votre recherche IMEI apparaîtront ici."
              />
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {filteredSales.map((sale) => (
                    <div
                      key={`m-${sale.id}`}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-bold text-slate-900">{sale.saleNumber}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {formatDateTimeInTimezone(sale.createdAt)}
                          </p>
                          {sale.client || sale.declaredOperatorName ? (
                            <p className="text-xs text-slate-500">
                              {sale.client ? sale.client.fullName : 'Client comptoir'}
                              {sale.declaredOperatorName ? ` · Op. ${sale.declaredOperatorName}` : ''}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${sale.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                            }`}
                        >
                          {sale.status === 'COMPLETED' ? 'Validée' : 'Annulée'}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center text-xs">
                        <div>
                          <p className="text-[10px] text-slate-500">Total</p>
                          <p className="font-bold text-slate-900">{formatXof(sale.totalXof)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">Payé</p>
                          <p className="font-semibold text-emerald-700">
                            {formatXof(sale.paidAmountXof)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">Dû / Remb.</p>
                          <p className="font-semibold text-amber-700">
                            {sale.dueAmountXof > 0
                              ? formatXof(sale.dueAmountXof)
                              : sale.refundedAmountXof > 0
                                ? `-${formatXof(sale.refundedAmountXof)}`
                                : '0 F'}
                          </p>
                        </div>
                      </div>

                      {sale.status === 'COMPLETED' ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => openSaleDocument(sale.id, 'SALE_RECEIPT')}
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-forest-900 py-2 text-xs font-bold text-white"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            Ticket
                          </button>
                          {sale.refundedAmountXof > 0 ? (
                            <button
                              type="button"
                              onClick={() => openSaleDocument(sale.id, 'CREDIT_NOTE')}
                              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-rose-50 py-2 text-xs font-bold text-rose-700"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Avoir
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setModalErr(null);
                              setReturnTarget(sale);
                              setReturnLineId(sale.lines[0]?.id || '');
                              setReturnQty(1);
                              setReturnReason('');
                            }}
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            Retour
                          </button>
                          {sale.paidAmountXof - sale.refundedAmountXof > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setModalErr(null);
                                setRefundTarget(sale);
                                setRefundAmount(
                                  Math.max(0, sale.paidAmountXof - sale.refundedAmountXof),
                                );
                                setRefundMethodCode(sale.payments[0]?.paymentMethodCode || 'CASH');
                                setRefundReason('');
                              }}
                              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-amber-300 bg-amber-50 py-2 text-xs font-bold text-amber-900"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Remb.
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setModalErr(null);
                              setCancelSaleTarget(sale);
                              setCancelReason('');
                            }}
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-red-50 py-2 text-xs font-semibold text-red-700"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-xs text-slate-500">
                            {sale.cancelReason ? `Motif : ${sale.cancelReason}` : 'Vente annulée'}
                          </p>
                          <button
                            type="button"
                            onClick={() => openSaleDocument(sale.id, 'SALE_RECEIPT')}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700"
                          >
                            Voir ticket ANNULÉ
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                      <tr>
                        <th className="px-4 py-3">N° Vente</th>
                        <th className="px-4 py-3">Date & Opérateur</th>
                        <th className="px-4 py-3">Total / Payé / Dû</th>
                        <th className="px-4 py-3">Statut</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSales.map((sale) => (
                        <tr key={sale.id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-bold text-slate-900">
                              {sale.saleNumber}
                            </p>
                            <p className="text-xs text-slate-500">
                              {sale.lines.length} ligne(s)
                              {sale.client ? ` · ${sale.client.fullName}` : ''}
                            </p>
                            {sale.lines.some((l) => l.serialNumber) ? (
                              <p className="mt-0.5 font-mono text-[10px] font-semibold text-indigo-700">
                                IMEI :{' '}
                                {sale.lines
                                  .map((l) => l.serialNumber)
                                  .filter(Boolean)
                                  .join(', ')}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            <p>{formatDateTimeInTimezone(sale.createdAt)}</p>
                            {sale.declaredOperatorName ? (
                              <p className="text-slate-400">
                                Opérateur : {sale.declaredOperatorName}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <p className="font-bold text-slate-900">{formatXof(sale.totalXof)}</p>
                            <p className="text-slate-500">
                              Payé : {formatXof(sale.paidAmountXof)}
                              {sale.dueAmountXof > 0 ? (
                                <span className="ml-1 font-semibold text-amber-700">
                                  · Dû : {formatXof(sale.dueAmountXof)}
                                </span>
                              ) : null}
                              {sale.refundedAmountXof > 0 ? (
                                <span className="ml-1 font-semibold text-red-600">
                                  · Remb. : {formatXof(sale.refundedAmountXof)}
                                </span>
                              ) : null}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col items-start gap-1">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${sale.status === 'COMPLETED'
                                  ? sale.refundedAmountXof >= sale.paidAmountXof && sale.paidAmountXof > 0
                                    ? 'bg-amber-50 text-amber-800'
                                    : 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-50 text-rose-700'
                                  }`}
                              >
                                {sale.status === 'COMPLETED'
                                  ? sale.refundedAmountXof >= sale.paidAmountXof && sale.paidAmountXof > 0
                                    ? 'Remboursée'
                                    : sale.refundedAmountXof > 0
                                      ? 'Remb. partiel'
                                      : 'Validée'
                                  : 'Annulée'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openSaleDocument(sale.id, 'SALE_RECEIPT')}
                                className="inline-flex items-center gap-1 rounded-lg bg-forest-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-forest-800"
                              >
                                <Printer className="h-3.5 w-3.5" />
                                Ticket
                              </button>
                              {sale.refundedAmountXof > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openSaleDocument(sale.id, 'CREDIT_NOTE')}
                                  className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  Avoir
                                </button>
                              ) : null}
                              {sale.status === 'COMPLETED' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setModalErr(null);
                                      setReturnTarget(sale);
                                      setReturnLineId(sale.lines[0]?.id || '');
                                      setReturnQty(1);
                                      setReturnReason('');
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                  >
                                    <Undo2 className="h-3.5 w-3.5" />
                                    Retour
                                  </button>
                                  {sale.paidAmountXof - sale.refundedAmountXof > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setModalErr(null);
                                        setRefundTarget(sale);
                                        setRefundAmount(
                                          Math.max(0, sale.paidAmountXof - sale.refundedAmountXof),
                                        );
                                        setRefundMethodCode(sale.payments[0]?.paymentMethodCode || 'CASH');
                                        setRefundReason('');
                                      }}
                                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      Rembourser
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setModalErr(null);
                                      setCancelSaleTarget(sale);
                                      setCancelReason('');
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                    Annuler
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Modal Sélecteur de Poids / Fraction */}
        {fractionTarget ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-forest-950/70 p-4 backdrop-blur-xs sm:items-center">
            <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">⚖️ {fractionTarget.name}</h3>
                  <p className="text-xs text-slate-500">
                    {formatXof(fractionTarget.salePriceXof)} / {fractionTarget.unit} — Choisissez la quantité
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFractionTarget(null)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Presets rapides */}
              <div className="grid grid-cols-4 gap-2">
                {getWeightPresets(fractionTarget.unit).map((preset) => {
                  const price = Math.round(preset.qty * fractionTarget.salePriceXof);
                  return (
                    <button
                      key={preset.qty}
                      type="button"
                      onClick={() => {
                        addWeightToCart(fractionTarget, preset.qty, preset.label);
                        setFractionTarget(null);
                        setFeedback({ type: 'ok', msg: `${fractionTarget.name} · ${preset.label} → ${formatXof(price)} ajouté.` });
                      }}
                      className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-center transition hover:border-forest-900 hover:bg-forest-50 active:scale-95"
                    >
                      <span className="text-sm font-extrabold text-slate-900">{preset.label}</span>
                      <span className="mt-0.5 text-[10px] font-semibold text-emerald-700">{formatXof(price)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Saisie libre */}
              <div className="border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs font-semibold text-slate-600">Quantité libre :</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={fractionCustom}
                      onChange={(e) => setFractionCustom(e.target.value)}
                      placeholder={`Ex: 1.75`}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-forest-900 focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && fractionCustom) {
                          const qty = parseFloat(fractionCustom);
                          if (qty > 0) {
                            addWeightToCart(fractionTarget, qty, `${qty} ${fractionTarget.unit}`);
                            setFractionTarget(null);
                            setFractionCustom('');
                          }
                        }
                      }}
                    />
                    <span className="pointer-events-none absolute right-3 top-2.5 text-sm font-bold text-slate-500">
                      {fractionTarget.unit}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={!fractionCustom || parseFloat(fractionCustom) <= 0}
                    onClick={() => {
                      const qty = parseFloat(fractionCustom);
                      if (qty > 0) {
                        addWeightToCart(fractionTarget, qty, `${qty} ${fractionTarget.unit}`);
                        setFractionTarget(null);
                        setFractionCustom('');
                        setFeedback({ type: 'ok', msg: `${fractionTarget.name} · ${qty} ${fractionTarget.unit} → ${formatXof(Math.round(qty * fractionTarget.salePriceXof))} ajouté.` });
                      }
                    }}
                    className="shrink-0 rounded-xl bg-forest-900 px-4 py-2.5 text-sm font-bold text-limeglow-400 disabled:opacity-40 hover:bg-forest-800"
                  >
                    + Ajouter
                  </button>
                </div>
                {fractionCustom && parseFloat(fractionCustom) > 0 ? (
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    → {formatXof(Math.round(parseFloat(fractionCustom) * fractionTarget.salePriceXof))}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal Sélecteur de Variante */}
        {variantTarget ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-forest-950/70 p-4 backdrop-blur-xs sm:items-center">
            <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">{variantTarget.name}</h3>
                  <p className="text-xs text-slate-500">Choisissez une variante</p>
                </div>
                <button
                  type="button"
                  onClick={() => setVariantTarget(null)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(variantTarget.variants ?? [])
                  .filter((v) => v.isActive !== false)
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        addToCart(variantTarget, false, v);
                        setVariantTarget(null);
                        setFeedback({ type: 'ok', msg: `${variantTarget.name} — ${v.name} ajouté.` });
                      }}
                      className="flex flex-col items-start rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-forest-900 hover:bg-forest-50"
                    >
                      <span className="font-bold text-slate-900 text-sm">{v.name}</span>
                      {v.salePriceXof != null ? (
                        <span className="mt-1 rounded-lg bg-limeglow-100 px-2 py-0.5 text-xs font-extrabold text-forest-900">
                          {formatXof(v.salePriceXof)}
                        </span>
                      ) : null}
                      {v.stockAvailable != null ? (
                        <span className={`mt-1 text-[10px] font-semibold ${v.stockAvailable <= 0 ? (variantTarget.stockAvailable > 0 ? 'text-amber-700' : 'text-rose-600') : 'text-emerald-700'}`}>
                          Stock : {v.stockAvailable > 0 ? v.stockAvailable : (variantTarget.stockAvailable > 0 ? `${v.stockAvailable} (Global : ${variantTarget.stockAvailable})` : 0)}
                        </span>
                      ) : null}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Modale Scanner Code-Barres (Caméra + Lecteur USB/Saisie rapide) */}
        {scannerOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md space-y-4 rounded-3xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Camera className="h-5 w-5 text-brand-700" />
                  <h3 className="text-base font-extrabold text-slate-900">
                    Scanner un code-barres / SKU
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(false)}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="relative h-48 w-full overflow-hidden rounded-2xl bg-forest-950">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-limeglow-400 shadow-lime" />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (handleBarcodeCode(manualScanCode)) {
                    setScannerOpen(false);
                  } else {
                    setFeedback({
                      type: 'err',
                      msg: `Aucun article ne correspond au code « ${manualScanCode} ».`,
                    });
                    setScannerOpen(false);
                  }
                }}
                className="space-y-2"
              >
                <label className="block text-xs font-semibold text-slate-700">
                  Ou bippez avec votre douchette USB / saisissez le code :
                </label>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={manualScanCode}
                    onChange={(e) => setManualScanCode(e.target.value)}
                    placeholder="Code-barres EAN ou SKU…"
                    className="sc-input font-mono"
                  />
                  <button type="submit" className="sc-btn-primary shrink-0 px-4">
                    Ajouter
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {/* Modale Annulation vente */}
        {cancelSaleTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">
                Annuler la vente {cancelSaleTarget.saleNumber}
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                La vente reste dans l’historique avec mention ANNULÉ et réintègre les articles en stock.
              </p>
              {modalErr ? (
                <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {modalErr}
                </div>
              ) : null}
              <textarea
                rows={3}
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Motif d’annulation obligatoire (5+ caractères)…"
                className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm"
              />
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setCancelSaleTarget(null)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 sm:w-auto"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={busy || cancelReason.trim().length < 5}
                  onClick={handleCancelSale}
                  className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                >
                  Confirmer l’annulation
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modale Retour article */}
        {returnTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form
              onSubmit={handleReturnSubmit}
              className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6"
            >
              <h3 className="text-lg font-bold text-slate-900">
                Retour article — {returnTarget.saleNumber}
              </h3>
              {modalErr ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {modalErr}
                </div>
              ) : null}
              <div>
                <label className="block text-xs font-medium text-slate-700">Article</label>
                <select
                  value={returnLineId}
                  onChange={(e) => setReturnLineId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {returnTarget.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.productName} (max {l.quantity - l.returnedQty})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Quantité</label>
                  <input
                    type="number"
                    min={1}
                    value={returnQty}
                    onChange={(e) => setReturnQty(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">État</label>
                  <select
                    value={returnCondition}
                    onChange={(e) =>
                      setReturnCondition(e.target.value as 'RESELLABLE' | 'DAMAGED_LOSS')
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="RESELLABLE">Revendable (retour stock)</option>
                    <option value="DAMAGED_LOSS">Non revendable (perte)</option>
                  </select>
                </div>
              </div>
              <textarea
                rows={2}
                required
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Motif du retour…"
                className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 sm:w-auto"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-forest-900 px-4 py-2 text-sm font-semibold text-white sm:w-auto"
                >
                  Enregistrer retour
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Remboursement (avec mode de remboursement + erreur inline + génération Avoir) */}
        {refundTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleRefundSubmit}
              className="max-h-[90dvh] w-full max-w-md space-y-3.5 overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
            >
              <h3 className="text-lg font-extrabold text-slate-900">
                Remboursement & Avoir — {refundTarget.saleNumber}
              </h3>
              <p className="text-xs text-slate-600">
                Maximum remboursable :{' '}
                <strong className="text-slate-900 tabular">
                  {formatXof(refundTarget.paidAmountXof - refundTarget.refundedAmountXof)}
                </strong>
                . Le montant remboursé sera immédiatement déduit du chiffre d’affaires net et un
                avoir numéroté sera généré.
              </p>

              {modalErr ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {modalErr}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Montant à rembourser (XOF) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={refundTarget.paidAmountXof - refundTarget.refundedAmountXof}
                    required
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(Number(e.target.value) || 0)}
                    className="sc-input mt-1 font-bold tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Mode de remboursement *
                  </label>
                  <select
                    value={refundMethodCode}
                    onChange={(e) => setRefundMethodCode(e.target.value)}
                    className="sc-input mt-1"
                  >
                    {paymentMethods.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Motif obligatoire (5+ caractères) *
                </label>
                <textarea
                  rows={2}
                  required
                  minLength={5}
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Ex. Article retourné par le client / erreur facturation…"
                  className="sc-input mt-1"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setRefundTarget(null);
                    setModalErr(null);
                  }}
                  className="sc-btn-ghost w-full sm:w-auto"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy || refundReason.trim().length < 5 || refundAmount <= 0}
                  className="sc-btn-primary w-full sm:w-auto"
                >
                  {busy ? 'Enregistrement…' : 'Confirmer le remboursement'}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modale Ticket de caisse / Avoir (Lot 3) */}
        {activeDoc && shopId ? (
          <ReceiptModal
            shopId={shopId}
            document={activeDoc}
            onClose={() => setActiveDoc(null)}
            onUpdated={(d) => setActiveDoc(d)}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
