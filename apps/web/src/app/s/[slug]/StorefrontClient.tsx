'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Boxes,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  LogOut,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Palette,
  Phone,
  Plus,
  Receipt,
  RotateCcw,
  Ruler,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Truck,
  User,
  X,
} from 'lucide-react';
import {
  BusinessProfileConfig,
  canShopDeliver,
  formatDateTimeInTimezone,
  formatXof,
  FulfillmentMode,
  normalizeBusinessProfile,
  normalizeShopType,
  ONLINE_ORDER_STATUS_LABELS,
  OnlineOrderStatus,
  ShopType,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';

const COLOR_HEX_MAP: Record<string, string> = {
  noir: '#111827',
  blanc: '#ffffff',
  'bleu marine': '#1e3a8a',
  'bleu ciel': '#38bdf8',
  bleu: '#2563eb',
  rouge: '#dc2626',
  vert: '#16a34a',
  beige: '#e5d3b3',
  marron: '#78350f',
  gris: '#6b7280',
  jaune: '#eab308',
  rose: '#ec4899',
  doré: '#ca8a04',
  or: '#ca8a04',
  kaki: '#4d7c0f',
  orange: '#ea580c',
  violet: '#7c3aed',
};

function swatchHex(name: string): string {
  return COLOR_HEX_MAP[name.trim().toLowerCase()] || '#0f766e';
}

interface StorefrontProductVariant {
  id: string;
  name: string;
  sku?: string;
  barcode?: string | null;
  salePriceXof?: number | null;
  stockAvailable?: number;
  isActive?: boolean;
}

interface StorefrontProduct {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  salePriceXof: number;
  imageUrls: string[];
  availableSizes?: string[];
  availableColors?: string[];
  brand?: string | null;
  modelName?: string | null;
  volumeLabel?: string | null;
  bulkUnitLabel?: string | null;
  unitsPerBulk?: number | null;
  bulkSalePriceXof?: number | null;
  allowFractionalSale?: boolean;
  warrantyMonths?: number | null;
  trackSerialNumber?: boolean;
  stockAvailable: number;
  stockAvailableDecimal?: number;
  inStock: boolean;
  variants?: StorefrontProductVariant[];
}

interface StorefrontData {
  available: boolean;
  status: string;
  isOpenNow: boolean;
  message?: string;
  shop: {
    id: string;
    name: string;
    slug: string;
    shopType?: ShopType;
    businessProfile?: BusinessProfileConfig;
    logoUrl: string | null;
    slogan: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    currency: string;
    deliveryConfig: {
      pickupEnabled: boolean;
      deliveryEnabled: boolean;
      defaultDeliveryFeeXof: number;
      deliveryZones?: Array<{ name: string; feeXof: number }>;
      whatsappNumber?: string;
      allowOutOfHoursOrders: boolean;
      outOfHoursMessage?: string;
    };
  };
  categories: Array<{ id: string; name: string }>;
  products: StorefrontProduct[];
}

interface CartItem {
  key: string;
  product: StorefrontProduct;
  selectedSize: string;
  selectedColor: string;
  soldInBulk: boolean;
  qty: number;
  variantId: string | null;
  variantName: string | null;
}

interface OrderConfirmation {
  orderNumber: string;
  secretToken: string;
  trackingPath: string;
  totalXof: number;
  outOfHours: boolean;
  outOfHoursMessage: string | null;
}

interface CustomerProfileData {
  authenticated: boolean;
  customer: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    address: string | null;
  } | null;
  outstandingDebtXof?: number;
  orders?: Array<{
    id: string;
    orderNumber: string;
    status: OnlineOrderStatus;
    fulfillmentMode: string;
    totalXof: number;
    trackingPath: string;
    createdAt: string;
    lines: Array<{
      id: string;
      productName: string;
      selectedSize: string | null;
      selectedColor: string | null;
      orderedQty: number;
      lineTotalXof: number;
    }>;
  }>;
  receivables?: Array<{
    id: string;
    status: string;
    description: string | null;
    dueDate: string | null;
    saleNumber: string | null;
    initialAmountXof: number;
    paidAmountXof: number;
    remainingAmountXof: number;
    createdAt: string;
  }>;
}

export function StorefrontClient({ initialData }: { initialData: StorefrontData }) {
  const { shop, categories, products, isOpenNow } = initialData;
  const shopType = normalizeShopType(shop.shopType);
  const profile = normalizeBusinessProfile(shopType, shop.businessProfile);
  const allowDelivery = canShopDeliver(shopType, profile.enabledShopTypes);
  const deliveryCfg = {
    ...shop.deliveryConfig,
    pickupEnabled: allowDelivery ? shop.deliveryConfig.pickupEnabled : true,
    deliveryEnabled: allowDelivery ? shop.deliveryConfig.deliveryEnabled : false,
  };
  const layout = profile.storefrontLayout;

  const [search, setSearch] = useState('');
  const [catId, setCatId] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  // Modale Détail / Voir plus produit
  const [detailProduct, setDetailProduct] = useState<StorefrontProduct | null>(null);
  const [detailPhotoIndex, setDetailPhotoIndex] = useState(0);
  const [detailSize, setDetailSize] = useState('');
  const [detailColor, setDetailColor] = useState('');
  const [detailSoldInBulk, setDetailSoldInBulk] = useState(false);
  const [detailQty, setDetailQty] = useState(1);
  const [detailVariant, setDetailVariant] = useState<StorefrontProductVariant | null>(null);

  // Formulaire commande sans compte
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>(
    deliveryCfg.pickupEnabled ? 'PICKUP' : 'DELIVERY',
  );
  const [deliveryDistrict, setDeliveryDistrict] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [websiteHp, setWebsiteHp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderErr, setOrderErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<OrderConfirmation | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Chat public amélioré
  const [chatOpen, setChatOpen] = useState(false);
  const [chatToken, setChatToken] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<
    Array<{ id: string; senderRole: string; senderName: string; body: string; createdAt: string }>
  >([]);
  const [chatName, setChatName] = useState('');
  const [chatPhone, setChatPhone] = useState('');
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Compte client optionnel
  const [accountOpen, setAccountOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [customerData, setCustomerData] = useState<CustomerProfileData | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regForm, setRegForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    address: '',
    password: '',
  });

  const loadCustomerProfile = async () => {
    try {
      const data = await apiFetch<CustomerProfileData>(`/public/shops/${shop.slug}/auth/me`, {
        requiresOnline: false,
      });
      setCustomerData(data);
      if (data.authenticated && data.customer) {
        setClientName((prev) => prev || data.customer!.fullName);
        setClientPhone((prev) => prev || data.customer!.phone);
        setDeliveryAddress((prev) => prev || data.customer!.address || '');
        setChatName((prev) => prev || data.customer!.fullName);
        setChatPhone((prev) => prev || data.customer!.phone);
      }
    } catch {
      // ignore offline
    }
  };

  useEffect(() => {
    void loadCustomerProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.slug]);

  const handleCustomerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthErr(null);
    try {
      await apiFetch(`/public/shops/${shop.slug}/auth/login`, {
        method: 'POST',
        body: { identifier: loginIdentifier, password: loginPassword },
      });
      setLoginPassword('');
      await loadCustomerProfile();
    } catch (err) {
      setAuthErr(err instanceof ApiError ? err.message : 'Connexion impossible.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCustomerRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthErr(null);
    try {
      await apiFetch(`/public/shops/${shop.slug}/auth/register`, {
        method: 'POST',
        body: {
          fullName: regForm.fullName,
          phone: regForm.phone,
          email: regForm.email || undefined,
          address: regForm.address || undefined,
          password: regForm.password,
        },
      });
      setRegForm({ fullName: '', phone: '', email: '', address: '', password: '' });
      await loadCustomerProfile();
    } catch (err) {
      setAuthErr(err instanceof ApiError ? err.message : 'Création de compte impossible.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCustomerLogout = async () => {
    setAuthBusy(true);
    try {
      await apiFetch(`/public/shops/${shop.slug}/auth/logout`, { method: 'POST' });
      setCustomerData({ authenticated: false, customer: null });
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(`sc_chat_${shop.slug}`) : null;
    if (saved) setChatToken(saved);
  }, [shop.slug]);

  useEffect(() => {
    if (!chatOpen || !chatToken) return;
    const fetchChat = () => {
      apiFetch<{ messages: typeof chatMessages }>(`/public/shops/${shop.slug}/chat/${chatToken}`, {
        requiresOnline: false,
      })
        .then((res) => setChatMessages(res.messages))
        .catch(() => undefined);
    };
    fetchChat();
    const t = window.setInterval(fetchChat, 7000);
    return () => window.clearInterval(t);
  }, [chatOpen, chatToken, shop.slug]);

  useEffect(() => {
    if (chatOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages.length, chatOpen]);

  const allSizes = useMemo(() => {
    const s = new Set<string>();
    for (const p of products) {
      for (const sz of p.availableSizes || []) s.add(sz);
    }
    return Array.from(s);
  }, [products]);

  const allColors = useMemo(() => {
    const c = new Set<string>();
    for (const p of products) {
      for (const col of p.availableColors || []) c.add(col);
    }
    return Array.from(c);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catId && p.categoryId !== catId) return false;
      if (sizeFilter && !(p.availableSizes || []).includes(sizeFilter)) return false;
      if (colorFilter && !(p.availableColors || []).includes(colorFilter)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.modelName && p.modelName.toLowerCase().includes(q)) ||
        p.sku.toLowerCase().includes(q)
      );
    });
  }, [products, search, catId, sizeFilter, colorFilter]);

  const openProductDetail = (p: StorefrontProduct) => {
    setDetailProduct(p);
    setDetailPhotoIndex(0);
    setDetailSize(p.availableSizes?.[0] || '');
    setDetailColor(p.availableColors?.[0] || '');
    setDetailSoldInBulk(false);
    setDetailQty(1);
  };

  const resolveProductUnitPrice = (p: StorefrontProduct, soldInBulk: boolean): number => {
    if (soldInBulk && p.unitsPerBulk && p.unitsPerBulk >= 2) {
      return p.bulkSalePriceXof ?? p.salePriceXof * p.unitsPerBulk;
    }
    return p.salePriceXof;
  };

  const getMaxOrderableQty = (p: StorefrontProduct, soldInBulk: boolean): number => {
    if (soldInBulk && p.unitsPerBulk && p.unitsPerBulk >= 2) {
      return Math.max(0, Math.floor(p.stockAvailable / p.unitsPerBulk));
    }
    return p.stockAvailable;
  };

  const addItemToCart = (
    product: StorefrontProduct,
    size = '',
    color = '',
    qtyToAdd = 1,
    soldInBulk = false,
    variant?: StorefrontProductVariant,
  ) => {
    if (!product.inStock) return;
    const maxQty = getMaxOrderableQty(product, soldInBulk);
    if (maxQty <= 0) return;
    const chosenSize = size || product.availableSizes?.[0] || '';
    const chosenColor = color || product.availableColors?.[0] || '';
    const variantSuffix = variant ? `__v_${variant.id}` : '';
    const key = `${product.id}__${chosenSize}__${chosenColor}__${soldInBulk ? 'BULK' : 'UNIT'}${variantSuffix}`;
    const effectivePrice = variant?.salePriceXof ?? product.salePriceXof;
    setCart((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) =>
          i.key === key
            ? { ...i, qty: Math.min(maxQty, i.qty + qtyToAdd) }
            : i,
        );
      }
      return [
        ...prev,
        {
          key,
          product: { ...product, salePriceXof: effectivePrice },
          selectedSize: chosenSize,
          selectedColor: chosenColor,
          soldInBulk,
          qty: Math.min(maxQty, qtyToAdd),
          variantId: variant?.id ?? null,
          variantName: variant?.name ?? null,
        },
      ];
    });
  };

  const updateCartItemQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.key === key
            ? {
                ...i,
                qty: Math.min(
                  getMaxOrderableQty(i.product, i.soldInBulk),
                  i.qty + delta,
                ),
              }
            : i,
        )
        .filter((i) => i.qty > 0),
    );
  };

  const toggleCartItemBulk = (key: string, soldInBulk: boolean) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.key !== key) return i;
          const maxQty = getMaxOrderableQty(i.product, soldInBulk);
          if (maxQty <= 0) return i;
          return {
            ...i,
            key: `${i.product.id}__${i.selectedSize}__${i.selectedColor}__${soldInBulk ? 'BULK' : 'UNIT'}__${Math.random().toString(36).slice(2, 5)}`,
            soldInBulk,
            qty: Math.min(maxQty, i.qty),
          };
        })
        .filter((i) => i.qty > 0),
    );
  };

  const updateCartItemVariant = (key: string, field: 'selectedSize' | 'selectedColor', val: string) => {
    setCart((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i;
        const nextSize = field === 'selectedSize' ? val : i.selectedSize;
        const nextColor = field === 'selectedColor' ? val : i.selectedColor;
        return {
          ...i,
          key: `${i.product.id}__${nextSize}__${nextColor}__${i.soldInBulk ? 'BULK' : 'UNIT'}__${Math.random().toString(36).slice(2, 5)}`,
          selectedSize: nextSize,
          selectedColor: nextColor,
        };
      }),
    );
  };

  const subtotalXof = cart.reduce(
    (a, i) => a + resolveProductUnitPrice(i.product, i.soldInBulk) * i.qty,
    0,
  );
  const matchedZone = (deliveryCfg.deliveryZones || []).find(
    (z) => z.name.trim().toLowerCase() === deliveryDistrict.trim().toLowerCase(),
  );
  const deliveryFeeXof =
    fulfillmentMode === 'DELIVERY'
      ? (matchedZone ? matchedZone.feeXof : deliveryCfg.defaultDeliveryFeeXof)
      : 0;
  const grandTotalXof = subtotalXof + deliveryFeeXof;
  const totalItems = cart.reduce((a, i) => a + i.qty, 0);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    setOrderErr(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<OrderConfirmation>(`/public/shops/${shop.slug}/orders`, {
        method: 'POST',
        body: {
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          fulfillmentMode,
          deliveryDistrict: fulfillmentMode === 'DELIVERY' ? deliveryDistrict.trim() || undefined : undefined,
          deliveryAddress: fulfillmentMode === 'DELIVERY' ? deliveryAddress.trim() || undefined : undefined,
          deliveryNotes: deliveryNotes.trim() || undefined,
          websiteHp,
          items: cart.map((c) => ({
            productId: c.product.id,
            quantity: c.qty,
            soldInBulk: c.soldInBulk,
            selectedSize: c.selectedSize || null,
            selectedColor: c.selectedColor || null,
            ...(c.variantId ? { variantId: c.variantId } : {}),
          })),
        },
      });
      setConfirmed(res);
      setCart([]);
      void loadCustomerProfile();
    } catch (err) {
      setOrderErr(err instanceof ApiError ? err.message : 'Impossible d’enregistrer votre commande.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    setChatBusy(true);
    setChatErr(null);
    try {
      if (!chatToken) {
        const res = await apiFetch<{ chatToken: string; messages: typeof chatMessages }>(
          `/public/shops/${shop.slug}/chat/start`,
          {
            method: 'POST',
            body: {
              clientName: chatName.trim(),
              clientPhone: chatPhone.trim(),
              message: chatText.trim(),
            },
          },
        );
        setChatToken(res.chatToken);
        localStorage.setItem(`sc_chat_${shop.slug}`, res.chatToken);
        setChatMessages(res.messages);
        setChatText('');
      } else {
        const msg = await apiFetch<(typeof chatMessages)[number]>(
          `/public/shops/${shop.slug}/chat/${chatToken}/messages`,
          { method: 'POST', body: { body: chatText.trim() } },
        );
        setChatMessages((prev) => [...prev, msg]);
        setChatText('');
      }
    } catch (err) {
      setChatErr(err instanceof ApiError ? err.message : 'Envoi du message impossible.');
    } finally {
      setChatBusy(false);
    }
  };

  const fullTrackUrl =
    confirmed && typeof window !== 'undefined'
      ? `${window.location.origin}${confirmed.trackingPath}`
      : confirmed?.trackingPath || '';

  return (
    <div className="min-h-screen w-full overflow-x-clip overscroll-none bg-porcelain-100 pb-28 sm:pb-24">
      {/* Barre supérieure fixe & 100% responsive mobile + desktop (respecte la barre de statut mobile) */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-forest-950/95 pt-[env(safe-area-inset-top,0px)] text-white backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
            {shop.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shop.logoUrl}
                alt={shop.name}
                className="h-9 w-9 shrink-0 rounded-xl bg-white object-contain p-1 shadow-xs sm:h-10 sm:w-10"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-limeglow-400 ring-1 ring-white/20 sm:h-10 sm:w-10">
                <Store className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h1 className="truncate text-sm font-extrabold tracking-tight text-white sm:text-base">
                  {shop.name}
                </h1>
                <span
                  className={`hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline-flex ${
                    isOpenNow
                      ? 'bg-emerald-500/20 text-limeglow-300'
                      : 'bg-amber-400/20 text-amber-200'
                  }`}
                >
                  <Clock className="h-2.5 w-2.5" />
                  {isOpenNow ? 'Ouverte' : 'Fermée'}
                </span>
              </div>
              <p
                className={`flex items-center gap-1 text-[10px] font-semibold sm:hidden ${
                  isOpenNow ? 'text-limeglow-300' : 'text-amber-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isOpenNow ? 'bg-limeglow-400' : 'bg-amber-400'
                  }`}
                />
                {isOpenNow ? 'Ouverte' : 'Fermée'}
              </p>
              {shop.address || shop.phone ? (
                <p className="hidden truncate text-[11px] text-emerald-200/70 sm:block">
                  {[shop.address, shop.phone].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link
              href={`/s/${shop.slug}/track`}
              aria-label="Suivre ma commande"
              title="Suivi commande"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/15 sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs sm:font-bold"
            >
              <Package className="h-4 w-4 text-limeglow-400 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline">Suivi</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setAuthErr(null);
                setAccountOpen(true);
                void loadCustomerProfile();
              }}
              aria-label="Mon compte client"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/15 sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs sm:font-bold ${
                customerData?.authenticated ? 'ring-1 ring-limeglow-400/60' : ''
              }`}
            >
              <User className="h-4 w-4 text-limeglow-400 sm:h-3.5 sm:w-3.5" />
              <span className="hidden max-w-[76px] truncate sm:inline">
                {customerData?.authenticated && customerData.customer
                  ? customerData.customer.fullName.split(' ')[0]
                  : 'Compte'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              aria-label="Contacter la boutique"
              className="hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15 sm:inline-flex"
            >
              <MessageCircle className="h-3.5 w-3.5 text-limeglow-400" />
              <span className="hidden sm:inline">Message</span>
            </button>
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-label="Ouvrir le panier"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-limeglow-400 px-3 text-xs font-extrabold text-forest-950 shadow-lime hover:bg-limeglow-300 sm:h-auto sm:px-4 sm:py-1.5"
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              <span>{totalItems}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero boutique compact + Recherche & Catégories */}
      <section className="obsidian-hero px-3 pb-6 pt-4 text-white sm:px-6">
        <div className="mx-auto max-w-6xl space-y-3.5">
          {shop.slogan || shop.address || shop.phone ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-100/80">
              {shop.slogan ? <p className="min-w-0 break-words font-medium text-white">{shop.slogan}</p> : <span />}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                {shop.address ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0 text-limeglow-400" />
                    <span className="break-words">{shop.address}</span>
                  </span>
                ) : null}
                {shop.phone ? (
                  <a href={`tel:${shop.phone}`} className="inline-flex items-center gap-1 hover:text-white">
                    <Phone className="h-3 w-3 shrink-0 text-limeglow-400" />
                    {shop.phone}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-200/60" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un produit…"
                className="w-full rounded-xl border border-white/15 bg-white/10 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-emerald-200/60 focus:border-limeglow-400 focus:bg-white/15"
              />
            </div>

            {categories.length > 0 ? (
              <div className="flex w-full max-w-full min-w-0 gap-1.5 overflow-x-auto pb-1 sm:w-auto sm:max-w-[60%] sm:pb-0">
                <button
                  type="button"
                  onClick={() => setCatId('')}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    catId === ''
                      ? 'bg-white text-forest-950'
                      : 'bg-white/10 text-emerald-100 hover:bg-white/20'
                  }`}
                >
                  Tout ({products.length})
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCatId(c.id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      catId === c.id
                        ? 'bg-white text-forest-950'
                        : 'bg-white/10 text-emerald-100 hover:bg-white/20'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Filtres rapides par Taille & Couleur (Mode & Cosmétique — Lot 11) */}
          {(profile.enableSizes && allSizes.length > 0) ||
          (profile.enableColors && allColors.length > 0) ? (
            <div className="flex flex-col gap-2 border-t border-white/10 pt-2.5 text-xs sm:flex-row sm:flex-wrap sm:items-center">
              {profile.enableSizes && allSizes.length > 0 ? (
                <div className="flex w-full max-w-full min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 sm:w-auto sm:pb-0">
                  <span className="shrink-0 text-[11px] font-bold text-emerald-200/80">
                    Taille :
                  </span>
                  <button
                    type="button"
                    onClick={() => setSizeFilter('')}
                    className={`shrink-0 !min-h-0 rounded-lg px-2 py-1 text-[11px] font-bold ${
                      sizeFilter === ''
                        ? 'bg-limeglow-400 text-forest-950'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    Toutes
                  </button>
                  {allSizes.map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setSizeFilter((prev) => (prev === sz ? '' : sz))}
                      className={`shrink-0 !min-h-0 rounded-lg px-2 py-1 text-[11px] font-bold ${
                        sizeFilter === sz
                          ? 'bg-limeglow-400 text-forest-950'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              ) : null}

              {profile.enableColors && allColors.length > 0 ? (
                <div className="flex w-full max-w-full min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 sm:w-auto sm:pb-0">
                  <span className="shrink-0 text-[11px] font-bold text-emerald-200/80">
                    Couleur :
                  </span>
                  <button
                    type="button"
                    onClick={() => setColorFilter('')}
                    className={`shrink-0 !min-h-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                      colorFilter === ''
                        ? 'bg-limeglow-400 text-forest-950'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    Toutes
                  </button>
                  {allColors.map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setColorFilter((prev) => (prev === col ? '' : col))}
                      className={`inline-flex shrink-0 !min-h-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${
                        colorFilter === col
                          ? 'bg-limeglow-400 text-forest-950'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-white/40"
                        style={{ backgroundColor: swatchHex(col) }}
                      />
                      {col}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Catalogue Adaptatif selon le type de boutique : QUICK_LIST / TECH_SPEC / GALLERY (Lot 11) */}
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6">
        {filteredProducts.length === 0 ? (
          <div className="sc-card p-10 text-center">
            <Package className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-bold text-slate-800">Aucun article publié trouvé</p>
            <p className="mt-1 text-xs text-slate-500">
              Essayez un autre mot-clé ou écrivez directement à la boutique.
            </p>
          </div>
        ) : layout === 'QUICK_LIST' ? (
          /* Mode ÉPICERIE EXPRESS (Boutique de quartier — Liste rapide avec boutons - / + et Unité / Carton) */
          <div className="space-y-2.5">
            {filteredProducts.map((p) => {
              const photo = p.imageUrls?.[0];
              const hasBulk = Boolean(p.unitsPerBulk && p.unitsPerBulk >= 2);
              const bulkPrice =
                p.bulkSalePriceXof ?? p.salePriceXof * (p.unitsPerBulk || 1);
              const canOrderBulk = hasBulk && getMaxOrderableQty(p, true) > 0;
              const unitCartItem = cart.find(
                (i) => i.product.id === p.id && !i.soldInBulk,
              );
              const bulkCartItem = cart.find(
                (i) => i.product.id === p.id && i.soldInBulk,
              );

              return (
                <article
                  key={p.id}
                  className="sc-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openProductDetail(p)}
                      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-porcelain-50"
                    >
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-slate-400">
                          <Package className="h-6 w-6" />
                        </span>
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.categoryName ? (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-brand-700">
                            {p.categoryName}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            p.inStock
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {p.inStock
                            ? `${p.stockAvailableDecimal ?? p.stockAvailable} ${p.unit} dispo`
                            : 'Rupture'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openProductDetail(p)}
                        className="mt-0.5 block !min-h-0 w-full line-clamp-2 text-left text-sm font-extrabold text-slate-900 hover:text-brand-700"
                      >
                        {p.name}
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-black text-forest-950 tabular">
                          {formatXof(p.salePriceXof)}{' '}
                          <span className="font-normal text-slate-500">/ {p.unit}</span>
                        </span>
                        {hasBulk ? (
                          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 tabular">
                            {p.bulkUnitLabel || 'carton'} (×{p.unitsPerBulk}) :{' '}
                            {formatXof(bulkPrice)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Contrôles directs - / + Détail et Carton sans ouvrir de modale */}
                  <div className="flex w-full flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-2.5 sm:w-auto sm:border-t-0 sm:pt-0">
                    {unitCartItem ? (
                      <div className="inline-flex flex-1 items-center justify-between gap-1.5 rounded-xl border border-forest-900 bg-forest-900 px-2 py-1 text-white sm:flex-none">
                        <button
                          type="button"
                          onClick={() => updateCartItemQty(unitCartItem.key, -1)}
                          className="!min-h-0 rounded-lg bg-white/15 p-1.5 hover:bg-white/25"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-[36px] text-center text-xs font-extrabold tabular">
                          {unitCartItem.qty} {p.unit}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartItemQty(unitCartItem.key, 1)}
                          className="!min-h-0 rounded-lg bg-white/15 p-1.5 hover:bg-white/25"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!p.inStock}
                        onClick={() => addItemToCart(p, '', '', 1, false)}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-forest-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-forest-800 disabled:bg-slate-200 disabled:text-slate-400 sm:flex-none"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {p.unit}
                      </button>
                    )}

                    {hasBulk ? (
                      bulkCartItem ? (
                        <div className="inline-flex flex-1 items-center justify-between gap-1.5 rounded-xl border border-emerald-700 bg-emerald-50 px-2 py-1 text-emerald-950 sm:flex-none">
                          <button
                            type="button"
                            onClick={() => updateCartItemQty(bulkCartItem.key, -1)}
                            className="!min-h-0 rounded-lg bg-white p-1.5 shadow-2xs"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-[44px] text-center text-xs font-extrabold tabular">
                            {bulkCartItem.qty} {p.bulkUnitLabel || 'carton'}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartItemQty(bulkCartItem.key, 1)}
                            className="!min-h-0 rounded-lg bg-white p-1.5 shadow-2xs"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!canOrderBulk}
                          onClick={() => addItemToCart(p, '', '', 1, true)}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-40 sm:flex-none"
                        >
                          <Boxes className="h-3.5 w-3.5" />+ {p.bulkUnitLabel || 'carton'}
                        </button>
                      )
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : layout === 'TECH_SPEC' ? (
          /* Mode CATALOGUE TECHNIQUE (Électronique & Quincaillerie — Marque, Modèle, Garantie & Question rapide) */
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProducts.map((p) => {
              const photo = p.imageUrls?.[0];
              return (
                <article
                  key={p.id}
                  className="sc-card-hover flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl p-3.5 sm:p-4"
                >
                  <div>
                    <div className="flex items-start gap-3.5">
                      <button
                        type="button"
                        onClick={() => openProductDetail(p)}
                        className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-porcelain-50"
                      >
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt={p.name} className="h-full w-full object-contain p-1" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-slate-300">
                            <Package className="h-8 w-8" />
                          </span>
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {p.brand ? (
                            <span className="rounded-md bg-forest-900 px-2 py-0.5 text-[10px] font-extrabold text-limeglow-400">
                              {p.brand}
                            </span>
                          ) : null}
                          {p.warrantyMonths ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                              <ShieldCheck className="h-3 w-3" />
                              Garantie {p.warrantyMonths} mois
                            </span>
                          ) : null}
                        </div>
                        <h2 className="mt-1 line-clamp-2 text-sm font-extrabold text-slate-900">
                          {p.name}
                        </h2>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                          {p.modelName ? `Modèle : ${p.modelName} · ` : ''}Réf : {p.sku}
                        </p>
                      </div>
                    </div>

                    {p.description ? (
                      <p className="mt-3 line-clamp-2 rounded-xl bg-porcelain-50 p-2.5 text-xs text-slate-600">
                        {p.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-base font-black text-forest-950 tabular">
                        {formatXof(p.salePriceXof)}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          p.inStock
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {p.inStock ? `${p.stockAvailable} en stock` : 'Rupture'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => openProductDetail(p)}
                        className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-porcelain-50 px-1.5 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                      >
                        <Eye className="h-3 w-3 shrink-0" />
                        Fiche
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChatText(
                            `Bonjour, est-ce que ${p.name} (${p.sku}) est disponible ?`,
                          );
                          setChatOpen(true);
                        }}
                        className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-1.5 py-2 text-[11px] font-bold text-brand-700 hover:bg-brand-50"
                      >
                        <MessageCircle className="h-3 w-3 shrink-0" />
                        Question
                      </button>
                      <button
                        type="button"
                        disabled={!p.inStock}
                        onClick={() => addItemToCart(p)}
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-xl bg-forest-900 px-1.5 py-2 text-[11px] font-bold text-white hover:bg-forest-800 disabled:bg-slate-200 disabled:text-slate-400"
                      >
                        + Panier
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {filteredProducts.map((p) => {
              const photo = p.imageUrls?.[0];
              const sizes = p.availableSizes || [];
              const colors = p.availableColors || [];
              const hasVariants = sizes.length > 0 || colors.length > 0;
              return (
                <article
                  key={p.id}
                  className="sc-card-hover flex min-w-0 flex-col overflow-hidden rounded-2xl"
                >
                  {/* Photo contrôlée et proportionnée (jamais démesurée) */}
                  <button
                    type="button"
                    onClick={() => openProductDetail(p)}
                    className="group relative h-36 w-full overflow-hidden bg-porcelain-50 sm:h-44"
                  >
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo}
                        alt={p.name}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-300">
                        <Package className="h-9 w-9" />
                      </div>
                    )}
                    <span
                      className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-extrabold backdrop-blur-xs ${
                        p.inStock
                          ? 'bg-emerald-950/75 text-limeglow-300'
                          : 'bg-rose-600/90 text-white'
                      }`}
                    >
                      {p.inStock ? `${p.stockAvailable} dispo` : 'Rupture'}
                    </span>
                    {(p.imageUrls?.length || 0) > 1 ? (
                      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-forest-950/80 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                        <Camera className="h-2.5 w-2.5 text-limeglow-400" />
                        {p.imageUrls.length}
                      </span>
                    ) : null}
                  </button>

                  <div className="flex min-w-0 flex-1 flex-col justify-between p-2.5 sm:p-3.5">
                    <div>
                      {p.categoryName ? (
                        <p className="truncate text-[10px] font-bold uppercase tracking-wide text-brand-700">
                          {p.categoryName}
                        </p>
                      ) : null}
                      <h2 className="mt-0.5 line-clamp-2 text-xs font-extrabold text-slate-900 sm:text-sm">
                        {p.name}
                      </h2>

                      {/* Aperçu pastilles couleurs & tailles */}
                      {hasVariants ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {colors.slice(0, 4).map((c) => (
                            <span
                              key={c}
                              title={c}
                              className="h-3 w-3 rounded-full border border-slate-300"
                              style={{ backgroundColor: swatchHex(c) }}
                            />
                          ))}
                          {sizes.length > 0 ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
                              {sizes.slice(0, 3).join(' · ')}
                              {sizes.length > 3 ? '…' : ''}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-2.5 space-y-2">
                      <p className="truncate text-sm font-black text-forest-950 tabular sm:text-base">
                        {formatXof(p.salePriceXof)}
                      </p>

                      <div className="flex items-center gap-1.5 sm:grid sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => openProductDetail(p)}
                          aria-label={`Voir les détails de ${p.name}`}
                          title="Voir plus"
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-porcelain-50 text-[11px] font-bold text-slate-700 transition hover:bg-slate-100 sm:h-auto sm:w-auto sm:gap-1 sm:py-1.5"
                        >
                          <Eye className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                          <span className="hidden sm:inline">Voir plus</span>
                        </button>
                        <button
                          type="button"
                          disabled={!p.inStock}
                          onClick={() => {
                            if (hasVariants) {
                              openProductDetail(p);
                            } else {
                              addItemToCart(p);
                            }
                          }}
                          className="inline-flex h-9 min-w-0 flex-1 items-center justify-center truncate rounded-xl bg-forest-900 px-2 text-[11px] font-bold text-white transition hover:bg-forest-800 disabled:bg-slate-200 disabled:text-slate-400 sm:h-auto sm:py-1.5"
                        >
                          {p.inStock ? '+ Panier' : 'Épuisé'}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Modale Détails / Voir plus Produit (Description, Tailles, Couleurs, Quantité) */}
      {detailProduct ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-forest-950/70 p-0 backdrop-blur-xs sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Détails ${detailProduct.name}`}
        >
          <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-xs sm:px-5 sm:py-3.5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">
                  {detailProduct.categoryName || shop.name}
                </p>
                <h2 className="truncate text-base font-extrabold text-slate-900">
                  {detailProduct.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailProduct(null)}
                aria-label="Fermer"
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5">
              {/* Galerie photos interactive (carrousel + miniatures cliquables) */}
              {(() => {
                const photos = detailProduct.imageUrls || [];
                const activeIdx = Math.min(detailPhotoIndex, Math.max(0, photos.length - 1));
                const activePhoto = photos[activeIdx];
                return (
                  <div className="space-y-2.5">
                    <div className="relative flex h-52 w-full items-center justify-center overflow-hidden rounded-2xl border border-slate-100 bg-porcelain-50 sm:h-64">
                      {activePhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activePhoto}
                          alt={`${detailProduct.name} — photo ${activeIdx + 1}`}
                          className="h-full w-full object-contain p-2"
                        />
                      ) : (
                        <Package className="h-12 w-12 text-slate-300" />
                      )}

                      {photos.length > 1 ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setDetailPhotoIndex((i) => (i - 1 + photos.length) % photos.length)
                            }
                            aria-label="Photo précédente"
                            className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-forest-950/75 text-white shadow-md backdrop-blur-xs transition hover:bg-forest-900"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailPhotoIndex((i) => (i + 1) % photos.length)}
                            aria-label="Photo suivante"
                            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-forest-950/75 text-white shadow-md backdrop-blur-xs transition hover:bg-forest-900"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                          <span className="absolute bottom-2 right-2 rounded-full bg-forest-950/80 px-2.5 py-0.5 text-[11px] font-bold text-white tabular backdrop-blur-xs">
                            {activeIdx + 1} / {photos.length}
                          </span>
                        </>
                      ) : null}
                    </div>

                    {photos.length > 1 ? (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {photos.map((url, idx) => (
                          <button
                            key={`${url}-${idx}`}
                            type="button"
                            onClick={() => setDetailPhotoIndex(idx)}
                            aria-label={`Voir photo ${idx + 1}`}
                            className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2 bg-white transition ${
                              idx === activeIdx
                                ? 'border-brand-600 ring-2 ring-brand-500/25'
                                : 'border-slate-200 opacity-70 hover:opacity-100'
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Miniature ${idx + 1}`}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xl font-black text-forest-950 tabular sm:text-2xl">
                  {formatXof(resolveProductUnitPrice(detailProduct, detailSoldInBulk))}
                  <span className="ml-1 text-xs font-semibold text-slate-500">
                    /{' '}
                    {detailSoldInBulk
                      ? `${detailProduct.bulkUnitLabel || 'carton'} (×${detailProduct.unitsPerBulk})`
                      : detailProduct.unit}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {detailProduct.warrantyMonths ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-800">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Garantie {detailProduct.warrantyMonths} mois
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      detailProduct.inStock
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {detailProduct.inStock
                      ? `${detailProduct.stockAvailableDecimal ?? detailProduct.stockAvailable} ${detailProduct.unit} en stock`
                      : 'Rupture de stock'}
                  </span>
                </div>
              </div>

              {/* Choix Détail (Unité) vs Gros (Carton/Sac) si configuré */}
              {detailProduct.unitsPerBulk && detailProduct.unitsPerBulk >= 2 ? (
                <div className="grid grid-cols-1 gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-2 text-xs font-bold sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDetailSoldInBulk(false);
                      setDetailQty(1);
                    }}
                    className={`rounded-xl px-3 py-2 text-center transition ${
                      !detailSoldInBulk
                        ? 'bg-forest-900 text-white shadow-xs'
                        : 'bg-white text-slate-700'
                    }`}
                  >
                    Au détail ({detailProduct.unit}) · {formatXof(detailProduct.salePriceXof)}
                  </button>
                  <button
                    type="button"
                    disabled={getMaxOrderableQty(detailProduct, true) <= 0}
                    onClick={() => {
                      setDetailSoldInBulk(true);
                      setDetailQty(1);
                    }}
                    className={`rounded-xl px-3 py-2 text-center transition disabled:opacity-40 ${
                      detailSoldInBulk
                        ? 'bg-forest-900 text-limeglow-400 shadow-xs'
                        : 'bg-white text-emerald-900'
                    }`}
                  >
                    En gros ({detailProduct.bulkUnitLabel || 'carton'} ×{detailProduct.unitsPerBulk}) ·{' '}
                    {formatXof(resolveProductUnitPrice(detailProduct, true))}
                  </button>
                </div>
              ) : null}

              {/* Description */}
              <div className="rounded-2xl bg-porcelain-50 p-3.5 text-xs leading-relaxed text-slate-700">
                <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Description
                </p>
                <p className="whitespace-pre-wrap">
                  {detailProduct.description?.trim() ||
                    'Article disponible immédiatement en boutique ou en livraison.'}
                </p>
              </div>

              {/* Sélection de la variante (si le produit a des variantes) */}
              {(detailProduct.variants?.length || 0) > 0 ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                    <Boxes className="h-3.5 w-3.5 text-brand-700" />
                    Choisir une variante :{' '}
                    <span className="text-brand-700">{detailVariant?.name || 'Sélectionner'}</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {detailProduct.variants!.filter(v => v.isActive !== false).map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setDetailVariant(detailVariant?.id === v.id ? null : v)}
                        className={`flex flex-col items-start rounded-xl border p-2.5 text-left text-xs transition ${
                          detailVariant?.id === v.id
                            ? 'border-forest-900 bg-forest-50 ring-1 ring-forest-900/20'
                            : 'border-slate-200 bg-white hover:border-forest-800'
                        }`}
                      >
                        <span className="font-bold text-slate-900">{v.name}</span>
                        {v.salePriceXof != null ? (
                          <span className="mt-0.5 font-extrabold text-brand-700">{formatXof(v.salePriceXof)}</span>
                        ) : null}
                        {v.stockAvailable != null ? (
                          <span className={`mt-0.5 font-semibold ${v.stockAvailable <= 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {v.stockAvailable <= 0 ? 'Rupture' : `${v.stockAvailable} en stock`}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Sélection de la taille */}
              {(detailProduct.availableSizes?.length || 0) > 0 ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                    <Ruler className="h-3.5 w-3.5 text-brand-700" />
                    Choisir votre taille :{' '}
                    <span className="text-brand-700">{detailSize || 'Sélectionner'}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {detailProduct.availableSizes!.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDetailSize(s)}
                        className={`min-w-[44px] rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                          detailSize === s
                            ? 'bg-forest-900 text-limeglow-400 shadow-sm'
                            : 'border border-slate-200 bg-white text-slate-700 hover:border-forest-800'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Sélection de la couleur */}
              {(detailProduct.availableColors?.length || 0) > 0 ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                    <Palette className="h-3.5 w-3.5 text-brand-700" />
                    Choisir votre couleur :{' '}
                    <span className="text-brand-700">{detailColor || 'Sélectionner'}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {detailProduct.availableColors!.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDetailColor(c)}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                          detailColor === c
                            ? 'bg-forest-900 text-white ring-2 ring-limeglow-400'
                            : 'border border-slate-200 bg-white text-slate-700 hover:border-forest-800'
                        }`}
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-slate-300"
                          style={{ backgroundColor: swatchHex(c) }}
                        />
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Quantité & Ajouter au panier */}
              <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="inline-flex items-center justify-between gap-2 self-stretch rounded-xl border border-slate-200 bg-porcelain-50 p-1 sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                    className="rounded-lg bg-white p-2 text-slate-700 shadow-xs"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-8 text-center text-sm font-extrabold tabular">{detailQty}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDetailQty((q) =>
                        Math.min(
                          Math.max(1, getMaxOrderableQty(detailProduct, detailSoldInBulk)),
                          q + 1,
                        ),
                      )
                    }
                    className="rounded-lg bg-white p-2 text-slate-700 shadow-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!detailProduct.inStock}
                  onClick={() => {
                    addItemToCart(
                      detailProduct,
                      detailSize,
                      detailColor,
                      detailQty,
                      detailSoldInBulk,
                      detailVariant ?? undefined,
                    );
                    setDetailProduct(null);
                    setDetailVariant(null);
                    setCartOpen(true);
                  }}
                  className="sc-btn-lime w-full py-3 text-sm sm:flex-1"
                >
                  <ShoppingBag className="h-4 w-4" />
                  Ajouter ·{' '}
                  {formatXof(
                    resolveProductUnitPrice(detailProduct, detailSoldInBulk) * detailQty,
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Barre flottante Panier mobile */}
      {totalItems > 0 && !cartOpen && !detailProduct ? (
        <div className="fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-md items-center justify-between gap-2 rounded-2xl border border-limeglow-400/40 bg-forest-950 px-3.5 py-2.5 text-white shadow-2xl sm:bottom-4 sm:px-4 sm:py-3">
          <div className="min-w-0">
            <p className="text-[11px] text-emerald-200/80">{totalItems} article(s)</p>
            <p className="truncate text-base font-extrabold tabular">{formatXof(subtotalXof)}</p>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="sc-btn-lime shrink-0 rounded-full px-3.5 py-2 text-xs sm:px-5"
          >
            <span className="sm:hidden">Panier →</span>
            <span className="hidden sm:inline">Voir panier & Commander →</span>
          </button>
        </div>
      ) : null}

      {/* Drawer Panier avec sélection Taille & Couleur dans le panier + Commande sans compte */}
      {cartOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-forest-950/70 backdrop-blur-xs">
          <div className="sc-drawer flex h-dvh w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5 sm:py-4">
              <h2 className="text-base font-extrabold text-slate-900">
                {confirmed ? 'Commande enregistrée !' : `Votre panier (${totalItems})`}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setCartOpen(false);
                  if (confirmed) setConfirmed(null);
                }}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-5">
              {confirmed ? (
                <div className="space-y-4 text-center">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-8 w-8" />
                  </span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
                      Référence de commande
                    </p>
                    <p className="mt-1 font-mono text-2xl font-black text-forest-950">
                      {confirmed.orderNumber}
                    </p>
                    <p className="mt-1 text-sm font-bold text-slate-700 tabular">
                      Total : {formatXof(confirmed.totalXof)}
                    </p>
                  </div>

                  {confirmed.outOfHours && confirmed.outOfHoursMessage ? (
                    <div className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                      {confirmed.outOfHoursMessage}
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-slate-200 bg-porcelain-50 p-4 text-left text-xs">
                    <p className="font-bold text-slate-800">Lien secret de suivi en temps réel :</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-brand-700">
                      {fullTrackUrl}
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(fullTrackUrl);
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                        }}
                        className="sc-btn-ghost flex-1 py-2 text-xs"
                      >
                        {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedLink ? 'Copié' : 'Copier'}
                      </button>
                      <Link href={confirmed.trackingPath} className="sc-btn-primary flex-1 py-2 text-xs">
                        Suivre maintenant
                      </Link>
                    </div>
                  </div>
                </div>
              ) : cart.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">
                  Ajoutez des articles depuis la vitrine pour commander sans créer de compte.
                </p>
              ) : (
                <form onSubmit={handlePlaceOrder} className="space-y-4">
                  {/* Articles du panier avec choix Taille & Couleur modifiables dans le panier ! */}
                  <div className="space-y-2.5">
                    {cart.map((c) => {
                      const sizes = c.product.availableSizes || [];
                      const colors = c.product.availableColors || [];
                      return (
                        <div
                          key={c.key}
                          className="space-y-2 rounded-2xl border border-slate-200/80 bg-porcelain-50 p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                              {c.product.imageUrls?.[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={c.product.imageUrls[0]}
                                  alt={c.product.name}
                                  className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-white object-cover"
                                />
                              ) : null}
                              <div className="min-w-0">
                                <p className="truncate font-bold text-slate-900">
                                  {c.product.name}
                                  {c.soldInBulk
                                    ? ` [${c.product.bulkUnitLabel || 'carton'} ×${c.product.unitsPerBulk}]`
                                    : ''}
                                </p>
                                <p className="text-slate-500 tabular">
                                  {formatXof(resolveProductUnitPrice(c.product, c.soldInBulk))} ×{' '}
                                  {c.qty} ={' '}
                                  <strong className="text-slate-900">
                                    {formatXof(
                                      resolveProductUnitPrice(c.product, c.soldInBulk) * c.qty,
                                    )}
                                  </strong>
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => updateCartItemQty(c.key, -1)}
                                className="inline-flex h-8 w-8 !min-h-0 items-center justify-center rounded-lg border border-slate-200 bg-white"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-6 text-center font-bold tabular">{c.qty}</span>
                              <button
                                type="button"
                                onClick={() => updateCartItemQty(c.key, 1)}
                                className="inline-flex h-8 w-8 !min-h-0 items-center justify-center rounded-lg border border-slate-200 bg-white"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => updateCartItemQty(c.key, -c.qty)}
                                aria-label="Supprimer"
                                className="ml-0.5 inline-flex h-8 w-8 !min-h-0 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Sélecteur Détail ↔ Gros dans le panier */}
                          {c.product.unitsPerBulk &&
                          c.product.unitsPerBulk >= 2 &&
                          getMaxOrderableQty(c.product, true) > 0 ? (
                            <div className="grid grid-cols-2 gap-1 rounded-lg bg-white p-1 text-[10px] font-bold">
                              <button
                                type="button"
                                onClick={() => toggleCartItemBulk(c.key, false)}
                                className={`rounded py-1 ${
                                  !c.soldInBulk
                                    ? 'bg-forest-900 text-white'
                                    : 'text-slate-600'
                                }`}
                              >
                                Détail ({c.product.unit})
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleCartItemBulk(c.key, true)}
                                className={`rounded py-1 ${
                                  c.soldInBulk
                                    ? 'bg-forest-900 text-limeglow-400'
                                    : 'text-slate-600'
                                }`}
                              >
                                {c.product.bulkUnitLabel || 'Carton'} (×{c.product.unitsPerBulk})
                              </button>
                            </div>
                          ) : null}

                          {/* Sélecteurs Taille & Couleur directement dans le panier */}
                          {(sizes.length > 0 || colors.length > 0) && (
                            <div className="grid grid-cols-1 gap-2 pt-1 min-[360px]:grid-cols-2">
                              {sizes.length > 0 ? (
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500">
                                    Taille
                                  </label>
                                  <select
                                    value={c.selectedSize}
                                    onChange={(e) =>
                                      updateCartItemVariant(c.key, 'selectedSize', e.target.value)
                                    }
                                    className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-800"
                                  >
                                    {sizes.map((s) => (
                                      <option key={s} value={s}>
                                        {s}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}
                              {colors.length > 0 ? (
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500">
                                    Couleur
                                  </label>
                                  <select
                                    value={c.selectedColor}
                                    onChange={(e) =>
                                      updateCartItemVariant(c.key, 'selectedColor', e.target.value)
                                    }
                                    className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-800"
                                  >
                                    {colors.map((col) => (
                                      <option key={col} value={col}>
                                        {col}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Mode retrait / livraison */}
                  {!allowDelivery ? (
                    <div className="flex items-center justify-between rounded-2xl border border-forest-900 bg-forest-900 px-3.5 py-2.5 text-xs font-bold text-white">
                      <span className="inline-flex items-center gap-2">
                        <ShoppingBag className="h-4 w-4 text-limeglow-400" />
                        <span>Retrait directement à la boutique</span>
                      </span>
                      <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-extrabold text-limeglow-300">
                        Retrait gratuit
                      </span>
                    </div>
                  ) : (
                    <div
                      className={`grid gap-2 ${
                        deliveryCfg.pickupEnabled && deliveryCfg.deliveryEnabled
                          ? 'grid-cols-2'
                          : 'grid-cols-1'
                      }`}
                    >
                      {deliveryCfg.pickupEnabled ? (
                        <button
                          type="button"
                          onClick={() => setFulfillmentMode('PICKUP')}
                          className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-bold transition ${
                            fulfillmentMode === 'PICKUP'
                              ? 'border-forest-900 bg-forest-900 text-white'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          <ShoppingBag className="h-4 w-4" />
                          <span>Retrait boutique</span>
                          <span className="text-[10px] opacity-75">Gratuit</span>
                        </button>
                      ) : null}
                      {deliveryCfg.deliveryEnabled ? (
                        <button
                          type="button"
                          onClick={() => setFulfillmentMode('DELIVERY')}
                          className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-bold transition ${
                            fulfillmentMode === 'DELIVERY'
                              ? 'border-forest-900 bg-forest-900 text-white'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          <Truck className="h-4 w-4" />
                          <span>Livraison</span>
                          <span className="text-[10px] opacity-75">
                            {deliveryDistrict.trim() && matchedZone
                              ? `+${formatXof(matchedZone.feeXof)}`
                              : deliveryCfg.deliveryZones && deliveryCfg.deliveryZones.length > 0
                                ? `dès ${formatXof(Math.min(...deliveryCfg.deliveryZones.map((z) => z.feeXof)))}`
                                : `+${formatXof(deliveryCfg.defaultDeliveryFeeXof)}`}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  )}

                  {/* Coordonnées sans compte */}
                  <div className="space-y-2.5 border-t border-slate-100 pt-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                      Vos coordonnées (sans compte)
                    </p>
                    <input
                      required
                      minLength={2}
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Votre nom complet *"
                      className="sc-input"
                    />
                    <input
                      required
                      minLength={6}
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="Téléphone / WhatsApp *"
                      className="sc-input"
                    />
                    {fulfillmentMode === 'DELIVERY' ? (
                      <>
                        {deliveryCfg.deliveryZones && deliveryCfg.deliveryZones.length > 0 ? (
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-700">
                              Quartier / Zone de livraison *
                            </label>
                            <select
                              required
                              value={
                                deliveryCfg.deliveryZones.some(
                                  (z) => z.name.toLowerCase() === deliveryDistrict.toLowerCase(),
                                )
                                  ? deliveryDistrict
                                  : deliveryDistrict.trim()
                                    ? '__OTHER__'
                                    : ''
                              }
                              onChange={(e) => {
                                if (e.target.value === '__OTHER__') {
                                  setDeliveryDistrict('');
                                } else {
                                  setDeliveryDistrict(e.target.value);
                                }
                              }}
                              className="sc-input font-medium"
                            >
                              <option value="">-- Choisir votre quartier --</option>
                              {deliveryCfg.deliveryZones.map((z) => (
                                <option key={z.name} value={z.name}>
                                  {z.name} — {formatXof(z.feeXof)}
                                </option>
                              ))}
                              <option value="__OTHER__">
                                Autre quartier (Tarif standard : {formatXof(deliveryCfg.defaultDeliveryFeeXof)})...
                              </option>
                            </select>

                            {(!deliveryDistrict ||
                              !deliveryCfg.deliveryZones.some(
                                (z) => z.name.toLowerCase() === deliveryDistrict.toLowerCase(),
                              )) && (
                              <input
                                required
                                value={deliveryDistrict}
                                onChange={(e) => setDeliveryDistrict(e.target.value)}
                                placeholder="Précisez le nom de votre quartier *"
                                className="sc-input mt-1.5"
                              />
                            )}

                            <div className="flex items-center justify-between rounded-xl bg-forest-50 px-3 py-2 text-xs font-bold text-forest-900">
                              <span className="flex items-center gap-1.5">
                                <Truck className="h-3.5 w-3.5 text-forest-700" />
                                Frais de livraison appliqués :
                              </span>
                              <span className="rounded-md bg-forest-900 px-2 py-0.5 text-limeglow-400">
                                {formatXof(deliveryFeeXof)}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <input
                              required
                              value={deliveryDistrict}
                              onChange={(e) => setDeliveryDistrict(e.target.value)}
                              placeholder="Quartier / Zone de livraison *"
                              className="sc-input"
                            />
                            <div className="flex items-center justify-between rounded-xl bg-forest-50 px-3 py-1.5 text-xs font-semibold text-forest-900">
                              <span>Frais de livraison standard :</span>
                              <span className="font-bold">{formatXof(deliveryFeeXof)}</span>
                            </div>
                          </div>
                        )}

                        <input
                          required
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          placeholder="Adresse précise / Repère (ex: Pharmacie du carrefour...) *"
                          className="sc-input"
                        />
                      </>
                    ) : null}
                    <input
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                      placeholder="Instructions particulières (optionnel)"
                      className="sc-input"
                    />
                    <input
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={websiteHp}
                      onChange={(e) => setWebsiteHp(e.target.value)}
                      className="hidden"
                      aria-hidden="true"
                    />
                  </div>

                  {orderErr ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                      {orderErr}
                    </div>
                  ) : null}

                  <div className="space-y-1 rounded-2xl bg-porcelain-50 p-3.5 text-xs tabular">
                    <div className="flex justify-between text-slate-600">
                      <span>Sous-total articles</span>
                      <span>{formatXof(subtotalXof)}</span>
                    </div>
                    {deliveryFeeXof > 0 ? (
                      <div className="flex justify-between text-slate-600">
                        <span>Frais de livraison</span>
                        <span>{formatXof(deliveryFeeXof)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-black text-forest-950">
                      <span>Total estimé</span>
                      <span>{formatXof(grandTotalXof)}</span>
                    </div>
                  </div>

                  <button type="submit" disabled={submitting} className="sc-btn-lime w-full py-3 text-sm">
                    {submitting ? 'Envoi en cours…' : 'Confirmer ma commande'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Bouton flottant Chat boutique */}
      {!chatOpen && !cartOpen && !detailProduct ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Ouvrir la messagerie avec la boutique"
          className={`fixed right-4 z-30 flex items-center gap-2 rounded-full bg-forest-950 px-4 py-3 text-xs font-extrabold text-white shadow-2xl ring-2 ring-limeglow-400/60 transition hover:bg-forest-800 ${
            totalItems > 0 ? 'bottom-24' : 'bottom-4 sm:bottom-5'
          }`}
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-limeglow-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-limeglow-400" />
          </span>
          <MessageCircle className="h-4 w-4 text-limeglow-400" />
          <span className="hidden sm:inline">Discuter avec la boutique</span>
        </button>
      ) : null}

      {/* Drawer Messagerie Directe Client <-> Boutique (Design soigné) */}
      {chatOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-forest-950/65 backdrop-blur-xs">
          <div className="sc-drawer flex h-dvh w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 bg-forest-950 px-4 py-3.5 text-white">
              <div className="flex items-center gap-3 min-w-0">
                {shop.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shop.logoUrl} alt={shop.name} className="h-9 w-9 rounded-xl bg-white object-contain p-1" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 font-black text-limeglow-400">
                    {shop.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-extrabold">{shop.name}</h2>
                  <p className="flex items-center gap-1.5 text-[11px] text-emerald-200/80">
                    <span className="h-2 w-2 rounded-full bg-limeglow-400" />
                    Messagerie directe · Sans compte
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="rounded-xl p-1.5 text-emerald-200 hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-porcelain-100 p-4">
              {chatMessages.length === 0 ? (
                <div className="space-y-3 py-6 text-center">
                  <p className="text-xs font-semibold text-slate-600">
                    Posez directement vos questions à <strong>{shop.name}</strong> :
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {[
                      'Quelles tailles sont disponibles ?',
                      'Livrez-vous aujourd’hui ?',
                      'Avez-vous d’autres couleurs ?',
                    ].map((quick) => (
                      <button
                        key={quick}
                        type="button"
                        onClick={() => setChatText(quick)}
                        className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-brand-800 hover:bg-brand-50"
                      >
                        {quick}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatMessages.map((m) => {
                  const isClient = m.senderRole === 'CLIENT';
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isClient ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-xs ${
                          isClient
                            ? 'rounded-br-sm bg-forest-900 text-white'
                            : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
                        }`}
                      >
                        <p className="text-[10px] font-bold opacity-70">{m.senderName}</p>
                        <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                      </div>
                      <span className="mt-1 px-1 text-[9px] text-slate-400">
                        {formatDateTimeInTimezone(m.createdAt)}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            <form onSubmit={handleSendChat} className="space-y-2 border-t border-slate-200 bg-white p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
              {chatErr ? <p className="text-xs font-semibold text-rose-600">{chatErr}</p> : null}
              {!chatToken ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    required
                    value={chatName}
                    onChange={(e) => setChatName(e.target.value)}
                    placeholder="Votre nom *"
                    className="sc-input py-2 text-xs"
                  />
                  <input
                    required
                    value={chatPhone}
                    onChange={(e) => setChatPhone(e.target.value)}
                    placeholder="Téléphone *"
                    className="sc-input py-2 text-xs"
                  />
                </div>
              ) : null}
              <div className="flex gap-2">
                <input
                  required
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Écrire un message…"
                  className="sc-input min-w-0 flex-1 py-2 text-xs"
                />
                <button type="submit" disabled={chatBusy} className="sc-btn-primary shrink-0 px-3.5 py-2">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {/* Modale Compte Client Optionnel (Connexion / Inscription / Mes commandes & solde) */}
      {accountOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-forest-950/65 p-0 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => setAccountOpen(false)}
        >
          <div
            className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-forest-950 px-4 py-3 text-white sm:px-5 sm:py-3.5">
              <div className="flex min-w-0 items-center gap-2">
                <User className="h-4 w-4 shrink-0 text-limeglow-400" />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold text-white">
                    {customerData?.authenticated && customerData.customer
                      ? `Mon compte · ${customerData.customer.fullName}`
                      : 'Compte client (optionnel)'}
                  </h2>
                  <p className="truncate text-[11px] text-emerald-200/70">{shop.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAccountOpen(false)}
                className="shrink-0 rounded-xl p-1.5 text-emerald-200 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5">
              {customerData?.authenticated && customerData.customer ? (
                <>
                  {/* Coordonnées client */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#f7f9fb] p-3.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{customerData.customer.fullName}</p>
                      <p className="text-slate-500">
                        {customerData.customer.phone}
                        {customerData.customer.email ? ` · ${customerData.customer.email}` : ''}
                      </p>
                      {customerData.customer.address ? (
                        <p className="text-slate-500">{customerData.customer.address}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={authBusy}
                      onClick={handleCustomerLogout}
                      className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Déconnexion
                    </button>
                  </div>

                  {/* Solde / Dettes éventuelles auprès de la boutique */}
                  {(customerData.outstandingDebtXof ?? 0) > 0 ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-bold text-amber-950">
                          <Receipt className="h-4 w-4 text-amber-700" />
                          Solde crédit en cours
                        </span>
                        <span className="font-extrabold text-rose-700 tabular">
                          {formatXof(customerData.outstandingDebtXof ?? 0)}
                        </span>
                      </div>
                      {customerData.receivables && customerData.receivables.length > 0 ? (
                        <div className="mt-2 space-y-1 text-[11px] text-amber-900/90">
                          {customerData.receivables
                            .filter((r) => r.status !== 'PAID')
                            .map((r) => (
                              <div key={r.id} className="flex items-center justify-between gap-2">
                                <span className="truncate">
                                  {r.saleNumber || r.description || 'Crédit boutique'}
                                </span>
                                <span className="shrink-0 font-bold tabular">
                                  {formatXof(r.remainingAmountXof)}
                                </span>
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Historique des commandes */}
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Mes commandes ({customerData.orders?.length ?? 0})
                    </h3>
                    {!customerData.orders || customerData.orders.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">
                        Vous n’avez pas encore passé de commande avec ce compte.
                      </p>
                    ) : (
                      customerData.orders.map((ord) => (
                        <div
                          key={ord.id}
                          className="rounded-2xl border border-slate-200 bg-white p-3.5 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono font-bold text-slate-900">
                              {ord.orderNumber}
                            </span>
                            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-bold text-brand-800">
                              {ONLINE_ORDER_STATUS_LABELS[ord.status] || ord.status}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                            {ord.lines.map((l) => (
                              <p key={l.id}>
                                {l.orderedQty}× {l.productName}
                                {l.selectedSize ? ` · T.${l.selectedSize}` : ''}
                                {l.selectedColor ? ` · ${l.selectedColor}` : ''}
                              </p>
                            ))}
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                            <span className="font-extrabold text-slate-900 tabular">
                              {formatXof(ord.totalXof)}
                            </span>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  for (const l of ord.lines) {
                                    const baseName = l.productName.split(' [')[0].trim().toLowerCase();
                                    const matched = products.find(
                                      (p) => p.name.trim().toLowerCase() === baseName && p.inStock,
                                    );
                                    if (matched) {
                                      const isBulk = l.productName.includes(' [') && Boolean(matched.unitsPerBulk && matched.unitsPerBulk >= 2);
                                      addItemToCart(
                                        matched,
                                        l.selectedSize || '',
                                        l.selectedColor || '',
                                        l.orderedQty,
                                        isBulk,
                                      );
                                    }
                                  }
                                  setAccountOpen(false);
                                  setCartOpen(true);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-forest-900 px-2.5 py-1 text-[11px] font-bold text-limeglow-400 hover:bg-forest-800"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Recommander
                              </button>
                              <Link
                                href={ord.trackingPath}
                                onClick={() => setAccountOpen(false)}
                                className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                              >
                                Suivre
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="rounded-xl bg-[#f7f9fb] p-3 text-xs text-slate-600">
                    La création de compte est <strong>entièrement facultative</strong> : elle vous
                    permet de retrouver vos commandes, suivre votre solde et pré-remplir vos
                    coordonnées plus rapidement.
                  </p>

                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab('login');
                        setAuthErr(null);
                      }}
                      className={`rounded-lg py-1.5 transition ${
                        authTab === 'login' ? 'bg-forest-900 text-white' : 'text-slate-600'
                      }`}
                    >
                      Se connecter
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab('register');
                        setAuthErr(null);
                      }}
                      className={`rounded-lg py-1.5 transition ${
                        authTab === 'register' ? 'bg-forest-900 text-white' : 'text-slate-600'
                      }`}
                    >
                      Créer un compte
                    </button>
                  </div>

                  {authErr ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                      {authErr}
                    </div>
                  ) : null}

                  {authTab === 'login' ? (
                    <form onSubmit={handleCustomerLogin} className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Téléphone ou e-mail *
                        </label>
                        <input
                          required
                          value={loginIdentifier}
                          onChange={(e) => setLoginIdentifier(e.target.value)}
                          placeholder="+223 70 00 00 00"
                          className="sc-input"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Mot de passe *
                        </label>
                        <input
                          type="password"
                          required
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          className="sc-input"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={authBusy}
                        className="sc-btn-primary w-full text-xs"
                      >
                        {authBusy ? 'Connexion…' : 'Me connecter'}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleCustomerRegister} className="space-y-2.5">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Nom complet *
                        </label>
                        <input
                          required
                          value={regForm.fullName}
                          onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })}
                          placeholder="Votre nom et prénom"
                          className="sc-input"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            Téléphone *
                          </label>
                          <input
                            required
                            value={regForm.phone}
                            onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                            placeholder="+223 70 00 00 00"
                            className="sc-input"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            E-mail (optionnel)
                          </label>
                          <input
                            type="email"
                            value={regForm.email}
                            onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                            placeholder="nom@exemple.com"
                            className="sc-input"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Adresse / Quartier (optionnel)
                        </label>
                        <input
                          value={regForm.address}
                          onChange={(e) => setRegForm({ ...regForm, address: e.target.value })}
                          placeholder="Pour pré-remplir vos livraisons"
                          className="sc-input"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Mot de passe (min. 6 caractères) *
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={regForm.password}
                          onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                          className="sc-input"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={authBusy}
                        className="sc-btn-primary w-full text-xs"
                      >
                        {authBusy ? 'Création…' : 'Créer mon compte client'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Signature en indice Chakir's Entreprise */}
      <footer className="border-t border-slate-200/70 bg-white/70 px-4 py-4 text-center text-[11px] text-slate-400">
        <span>{shop.name} · Propulsé par </span>
        <sub className="bottom-[-0.18em] text-[10px] font-semibold tracking-wide text-slate-500">
          Chakir’s Entreprise
        </sub>
      </footer>
    </div>
  );
}
