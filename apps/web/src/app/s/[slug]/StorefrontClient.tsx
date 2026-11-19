'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  Send,
  ShoppingBag,
  Store,
  Truck,
  X,
} from 'lucide-react';
import { formatXof, FulfillmentMode } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';

interface StorefrontData {
  available: boolean;
  status: string;
  isOpenNow: boolean;
  message?: string;
  shop: {
    id: string;
    name: string;
    slug: string;
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
      whatsappNumber?: string;
      allowOutOfHoursOrders: boolean;
      outOfHoursMessage?: string;
    };
  };
  categories: Array<{ id: string; name: string }>;
  products: Array<{
    id: string;
    name: string;
    sku: string;
    description: string | null;
    categoryId: string | null;
    categoryName: string | null;
    unit: string;
    salePriceXof: number;
    imageUrls: string[];
    stockAvailable: number;
    inStock: boolean;
  }>;
}

interface OrderConfirmation {
  orderNumber: string;
  secretToken: string;
  trackingPath: string;
  totalXof: number;
  outOfHours: boolean;
  outOfHoursMessage: string | null;
}

export function StorefrontClient({ initialData }: { initialData: StorefrontData }) {
  const { shop, categories, products, isOpenNow } = initialData;
  const deliveryCfg = shop.deliveryConfig;

  const [search, setSearch] = useState('');
  const [catId, setCatId] = useState('');
  const [cart, setCart] = useState<Array<{ product: StorefrontData['products'][number]; qty: number }>>([]);
  const [cartOpen, setCartOpen] = useState(false);

  // Formulaire commande sans compte
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>(
    deliveryCfg.pickupEnabled ? 'PICKUP' : 'DELIVERY',
  );
  const [deliveryDistrict, setDeliveryDistrict] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [websiteHp, setWebsiteHp] = useState(''); // anti-bot honeypot
  const [submitting, setSubmitting] = useState(false);
  const [orderErr, setOrderErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<OrderConfirmation | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Chat public client <-> boutique
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

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catId && p.categoryId !== catId) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        p.sku.toLowerCase().includes(q)
      );
    });
  }, [products, search, catId]);

  const addItem = (product: StorefrontData['products'][number]) => {
    if (!product.inStock) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.qty >= product.stockAvailable) return prev;
        return prev.map((i) => (i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.product.id !== productId) return i;
          const next = Math.min(i.product.stockAvailable, i.qty + delta);
          return { ...i, qty: next };
        })
        .filter((i) => i.qty > 0),
    );
  };

  const subtotalXof = cart.reduce((a, i) => a + i.product.salePriceXof * i.qty, 0);
  const deliveryFeeXof = fulfillmentMode === 'DELIVERY' ? deliveryCfg.defaultDeliveryFeeXof : 0;
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
          items: cart.map((c) => ({ productId: c.product.id, quantity: c.qty })),
        },
      });
      setConfirmed(res);
      setCart([]);
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
    <div className="min-h-screen bg-porcelain-100 pb-24">
      {/* En-tête Vitrine Obsidian Emerald */}
      <header className="obsidian-hero text-white">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {shop.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shop.logoUrl}
                  alt={shop.name}
                  className="h-14 w-14 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-md sm:h-16 sm:w-16"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-xl font-black text-limeglow-400 ring-1 ring-white/20">
                  <Store className="h-7 w-7" />
                </span>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                    {shop.name}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      isOpenNow
                        ? 'bg-emerald-500/20 text-limeglow-300 ring-1 ring-limeglow-400/30'
                        : 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/30'
                    }`}
                  >
                    <Clock className="h-3 w-3" />
                    {isOpenNow ? 'Ouverte' : 'Fermée (commande différée)'}
                  </span>
                </div>
                {shop.slogan ? (
                  <p className="mt-0.5 text-xs text-emerald-100/80 sm:text-sm">{shop.slogan}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-emerald-200/75">
                  {shop.address ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-limeglow-400" />
                      {shop.address}
                    </span>
                  ) : null}
                  {shop.phone ? (
                    <a href={`tel:${shop.phone}`} className="inline-flex items-center gap-1 hover:text-white">
                      <Phone className="h-3 w-3 text-limeglow-400" />
                      {shop.phone}
                    </a>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/s/${shop.slug}/track`}
                className="rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/15"
              >
                Suivre ma commande
              </Link>
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/15"
              >
                <MessageCircle className="h-3.5 w-3.5 text-limeglow-400" />
                Contacter
              </button>
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="relative inline-flex items-center gap-2 rounded-full bg-limeglow-400 px-4 py-2 text-xs font-extrabold text-forest-950 shadow-lime hover:bg-limeglow-300"
              >
                <ShoppingBag className="h-4 w-4" />
                <span>Panier ({totalItems})</span>
              </button>
            </div>
          </div>

          {/* Barre de recherche & Catégories */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-emerald-200/60" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un article dans cette boutique…"
                className="w-full rounded-2xl border border-white/15 bg-white/10 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-emerald-200/60 focus:border-limeglow-400 focus:bg-white/15"
              />
            </div>
            {categories.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setCatId('')}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition ${
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
                    className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition ${
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
        </div>
      </header>

      {/* Grille Catalogue Temps Réel */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {filteredProducts.length === 0 ? (
          <div className="sc-card p-10 text-center">
            <Package className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-bold text-slate-800">Aucun article publié trouvé</p>
            <p className="mt-1 text-xs text-slate-500">
              Essayez un autre mot-clé ou contactez directement la boutique.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
            {filteredProducts.map((p) => {
              const inCart = cart.find((c) => c.product.id === p.id);
              const photo = p.imageUrls?.[0];
              return (
                <div
                  key={p.id}
                  className="sc-card-hover flex flex-col overflow-hidden rounded-2xl"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-porcelain-50">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo}
                        alt={p.name}
                        className="h-full w-full object-cover transition duration-300 hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center text-slate-300">
                        <Package className="h-10 w-10" />
                      </div>
                    )}
                    <span
                      className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold backdrop-blur-xs ${
                        p.inStock
                          ? 'bg-emerald-950/75 text-limeglow-300'
                          : 'bg-rose-600/90 text-white'
                      }`}
                    >
                      {p.inStock ? `${p.stockAvailable} en stock` : 'Rupture'}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col justify-between p-3 sm:p-3.5">
                    <div>
                      {p.categoryName ? (
                        <p className="text-[10px] font-bold uppercase tracking-wide text-brand-700">
                          {p.categoryName}
                        </p>
                      ) : null}
                      <h2 className="mt-0.5 line-clamp-2 text-xs font-extrabold text-slate-900 sm:text-sm">
                        {p.name}
                      </h2>
                      {p.description ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                          {p.description}
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-3 space-y-2">
                      <p className="text-sm font-black text-forest-950 tabular sm:text-base">
                        {formatXof(p.salePriceXof)}
                      </p>

                      {inCart ? (
                        <div className="flex items-center justify-between rounded-xl border border-forest-900 bg-forest-900 px-2 py-1 text-white">
                          <button
                            type="button"
                            onClick={() => updateQty(p.id, -1)}
                            className="rounded-lg p-1 hover:bg-white/15"
                            aria-label="Retirer"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-xs font-extrabold tabular">{inCart.qty}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(p.id, 1)}
                            className="rounded-lg p-1 hover:bg-white/15"
                            aria-label="Ajouter"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!p.inStock}
                          onClick={() => addItem(p)}
                          className="w-full rounded-xl bg-forest-900 py-2 text-xs font-bold text-white transition hover:bg-forest-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          {p.inStock ? 'Ajouter au panier' : 'Indisponible'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Barre flottante Panier mobile */}
      {totalItems > 0 && !cartOpen ? (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-md items-center justify-between rounded-2xl border border-limeglow-400/40 bg-forest-950 px-4 py-3 text-white shadow-2xl">
          <div>
            <p className="text-[11px] text-emerald-200/80">{totalItems} article(s)</p>
            <p className="text-base font-extrabold tabular">{formatXof(subtotalXof)}</p>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="sc-btn-lime rounded-full px-5 py-2 text-xs"
          >
            Commander →
          </button>
        </div>
      ) : null}

      {/* Drawer Panier & Commande Sans Compte */}
      {cartOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-forest-950/70 backdrop-blur-xs">
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
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

            <div className="flex-1 overflow-y-auto p-5">
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
                    <div className="mt-3 flex gap-2">
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
                  Ajoutez des articles depuis le catalogue pour commander sans créer de compte.
                </p>
              ) : (
                <form onSubmit={handlePlaceOrder} className="space-y-4">
                  {/* Articles */}
                  <div className="space-y-2">
                    {cart.map((c) => (
                      <div
                        key={c.product.id}
                        className="flex items-center justify-between gap-2 rounded-2xl bg-porcelain-50 p-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold text-slate-900">{c.product.name}</p>
                          <p className="text-slate-500 tabular">
                            {formatXof(c.product.salePriceXof)} × {c.qty}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateQty(c.product.id, -1)}
                            className="rounded-lg border border-slate-200 bg-white p-1"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-6 text-center font-bold">{c.qty}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(c.product.id, 1)}
                            className="rounded-lg border border-slate-200 bg-white p-1"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Mode retrait / livraison */}
                  <div className="grid grid-cols-2 gap-2">
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
                          +{formatXof(deliveryCfg.defaultDeliveryFeeXof)}
                        </span>
                      </button>
                    ) : null}
                  </div>

                  {/* Coordonnées sans compte */}
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                      Vos coordonnées (aucun compte requis)
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
                      placeholder="Téléphone / WhatsApp (ex. +223 70 00 00 00) *"
                      className="sc-input"
                    />
                    {fulfillmentMode === 'DELIVERY' ? (
                      <>
                        <input
                          required
                          value={deliveryDistrict}
                          onChange={(e) => setDeliveryDistrict(e.target.value)}
                          placeholder="Quartier / Zone de livraison *"
                          className="sc-input"
                        />
                        <input
                          required
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          placeholder="Adresse précise / Repère *"
                          className="sc-input"
                        />
                      </>
                    ) : null}
                    <input
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                      placeholder="Précision (taille, couleur, heure souhaitée…)"
                      className="sc-input"
                    />
                    {/* Honeypot anti-robot invisible */}
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

                  <div className="rounded-2xl bg-porcelain-50 p-3.5 text-xs space-y-1 tabular">
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

                  <button
                    type="submit"
                    disabled={submitting}
                    className="sc-btn-lime w-full py-3 text-sm"
                  >
                    {submitting ? 'Envoi de votre commande…' : 'Confirmer ma commande'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Drawer Messagerie Directe Client <-> Boutique (Lot 6) */}
      {chatOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-forest-950/60 backdrop-blur-xs">
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-forest-950 px-5 py-4 text-white">
              <div>
                <h2 className="text-sm font-extrabold">Discuter avec {shop.name}</h2>
                <p className="text-[11px] text-emerald-200/75">
                  Réponse directe par la boutique · Sans création de compte
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="rounded-xl p-1.5 text-emerald-200 hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto bg-porcelain-50 p-4">
              {chatMessages.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">
                  Posez une question sur un produit, une taille ou la livraison !
                </p>
              ) : (
                chatMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs ${
                      m.senderRole === 'CLIENT'
                        ? 'ml-auto bg-forest-900 text-white'
                        : 'bg-white text-slate-800 shadow-xs border border-slate-200'
                    }`}
                  >
                    <p className="text-[10px] font-bold opacity-70">{m.senderName}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendChat} className="space-y-2 border-t border-slate-200 bg-white p-4">
              {chatErr ? (
                <p className="text-xs font-semibold text-rose-600">{chatErr}</p>
              ) : null}
              {!chatToken ? (
                <div className="grid grid-cols-2 gap-2">
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
                  placeholder="Écrire un message à la boutique…"
                  className="sc-input py-2 text-xs"
                />
                <button type="submit" disabled={chatBusy} className="sc-btn-primary px-3.5 py-2">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
