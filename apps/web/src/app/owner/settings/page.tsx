'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CheckCircle2,
  Crown,
  ExternalLink,
  FileSearch,
  Laptop,
  LifeBuoy,
  MessageSquarePlus,
  QrCode,
  Receipt,
  Save,
  Send,
  ShieldCheck,
  Store,
  Truck,
  MapPin,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  BusinessProfileConfig,
  DEFAULT_DELIVERY_CONFIG,
  DEFAULT_RECEIPT_SETTINGS,
  formatDateTimeInTimezone,
  formatXof,
  normalizeBusinessProfile,
  normalizeShopType,
  PLATFORM_MODULE_LABELS,
  PlatformModuleKey,
  SHOP_TYPE_SHORT_LABELS,
  ShopType,
  SUBSCRIPTION_BILLING_CYCLE_LABELS,
  SUBSCRIPTION_BILLING_CYCLE_SUFFIX,
  SUBSCRIPTION_PLAN_LABELS,
  SubscriptionBillingCycle,
  SubscriptionPlan,
  SUPPORT_TICKET_STATUS_LABELS,
  SupportTicketStatus,
  TAX_MODES,
  TaxMode,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ImageUploader } from '@/components/ui/ImageUploader';
import { ShopQrModal } from '@/components/commerce/ShopQrModal';
import { ErrorState, LoadingSkeleton, StatusBadge } from '@/components/ui/StateViews';

interface MerchantProfile {
  id: string;
  name: string;
  legalName: string | null;
  phone: string;
  email: string;
  status: string;
  currency: string;
  defaultTimezone: string;
  supportAccessHistory: Array<{
    id: string;
    superAdminName: string;
    reason: string;
    readOnly: boolean;
    expiresAt: string;
    active: boolean;
    createdAt: string;
  }>;
}

interface ShopDetail {
  id: string;
  name: string;
  slug: string;
  shopType?: ShopType;
  businessProfile?: BusinessProfileConfig | null;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  taxMode: TaxMode;
  defaultTaxRateBps: number;
  status: string;
  receiptSettings?: Record<string, any> | null;
  deliveryConfig?: Record<string, any> | null;
}

interface SessionRow {
  id: string;
  deviceName: string;
  ipAddress: string | null;
  lastActiveAt: string;
  isCurrent: boolean;
}

interface SubscriptionPayload {
  subscription: {
    planCode: SubscriptionPlan;
    billingCycle?: SubscriptionBillingCycle;
    priceXof?: number;
    monthlyPriceXof: number;
    maxShops: number;
    maxAgentsPerShop: number;
    enabledModules: PlatformModuleKey[];
    trialEndsAt?: string | null;
    currentPeriodEnd: string;
  };
  payments: Array<{
    id: string;
    amountXof: number;
    paymentMethodCode: string;
    periodLabel: string;
    reference: string | null;
    paidAt: string;
  }>;
}

interface SupportTicketRow {
  id: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: SupportTicketStatus;
  createdAt: string;
  messages: Array<{
    id: string;
    senderRole: string;
    senderName: string;
    body: string;
    createdAt: string;
  }>;
}

export default function OwnerSettingsPage() {
  const { user, shops, selectedShopId, refreshMe, supportGrantId } = useAuth();
  const [tab, setTab] = useState<'shop' | 'company' | 'security'>('shop');

  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [subData, setSubData] = useState<SubscriptionPayload | null>(null);
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [shopList, setShopList] = useState<ShopDetail[]>([]);
  const [activeShopId, setActiveShopId] = useState<string>('');
  const [qrOpen, setQrOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Formulaire Entreprise
  const [companyForm, setCompanyForm] = useState({ name: '', legalName: '', phone: '', email: '' });

  // Formulaire Boutique + Logo + Ticket + Livraison
  const [shopForm, setShopForm] = useState({
    name: '',
    slug: '',
    logoUrl: null as string | null,
    phone: '',
    email: '',
    address: '',
    taxMode: 'NONE' as TaxMode,
    taxRatePercent: 0,
    slogan: '',
    headerText: '',
    footerText: DEFAULT_RECEIPT_SETTINGS.footerText,
    legalNotice: DEFAULT_RECEIPT_SETTINGS.legalNotice,
    showLogo: true,
    paperWidthMm: 80 as 58 | 80,
    pickupEnabled: true,
    deliveryEnabled: true,
    defaultDeliveryFeeXof: 1000,
    deliveryZones: [] as Array<{ name: string; feeXof: number }>,
    whatsappNumber: '',
    allowOutOfHoursOrders: true,
    outOfHoursMessage: DEFAULT_DELIVERY_CONFIG.outOfHoursMessage,
    maxOrderQty: 100,
    maxOrderAmountXof: 5_000_000,
  });

  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneFee, setNewZoneFee] = useState<number | ''>('');

  const addDeliveryZone = () => {
    if (!newZoneName.trim() || newZoneFee === '' || Number(newZoneFee) < 0) return;
    const trimmed = newZoneName.trim();
    if (shopForm.deliveryZones.some((z) => z.name.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    setShopForm((prev) => ({
      ...prev,
      deliveryZones: [...prev.deliveryZones, { name: trimmed, feeXof: Math.round(Number(newZoneFee)) }],
    }));
    setNewZoneName('');
    setNewZoneFee('');
  };

  const removeDeliveryZone = (index: number) => {
    setShopForm((prev) => ({
      ...prev,
      deliveryZones: prev.deliveryZones.filter((_, i) => i !== index),
    }));
  };

  const quickAddPresetZone = (name: string, feeXof: number) => {
    if (shopForm.deliveryZones.some((z) => z.name.toLowerCase() === name.toLowerCase())) return;
    setShopForm((prev) => ({
      ...prev,
      deliveryZones: [...prev.deliveryZones, { name, feeXof }],
    }));
  };

  // Nouveau ticket support
  const [ticketForm, setTicketForm] = useState({ subject: '', priority: 'INFO', message: '' });
  const [replyByTicket, setReplyByTicket] = useState<Record<string, string>>({});

  const hydrateShopForm = useCallback((s: ShopDetail) => {
    const r = { ...DEFAULT_RECEIPT_SETTINGS, ...(s.receiptSettings || {}) };
    const d = { ...DEFAULT_DELIVERY_CONFIG, ...(s.deliveryConfig || {}) };
    setShopForm({
      name: s.name || '',
      slug: s.slug || '',
      logoUrl: s.logoUrl || null,
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      taxMode: s.taxMode || 'NONE',
      taxRatePercent: Number(((s.defaultTaxRateBps || 0) / 100).toFixed(2)),
      slogan: r.slogan || '',
      headerText: r.headerText || '',
      footerText: r.footerText || DEFAULT_RECEIPT_SETTINGS.footerText,
      legalNotice: r.legalNotice || DEFAULT_RECEIPT_SETTINGS.legalNotice,
      showLogo: r.showLogo !== false,
      paperWidthMm: r.paperWidthMm === 58 ? 58 : 80,
      pickupEnabled: d.pickupEnabled !== false,
      deliveryEnabled: d.deliveryEnabled !== false,
      defaultDeliveryFeeXof: Number(d.defaultDeliveryFeeXof ?? 1000),
      deliveryZones: Array.isArray(d.deliveryZones)
        ? d.deliveryZones.map((z: any) => ({ name: String(z.name || ''), feeXof: Number(z.feeXof || 0) }))
        : [],
      whatsappNumber: d.whatsappNumber || '',
      allowOutOfHoursOrders: d.allowOutOfHoursOrders !== false,
      outOfHoursMessage: d.outOfHoursMessage || DEFAULT_DELIVERY_CONFIG.outOfHoursMessage,
      maxOrderQty: Number(d.maxOrderQty ?? 100),
      maxOrderAmountXof: Number(d.maxOrderAmountXof ?? 5_000_000),
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s, sh, sub, tks] = await Promise.all([
        apiFetch<MerchantProfile>('/merchant', { supportGrantId }),
        apiFetch<SessionRow[]>('/auth/sessions'),
        apiFetch<ShopDetail[]>('/shops', { supportGrantId }),
        apiFetch<SubscriptionPayload>('/merchant/subscription').catch(() => null),
        apiFetch<SupportTicketRow[]>('/support/tickets').catch(() => []),
      ]);
      setProfile(p);
      setSessions(s);
      setShopList(sh);
      setSubData(sub);
      setTickets(tks);
      setCompanyForm({
        name: p.name,
        legalName: p.legalName || '',
        phone: p.phone,
        email: p.email,
      });

      if (sh.length > 0) {
        const preferred =
          (activeShopId && sh.find((x) => x.id === activeShopId)) ||
          (selectedShopId !== 'ALL' && sh.find((x) => x.id === selectedShopId)) ||
          sh[0];
        setActiveShopId(preferred.id);
        hydrateShopForm(preferred);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des paramètres.');
    } finally {
      setLoading(false);
    }
  }, [supportGrantId, selectedShopId, activeShopId, hydrateShopForm]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportGrantId]);

  const handleSelectShop = (id: string) => {
    setActiveShopId(id);
    const found = shopList.find((s) => s.id === id);
    if (found) hydrateShopForm(found);
    setSavedMsg(null);
  };

  const handleSaveShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShopId) return;
    setBusy(true);
    setSavedMsg(null);
    setError(null);
    try {
      const updated = await apiFetch<ShopDetail>(`/shops/${activeShopId}`, {
        method: 'PATCH',
        shopId: activeShopId,
        body: {
          name: shopForm.name.trim(),
          slug: shopForm.slug.trim(),
          logoUrl: shopForm.logoUrl,
          phone: shopForm.phone.trim() || undefined,
          email: shopForm.email.trim() || '',
          address: shopForm.address.trim() || undefined,
          taxMode: shopForm.taxMode,
          defaultTaxRateBps: Math.round((Number(shopForm.taxRatePercent) || 0) * 100),
          receiptSettings: {
            slogan: shopForm.slogan.trim(),
            headerText: shopForm.headerText.trim(),
            footerText: shopForm.footerText.trim(),
            legalNotice: shopForm.legalNotice.trim(),
            showLogo: shopForm.showLogo,
            paperWidthMm: shopForm.paperWidthMm,
          },
          deliveryConfig: {
            pickupEnabled: shopForm.pickupEnabled,
            deliveryEnabled: shopForm.deliveryEnabled,
            defaultDeliveryFeeXof: Math.max(0, Math.round(Number(shopForm.defaultDeliveryFeeXof) || 0)),
            deliveryZones: shopForm.deliveryZones
              .filter((z) => z.name.trim())
              .map((z) => ({
                name: z.name.trim(),
                feeXof: Math.max(0, Math.round(Number(z.feeXof) || 0)),
              })),
            allowOutOfHoursOrders: shopForm.allowOutOfHoursOrders,
            outOfHoursMessage: shopForm.outOfHoursMessage.trim(),
            whatsappNumber: shopForm.whatsappNumber.trim(),
            maxOrderQty: Math.max(1, Math.round(Number(shopForm.maxOrderQty) || 100)),
            maxOrderAmountXof: Math.max(0, Math.round(Number(shopForm.maxOrderAmountXof) || 5_000_000)),
            maxOrdersPerPhonePerHour: 5,
          },
        },
      });
      setShopList((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
      await refreshMe();
      setSavedMsg('Logo et informations de la boutique enregistrés avec succès !');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement boutique impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSavedMsg(null);
    setError(null);
    try {
      await apiFetch('/merchant', {
        method: 'PATCH',
        body: {
          name: companyForm.name,
          legalName: companyForm.legalName.trim() || null,
          phone: companyForm.phone,
          email: companyForm.email,
        },
      });
      await Promise.all([load(), refreshMe()]);
      setSavedMsg('Fiche entreprise enregistrée.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mise à jour impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/support/tickets', { method: 'POST', body: ticketForm });
      setTicketForm({ subject: '', priority: 'INFO', message: '' });
      await load();
      setSavedMsg('Ticket support envoyé à l’équipe ShopControl.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de créer le ticket.');
    } finally {
      setBusy(false);
    }
  };

  const handleReplyTicket = async (ticketId: string) => {
    const body = (replyByTicket[ticketId] || '').trim();
    if (!body) return;
    try {
      await apiFetch(`/support/tickets/${ticketId}/reply`, { method: 'POST', body: { body } });
      setReplyByTicket((prev) => ({ ...prev, [ticketId]: '' }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    await apiFetch(`/auth/sessions/${sessionId}`, { method: 'DELETE' });
    await load();
  };

  const currentShop = shopList.find((s) => s.id === activeShopId) || null;

  return (
    <AppShell
      allowedRoles={['OWNER']}
      title="Paramètres, Logo & Boutique"
      subtitle="Personnalisez l’identité visuelle (logo, coordonnées, tickets, vitrine QR), votre abonnement et votre sécurité."
      headerActions={
        <div className="grid w-full grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-forest-800/80 p-0.5 text-[11px] font-semibold sm:inline-flex sm:w-auto sm:rounded-full sm:text-xs">
          {(
            [
              { id: 'shop', label: 'Logo & Boutique', shortLabel: 'Boutique', icon: Store },
              { id: 'company', label: 'Entreprise & SaaS', shortLabel: 'Entreprise', icon: Building2 },
              { id: 'security', label: 'Sécurité', shortLabel: 'Sécurité', icon: ShieldCheck },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setSavedMsg(null);
                }}
                className={`inline-flex min-w-0 items-center justify-center gap-1 rounded-xl px-2 py-1.5 font-bold transition sm:gap-1.5 sm:rounded-full sm:px-3 ${
                  tab === t.id
                    ? 'bg-white text-forest-950 shadow-sm'
                    : 'text-[#8aa8a2] hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate sm:hidden">{t.shortLabel}</span>
                <span className="hidden truncate sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
      }
    >
      <div className="space-y-5">

        {savedMsg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{savedMsg}</span>
          </div>
        ) : null}

        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : tab === 'shop' ? (
          shopList.length === 0 ? (
            <div className="sc-card p-8 text-center">
              <p className="text-sm font-semibold text-slate-700">
                Aucune boutique créée pour le moment.
              </p>
              <Link href="/owner/shops" className="sc-btn-primary mt-3 inline-flex">
                Créer ma première boutique
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSaveShop} className="space-y-5">
              {/* Sélecteur de boutique + raccourcis QR / Vitrine */}
              <div className="sc-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wide text-slate-500 shrink-0">
                    Boutique configurée :
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {shopList.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleSelectShop(s.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                          activeShopId === s.id
                            ? 'bg-forest-900 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {s.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.logoUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                        ) : null}
                        <span>{s.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {currentShop ? (
                  <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:w-auto sm:items-center sm:gap-2 pt-2 sm:pt-0 border-t border-slate-100 sm:border-0">
                    <button
                      type="button"
                      onClick={() => setQrOpen(true)}
                      className="sc-btn-lime justify-center px-3 py-2 text-xs"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      <span>QR Code</span>
                    </button>
                    <a
                      href={`/s/${shopForm.slug || currentShop.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sc-btn-ghost justify-center px-3 py-2 text-xs"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Vitrine</span>
                    </a>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-5 lg:grid-cols-12">
                {/* Colonne gauche : Logo & Identité + Aperçu live */}
                <div className="space-y-5 lg:col-span-5">
                  <section className="sc-card space-y-4 p-4 sm:p-5">
                    <div className="flex items-center gap-2">
                      <Store className="h-5 w-5 text-brand-700" />
                      <h2 className="text-base font-extrabold text-slate-900">
                        Logo & Identité visuelle
                      </h2>
                    </div>

                    <ImageUploader
                      purpose="logo"
                      aspect="wide"
                      label="Logo officiel de la boutique"
                      hint="Utilisé sur votre vitrine QR publique, votre affiche QR et l’en-tête des tickets de caisse / PDF."
                      value={shopForm.logoUrl}
                      onChange={(url) => setShopForm((f) => ({ ...f, logoUrl: url }))}
                    />

                    {/* Aperçu temps réel vitrine & ticket */}
                    <div className="rounded-2xl border border-slate-200 bg-forest-950 p-4 text-white">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-limeglow-400">
                        Aperçu en-tête vitrine & affiche QR
                      </p>
                      <div className="mt-3 flex items-center gap-3">
                        {shopForm.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={shopForm.logoUrl}
                            alt={shopForm.name}
                            className="h-14 w-14 rounded-2xl bg-white object-contain p-1.5"
                          />
                        ) : (
                          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-lg font-black text-limeglow-400">
                            {(shopForm.name || 'SC').slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-base font-extrabold text-white">
                            {shopForm.name || 'Ma Boutique'}
                          </p>
                          <p className="truncate text-xs text-emerald-200/80">
                            {shopForm.slogan || 'Votre boutique connectée ShopControl'}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-emerald-200/60">
                            {[shopForm.address, shopForm.phone].filter(Boolean).join(' · ') ||
                              'Adresse & téléphone à renseigner'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Configuration Tickets thermiques & PDF */}
                  <section className="sc-card space-y-3.5 p-4 sm:p-5">
                    <div className="flex items-center gap-2">
                      <Receipt className="h-5 w-5 text-brand-700" />
                      <h2 className="text-base font-extrabold text-slate-900">
                        Tickets de caisse & PDF
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Largeur imprimante
                        </label>
                        <select
                          value={shopForm.paperWidthMm}
                          onChange={(e) =>
                            setShopForm({ ...shopForm, paperWidthMm: Number(e.target.value) as 58 | 80 })
                          }
                          className="sc-input mt-1"
                        >
                          <option value={80}>80 mm (Standard)</option>
                          <option value={58}>58 mm (Mobile / Bluetooth)</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-porcelain-50 px-3 py-2.5 text-xs font-semibold text-slate-700 sm:mt-5">
                        <input
                          type="checkbox"
                          checked={shopForm.showLogo}
                          onChange={(e) => setShopForm({ ...shopForm, showLogo: e.target.checked })}
                          className="h-4 w-4 rounded accent-brand-700"
                        />
                        Afficher le logo
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Texte en-tête ticket
                      </label>
                      <input
                        value={shopForm.headerText}
                        onChange={(e) => setShopForm({ ...shopForm, headerText: e.target.value })}
                        placeholder="Ex. NIF / RCCM ou message de bienvenue"
                        className="sc-input mt-1"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Message pied de ticket
                      </label>
                      <input
                        value={shopForm.footerText}
                        onChange={(e) => setShopForm({ ...shopForm, footerText: e.target.value })}
                        className="sc-input mt-1"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Mention commerciale / légale
                      </label>
                      <input
                        value={shopForm.legalNotice}
                        onChange={(e) => setShopForm({ ...shopForm, legalNotice: e.target.value })}
                        className="sc-input mt-1"
                      />
                    </div>
                  </section>
                </div>

                {/* Colonne droite : Informations boutique + Vitrine & Livraison */}
                <div className="space-y-5 lg:col-span-7">
                  <section className="sc-card space-y-4 p-4 sm:p-5">
                    <h2 className="text-base font-extrabold text-slate-900">
                      Informations générales de la boutique
                    </h2>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Nom de la boutique *
                        </label>
                        <input
                          required
                          value={shopForm.name}
                          onChange={(e) => setShopForm({ ...shopForm, name: e.target.value })}
                          className="sc-input mt-1"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Lien public (slug) *
                        </label>
                        <div className="mt-1 flex items-center rounded-xl border border-slate-200 bg-porcelain-50 px-3">
                          <span className="text-xs font-semibold text-slate-400">/s/</span>
                          <input
                            required
                            value={shopForm.slug}
                            onChange={(e) => setShopForm({ ...shopForm, slug: e.target.value })}
                            className="w-full bg-transparent py-2.5 pl-1 font-mono text-sm text-slate-900 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Slogan / Description courte (affiché en haut de votre vitrine)
                      </label>
                      <input
                        value={shopForm.slogan}
                        onChange={(e) => setShopForm({ ...shopForm, slogan: e.target.value })}
                        placeholder="Ex. Mode & Prêt-à-porter haut de gamme à Bamako"
                        className="sc-input mt-1"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Téléphone</label>
                        <input
                          value={shopForm.phone}
                          onChange={(e) => setShopForm({ ...shopForm, phone: e.target.value })}
                          placeholder="+223 70 00 00 00"
                          className="sc-input mt-1"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          WhatsApp boutique
                        </label>
                        <input
                          value={shopForm.whatsappNumber}
                          onChange={(e) => setShopForm({ ...shopForm, whatsappNumber: e.target.value })}
                          placeholder="+223 70 00 00 00"
                          className="sc-input mt-1"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">E-mail</label>
                        <input
                          type="email"
                          value={shopForm.email}
                          onChange={(e) => setShopForm({ ...shopForm, email: e.target.value })}
                          className="sc-input mt-1"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Adresse physique / Quartier
                      </label>
                      <input
                        value={shopForm.address}
                        onChange={(e) => setShopForm({ ...shopForm, address: e.target.value })}
                        placeholder="Ex. Hamdallaye ACI 2000, Rue 312, Bamako"
                        className="sc-input mt-1"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">Mode fiscal / TVA</label>
                        <select
                          value={shopForm.taxMode}
                          onChange={(e) => setShopForm({ ...shopForm, taxMode: e.target.value as TaxMode })}
                          className="sc-input mt-1"
                        >
                          {TAX_MODES.map((m) => (
                            <option key={m} value={m}>
                              {m === 'NONE'
                                ? 'Sans taxe (exonéré / forfait)'
                                : m === 'TTC'
                                  ? 'Prix TTC (taxe incluse)'
                                  : 'Prix HT (taxe ajoutée)'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Taux TVA (%)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min={0}
                          max={50}
                          disabled={shopForm.taxMode === 'NONE'}
                          value={shopForm.taxRatePercent}
                          onChange={(e) =>
                            setShopForm({ ...shopForm, taxRatePercent: Number(e.target.value) })
                          }
                          className="sc-input mt-1 tabular disabled:bg-slate-100"
                        />
                      </div>
                    </div>
                  </section>

                  {/* Paramètres Vitrine QR & Livraison */}
                  <section className="sc-card space-y-4 p-4 sm:p-5">
                    <div className="flex items-center gap-2">
                      <Truck className="h-5 w-5 text-brand-700" />
                      <h2 className="text-base font-extrabold text-slate-900">
                        Vitrine QR, Livraison & Protection Anti-abus
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-porcelain-50 p-3 text-xs font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={shopForm.pickupEnabled}
                          onChange={(e) =>
                            setShopForm({ ...shopForm, pickupEnabled: e.target.checked })
                          }
                          className="h-4 w-4 accent-brand-700"
                        />
                        Autoriser le retrait en boutique
                      </label>
                      <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-porcelain-50 p-3 text-xs font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={shopForm.deliveryEnabled}
                          onChange={(e) =>
                            setShopForm({ ...shopForm, deliveryEnabled: e.target.checked })
                          }
                          className="h-4 w-4 accent-brand-700"
                        />
                        Proposer la livraison client
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Frais livraison (XOF)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={shopForm.defaultDeliveryFeeXof}
                          onChange={(e) =>
                            setShopForm({
                              ...shopForm,
                              defaultDeliveryFeeXof: Number(e.target.value),
                            })
                          }
                          className="sc-input mt-1 tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Qté max / commande
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={shopForm.maxOrderQty}
                          onChange={(e) =>
                            setShopForm({ ...shopForm, maxOrderQty: Number(e.target.value) })
                          }
                          className="sc-input mt-1 tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          Plafond commande (XOF)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={shopForm.maxOrderAmountXof}
                          onChange={(e) =>
                            setShopForm({
                              ...shopForm,
                              maxOrderAmountXof: Number(e.target.value),
                            })
                          }
                          className="sc-input mt-1 tabular"
                        />
                      </div>
                    </div>

                    {/* Tarifs par Quartier / Zone de livraison */}
                    {shopForm.deliveryEnabled ? (
                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 sm:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-800">
                              <MapPin className="h-4 w-4 text-emerald-700" />
                              Tarifs de livraison par Quartier / Commune
                            </h4>
                            <p className="mt-0.5 text-xs text-slate-500">
                              Définissez les frais de livraison pour chaque emplacement. Si un client renseigne un autre quartier, le montant par défaut ({formatXof(shopForm.defaultDeliveryFeeXof)}) sera appliqué.
                            </p>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                            {shopForm.deliveryZones.length} quartier{shopForm.deliveryZones.length > 1 ? 's' : ''} configuré{shopForm.deliveryZones.length > 1 ? 's' : ''}
                          </span>
                        </div>

                        {/* Suggestions rapides en 1 clic : Quartiers de Bamako */}
                        <div>
                          <p className="mb-1.5 text-[11px] font-semibold text-slate-600">Ajout rapide de quartiers de Bamako :</p>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { name: 'ACI 2000', fee: 1000 },
                              { name: 'Hamdallaye', fee: 1000 },
                              { name: 'Badalabougou', fee: 1000 },
                              { name: 'Hippodrome', fee: 1000 },
                              { name: 'Korofina', fee: 1500 },
                              { name: 'Baco-Djicoroni', fee: 1500 },
                              { name: 'Torokorobougou', fee: 1000 },
                              { name: 'Daoudabougou', fee: 1500 },
                              { name: 'Faladié', fee: 1500 },
                              { name: 'Yirimadio', fee: 2000 },
                              { name: 'Sotuba', fee: 2000 },
                              { name: 'Magnambougou', fee: 1500 },
                              { name: 'Kalaban Coura', fee: 2000 },
                              { name: 'Sébénikoro', fee: 2000 },
                              { name: 'Lafiabougou', fee: 1500 },
                              { name: 'Djélibougou', fee: 1500 },
                              { name: 'Niaréla', fee: 1000 },
                              { name: 'Medina Coura', fee: 1000 },
                              { name: 'Missira', fee: 1000 },
                              { name: 'Banankabougou', fee: 2000 },
                            ].map((preset) => {
                              const already = shopForm.deliveryZones.some(
                                (z) => z.name.toLowerCase() === preset.name.toLowerCase(),
                              );
                              return (
                                <button
                                  key={preset.name}
                                  type="button"
                                  disabled={already}
                                  onClick={() => quickAddPresetZone(preset.name, preset.fee)}
                                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                    already
                                      ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                                      : 'border border-slate-300 bg-white text-slate-700 hover:border-emerald-600 hover:text-emerald-800'
                                  }`}
                                >
                                  + {preset.name} ({formatXof(preset.fee)})
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Formulaire ajout personnalisé */}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                          <div className="sm:col-span-6">
                            <input
                              type="text"
                              placeholder="Nom du quartier (ex: ACI 2000, Badalabougou, Hamdallaye...)"
                              value={newZoneName}
                              onChange={(e) => setNewZoneName(e.target.value)}
                              className="sc-input text-xs"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <input
                              type="number"
                              min={0}
                              step={100}
                              placeholder="Tarif livraison (XOF)"
                              value={newZoneFee}
                              onChange={(e) => setNewZoneFee(e.target.value === '' ? '' : Number(e.target.value))}
                              className="sc-input text-xs tabular"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <button
                              type="button"
                              onClick={addDeliveryZone}
                              disabled={!newZoneName.trim() || newZoneFee === ''}
                              className="sc-btn-primary w-full py-2.5 text-xs disabled:opacity-40"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Ajouter
                            </button>
                          </div>
                        </div>

                        {/* Liste des quartiers */}
                        {shopForm.deliveryZones.length > 0 ? (
                          <div className="max-h-60 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                            {shopForm.deliveryZones.map((zone, idx) => (
                              <div
                                key={`${zone.name}_${idx}`}
                                className="flex items-center justify-between p-2.5 text-xs"
                              >
                                <div className="flex items-center gap-2">
                                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                                  <span className="font-bold text-slate-900">{zone.name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-extrabold text-emerald-800">
                                    {formatXof(zone.feeXof)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeDeliveryZone(idx)}
                                    className="rounded-lg p-1 text-rose-500 hover:bg-rose-50"
                                    title="Supprimer ce quartier"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                            Aucun quartier spécifique configuré. Le tarif standard de {formatXof(shopForm.defaultDeliveryFeeXof)} s’appliquera pour toutes les livraisons.
                          </p>
                        )}
                      </div>
                    ) : null}

                    <div className="flex justify-end pt-2">
                      {!supportGrantId ? (
                        <button type="submit" disabled={busy} className="sc-btn-primary w-full px-6 sm:w-auto">
                          <Save className="h-4 w-4" />
                          {busy ? 'Enregistrement…' : 'Enregistrer le logo & les infos boutique'}
                        </button>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
            </form>
          )
        ) : tab === 'company' && profile ? (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Fiche Entreprise */}
            <form onSubmit={handleSaveCompany} className="sc-card space-y-4 p-4 sm:p-6 lg:col-span-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold text-slate-900">Fiche entreprise</h2>
                <StatusBadge status={profile.status} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Nom commercial</label>
                <input
                  required
                  disabled={Boolean(supportGrantId)}
                  value={companyForm.name}
                  onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                  className="sc-input mt-1 disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Raison sociale</label>
                <input
                  disabled={Boolean(supportGrantId)}
                  value={companyForm.legalName}
                  onChange={(e) => setCompanyForm({ ...companyForm, legalName: e.target.value })}
                  className="sc-input mt-1 disabled:bg-slate-50"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Téléphone</label>
                  <input
                    required
                    disabled={Boolean(supportGrantId)}
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                    className="sc-input mt-1 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">E-mail</label>
                  <input
                    type="email"
                    required
                    disabled={Boolean(supportGrantId)}
                    value={companyForm.email}
                    onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                    className="sc-input mt-1 disabled:bg-slate-50"
                  />
                </div>
              </div>
              {!supportGrantId ? (
                <button type="submit" disabled={busy} className="sc-btn-primary w-full sm:w-auto">
                  <Save className="h-4 w-4" />
                  Enregistrer l’entreprise
                </button>
              ) : null}
            </form>

            {/* Abonnement SaaS & Support Plateforme */}
            <div className="space-y-6 lg:col-span-7">
              {subData ? (
                <section className="sc-card space-y-4 p-4 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Crown className="h-5 w-5 text-amber-500" />
                      <h2 className="text-base font-extrabold text-slate-900">
                        Mon abonnement ShopControl
                      </h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {subData.subscription.trialEndsAt &&
                      new Date(subData.subscription.trialEndsAt).getTime() > Date.now() ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800">
                          Essai gratuit jusqu’au{' '}
                          {new Date(subData.subscription.trialEndsAt).toLocaleDateString('fr-FR')}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-forest-900 px-3 py-1 text-xs font-bold text-limeglow-400">
                        {SUBSCRIPTION_PLAN_LABELS[subData.subscription.planCode]}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-porcelain-50 p-3">
                      <p className="text-[11px] text-slate-500">
                        Tarif (
                        {
                          SUBSCRIPTION_BILLING_CYCLE_LABELS[
                            subData.subscription.billingCycle || 'MONTHLY'
                          ]
                        }
                        )
                      </p>
                      <p className="text-base font-extrabold text-slate-900 tabular">
                        {formatXof(
                          subData.subscription.priceXof ?? subData.subscription.monthlyPriceXof,
                        )}{' '}
                        <span className="text-[11px] font-semibold text-slate-500">
                          {
                            SUBSCRIPTION_BILLING_CYCLE_SUFFIX[
                              subData.subscription.billingCycle || 'MONTHLY'
                            ]
                          }
                        </span>
                      </p>
                    </div>
                    <div className="rounded-2xl bg-porcelain-50 p-3">
                      <p className="text-[11px] text-slate-500">Quota boutiques</p>
                      <p className="text-base font-extrabold text-slate-900 tabular">
                        {shops.length} / {subData.subscription.maxShops}
                      </p>
                    </div>
                    <div className="col-span-2 rounded-2xl bg-porcelain-50 p-3 sm:col-span-1">
                      <p className="text-[11px] text-slate-500">Agents / boutique</p>
                      <p className="text-base font-extrabold text-slate-900 tabular">
                        max {subData.subscription.maxAgentsPerShop}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {subData.subscription.enabledModules.map((mod) => (
                      <span
                        key={mod}
                        className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800"
                      >
                        ✓ {PLATFORM_MODULE_LABELS[mod] || mod}
                      </span>
                    ))}
                  </div>

                  {subData.payments.length > 0 ? (
                    <div className="border-t border-slate-100 pt-3">
                      <p className="mb-2 text-xs font-bold text-slate-700">
                        Derniers paiements plateforme
                      </p>
                      <div className="space-y-1.5 text-xs">
                        {subData.payments.slice(0, 5).map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between rounded-xl bg-porcelain-50 px-3 py-2"
                          >
                            <span>
                              <strong>{p.periodLabel}</strong> · {p.paymentMethodCode}
                              {p.reference ? ` (${p.reference})` : ''}
                            </span>
                            <span className="font-bold text-emerald-700 tabular">
                              {formatXof(p.amountXof)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/* Tickets Support */}
              <section className="sc-card space-y-4 p-4 sm:p-6">
                <div className="flex items-center gap-2">
                  <LifeBuoy className="h-5 w-5 text-brand-700" />
                  <h2 className="text-base font-extrabold text-slate-900">
                    Support & Assistance Plateforme
                  </h2>
                </div>

                {!supportGrantId ? (
                  <form onSubmit={handleCreateTicket} className="space-y-2.5 rounded-2xl bg-porcelain-50 p-3.5 sm:p-4">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <MessageSquarePlus className="h-4 w-4 text-brand-600" />
                      Ouvrir un nouveau ticket d’assistance
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        required
                        minLength={4}
                        value={ticketForm.subject}
                        onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
                        placeholder="Objet de votre demande…"
                        className="sc-input sm:col-span-2"
                      />
                      <select
                        value={ticketForm.priority}
                        onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
                        className="sc-input"
                      >
                        <option value="INFO">Normal</option>
                        <option value="WARNING">Important</option>
                        <option value="URGENT">Urgent</option>
                      </select>
                    </div>
                    <textarea
                      required
                      minLength={5}
                      rows={2}
                      value={ticketForm.message}
                      onChange={(e) => setTicketForm({ ...ticketForm, message: e.target.value })}
                      placeholder="Décrivez votre question ou besoin…"
                      className="sc-input"
                    />
                    <button type="submit" disabled={busy} className="sc-btn-primary w-full sm:w-auto text-xs">
                      <Send className="h-3.5 w-3.5" />
                      Envoyer au support
                    </button>
                  </form>
                ) : null}

                <div className="space-y-3">
                  {tickets.length === 0 ? (
                    <p className="text-xs text-slate-400">Aucun ticket support ouvert.</p>
                  ) : (
                    tickets.map((t) => (
                      <div key={t.id} className="rounded-2xl border border-slate-200 p-3.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-slate-900">
                            <span className="font-mono text-brand-700">{t.ticketNumber}</span> ·{' '}
                            {t.subject}
                          </p>
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700">
                            {SUPPORT_TICKET_STATUS_LABELS[t.status] || t.status}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {t.messages.map((m) => (
                            <div
                              key={m.id}
                              className={`rounded-xl px-3 py-2 ${
                                m.senderRole === 'SUPER_ADMIN'
                                  ? 'bg-brand-50 text-brand-950'
                                  : 'bg-slate-50 text-slate-800'
                              }`}
                            >
                              <p className="font-bold text-[10px] opacity-75">{m.senderName}</p>
                              <p>{m.body}</p>
                            </div>
                          ))}
                        </div>
                        {t.status !== 'CLOSED' ? (
                          <div className="mt-2 flex flex-col sm:flex-row gap-2">
                            <input
                              value={replyByTicket[t.id] || ''}
                              onChange={(e) =>
                                setReplyByTicket((prev) => ({ ...prev, [t.id]: e.target.value }))
                              }
                              placeholder="Ajouter une réponse…"
                              className="sc-input py-1.5 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleReplyTicket(t.id)}
                              className="sc-btn-primary w-full sm:w-auto px-3 py-1.5 text-xs"
                            >
                              Répondre
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : profile ? (
          /* Tab Sécurité & Sessions */
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="sc-card p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-brand-700" />
                  <h2 className="text-base font-extrabold text-slate-900">
                    Double authentification (2FA)
                  </h2>
                </div>
                <span
                  className={`rounded-full px-3 py-0.5 text-xs font-bold ${
                    user?.totpEnabled
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {user?.totpEnabled ? 'Activé' : 'Inactif'}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Protégez votre compte Propriétaire avec un code TOTP à 6 chiffres (Google Authenticator / Authy).
              </p>
              {!user?.totpEnabled && !supportGrantId ? (
                <Link href="/setup-2fa" className="sc-btn-primary mt-4 inline-flex w-full sm:w-auto justify-center text-xs">
                  Activer le 2FA maintenant
                </Link>
              ) : null}

              <div className="mt-6 rounded-2xl border border-slate-200 bg-porcelain-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900">
                      <FileSearch className="h-4 w-4 text-brand-700" />
                      Journal d’audit & anti-fraude
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Consultez l’historique détaillé des actions, remises, annulations et modifications de stock.
                    </p>
                  </div>
                  <Link href="/owner/audit" className="sc-btn-ghost shrink-0 text-xs">
                    Consulter
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              <div className="mt-6 border-t border-slate-100 pt-5">
                <h3 className="text-sm font-extrabold text-slate-900">
                  Transparence des accès d’assistance plateforme
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Chaque intervention exceptionnelle d’un Super Admin est journalisée ici.
                </p>
                {profile.supportAccessHistory.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-400">Aucun accès d’assistance enregistré.</p>
                ) : (
                  <div className="mt-3 space-y-2 text-xs">
                    {profile.supportAccessHistory.map((g) => (
                      <div key={g.id} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-bold text-slate-800">
                          {g.superAdminName} · {g.readOnly ? 'Lecture seule' : 'Étendu'}
                        </p>
                        <p className="text-slate-600">{g.reason}</p>
                        <p className="text-[11px] text-slate-400">
                          Ouvert : {formatDateTimeInTimezone(g.createdAt)} · Expire :{' '}
                          {formatDateTimeInTimezone(g.expiresAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="sc-card p-4 sm:p-6">
              <div className="mb-3 flex items-center gap-2">
                <Laptop className="h-5 w-5 text-brand-700" />
                <h2 className="text-base font-extrabold text-slate-900">Mes sessions actives</h2>
              </div>
              <div className="space-y-2.5">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 break-words">
                        {s.deviceName}{' '}
                        {s.isCurrent ? (
                          <span className="ml-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            Actuelle
                          </span>
                        ) : null}
                      </p>
                      <p className="text-slate-500 mt-0.5">
                        IP : {s.ipAddress || '—'} · Actif : {formatDateTimeInTimezone(s.lastActiveAt)}
                      </p>
                    </div>
                    {!s.isCurrent ? (
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(s.id)}
                        className="rounded-xl bg-rose-50 px-3 py-1.5 font-bold text-rose-700 hover:bg-rose-100 self-start sm:self-center shrink-0"
                      >
                        Déconnecter
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>

      {qrOpen && currentShop ? (
        <ShopQrModal
          slug={shopForm.slug || currentShop.slug}
          shopName={shopForm.name || currentShop.name}
          logoUrl={shopForm.logoUrl}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
    </AppShell>
  );
}
