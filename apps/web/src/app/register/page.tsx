'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Layers,
  MapPin,
  Phone,
  Sparkles,
  Store,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  CATEGORY_SELLING_MODE_SPECS,
  formatXof,
  getSuggestedCategoriesForShopTypes,
  SHOP_TYPE_DESCRIPTIONS,
  SHOP_TYPE_LABELS,
  SHOP_TYPE_SHORT_LABELS,
  SHOP_TYPES,
  ShopType,
  SUBSCRIPTION_PAYMENT_METHOD_LABELS,
  SUBSCRIPTION_PAYMENT_METHODS,
  SubscriptionPaymentMethod,
  SubscriptionPlan,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { ImageUploader } from '@/components/ui/ImageUploader';

type ShopPaymentCode = 'CASH' | 'ORANGE_MONEY' | 'WAVE' | 'MOOV_MONEY' | 'CARD';

const SHOP_PAYMENT_OPTIONS: Array<{
  code: ShopPaymentCode;
  label: string;
  desc: string;
}> = [
  { code: 'CASH', label: 'Espèces (Cash)', desc: 'Encaissement direct en tiroir-caisse' },
  { code: 'ORANGE_MONEY', label: 'Orange Money', desc: 'Paiement mobile avec référence SMS' },
  { code: 'WAVE', label: 'Wave', desc: 'Transfert mobile instantané' },
  { code: 'MOOV_MONEY', label: 'Moov Money', desc: 'Paiement mobile Moov Africa' },
  { code: 'CARD', label: 'Carte bancaire / Virement', desc: 'TPE ou virement bancaire' },
];

const PLAN_CARDS: Array<{
  code: SubscriptionPlan;
  title: string;
  priceXof: number;
  badge?: string;
  features: string[];
}> = [
  {
    code: 'STARTER',
    title: 'Starter',
    priceXof: 15000,
    features: ['1 boutique dédiée', 'Jusqu’à 3 comptes agents', 'Caisse POS, Stocks & Vitrine QR'],
  },
  {
    code: 'PRO',
    title: 'Pro Multi-Boutiques',
    priceXof: 25000,
    badge: 'Recommandé',
    features: [
      'Jusqu’à 5 boutiques',
      'Jusqu’à 10 agents / boutique',
      'Transferts inter-boutiques & Bilans consolidés',
    ],
  },
  {
    code: 'ENTERPRISE',
    title: 'Entreprise',
    priceXof: 50000,
    features: [
      'Jusqu’à 20 boutiques',
      'Jusqu’à 50 agents / boutique',
      'Tous les modules + Support prioritaire',
    ],
  },
];

export default function RegisterMerchantPage() {
  const router = useRouter();
  const { refreshMe } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    // Étape 1 : Boutique, Type & Logo
    shopName: '',
    slogan: '',
    shopType: 'GROCERY' as ShopType,
    logoUrl: null as string | null,
    shopPhone: '',
    shopAddress: '',
    currency: 'XOF',
    // Étape 2 : Modes de paiement & Formule
    shopPaymentMethodCodes: ['CASH', 'ORANGE_MONEY', 'WAVE'] as ShopPaymentCode[],
    planCode: 'PRO' as SubscriptionPlan,
    subscriptionPaymentMethod: 'ORANGE_MONEY' as SubscriptionPaymentMethod,
    subscriptionPaymentReference: '',
    // Étape 3 : Compte Propriétaire
    ownerFullName: '',
    ownerEmail: '',
    ownerPassword: '',
    confirmPassword: '',
  });

  const suggestedCategories = getSuggestedCategoriesForShopTypes(form.shopType);
  const selectedPlan = PLAN_CARDS.find((p) => p.code === form.planCode) || PLAN_CARDS[1];

  const toggleShopPaymentMethod = (code: ShopPaymentCode) => {
    setForm((prev) => {
      const exists = prev.shopPaymentMethodCodes.includes(code);
      if (exists && prev.shopPaymentMethodCodes.length === 1) {
        return prev; // Garder au moins 1 mode d'encaissement
      }
      return {
        ...prev,
        shopPaymentMethodCodes: exists
          ? prev.shopPaymentMethodCodes.filter((c) => c !== code)
          : [...prev.shopPaymentMethodCodes, code],
      };
    });
  };

  const scrollToTop = () => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.shopName.trim().length < 2) {
      setError('Veuillez saisir le nom commercial de votre boutique.');
      return;
    }
    if (form.shopPhone.trim().length < 6) {
      setError('Veuillez saisir le numéro de téléphone / WhatsApp de la boutique.');
      return;
    }
    setStep(2);
    scrollToTop();
  };

  const handleNextStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.shopPaymentMethodCodes.length === 0) {
      setError('Sélectionnez au moins un mode de paiement pour votre boutique.');
      return;
    }
    setStep(3);
    scrollToTop();
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.ownerFullName.trim().length < 2) {
      setError('Veuillez renseigner votre nom complet.');
      return;
    }
    if (form.ownerPassword !== form.confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (
      form.ownerPassword.length < 8 ||
      !/[A-Z]/.test(form.ownerPassword) ||
      !/[a-z]/.test(form.ownerPassword) ||
      !/[0-9]/.test(form.ownerPassword)
    ) {
      setError(
        'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre.',
      );
      return;
    }

    setBusy(true);
    try {
      await apiFetch('/auth/register-merchant', {
        method: 'POST',
        body: {
          ownerFullName: form.ownerFullName.trim(),
          ownerEmail: form.ownerEmail.trim().toLowerCase(),
          ownerPhone: form.shopPhone.trim(),
          ownerPassword: form.ownerPassword,
          merchantName: form.shopName.trim(),
          shopName: form.shopName.trim(),
          shopType: form.shopType,
          enabledShopTypes: [form.shopType],
          logoUrl: form.logoUrl,
          slogan: form.slogan.trim() || undefined,
          shopAddress: form.shopAddress.trim() || undefined,
          shopPhone: form.shopPhone.trim(),
          currency: form.currency,
          shopPaymentMethodCodes: form.shopPaymentMethodCodes,
          planCode: form.planCode,
          subscriptionPaymentMethod: form.subscriptionPaymentMethod,
          subscriptionPaymentReference:
            form.subscriptionPaymentReference.trim() || undefined,
          deviceName: typeof navigator !== 'undefined' ? navigator.platform : 'Navigateur',
        },
        skipRefresh: true,
      });

      await refreshMe();
      router.replace('/owner');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Impossible de finaliser l’inscription. Vérifiez vos informations.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#f4f8f7] lg:grid lg:grid-cols-12 lg:bg-white">
      {/* En-tête compact sur Mobile (< lg) + Panneau complet sur Desktop (lg:col-span-5) */}
      <div className="obsidian-hero flex flex-col justify-between px-4 py-4 text-white sm:px-8 sm:py-6 lg:col-span-5 lg:min-h-screen lg:px-10 lg:py-10">
        <div className="space-y-4 lg:space-y-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-forest-700 text-sm font-black text-white shadow-sm ring-1 ring-white/20 sm:h-11 sm:w-11">
                SC
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-extrabold tracking-tight sm:text-lg">
                  ShopControl
                </p>
                <p className="truncate text-[11px] text-emerald-200/75 sm:text-xs">
                  Ouverture de compte boutiquier
                </p>
              </div>
            </div>
            <Link
              href="/login"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/20"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Connexion</span>
            </Link>
          </div>

          {/* Bandeau résumé compact sur Mobile (< lg) */}
          <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-forest-950/85 p-3 lg:hidden">
            {form.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.logoUrl}
                alt={form.shopName || 'Logo'}
                className="h-11 w-11 shrink-0 rounded-xl bg-white object-contain p-1"
              />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sm font-black text-limeglow-400">
                {(form.shopName || 'MB').slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-extrabold text-white">
                  {form.shopName || 'Nouvelle boutique'}
                </p>
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-limeglow-400">
                  {SHOP_TYPE_SHORT_LABELS[form.shopType]}
                </span>
              </div>
              <p className="truncate text-[11px] text-emerald-200/80">
                Formule {selectedPlan.title} · {formatXof(selectedPlan.priceXof)}/mois
              </p>
            </div>
          </div>

          {/* Contenu détaillé réservé au Desktop (lg+) pour ne jamais pousser le formulaire vers le bas sur mobile */}
          <div className="hidden lg:block">
            <h1 className="text-2xl font-extrabold leading-snug text-white xl:text-3xl">
              Créez votre boutique sur mesure en 3 étapes.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#9bb5b0]">
              Choisissez votre type de commerce, ajoutez votre logo et vos modes de paiement :
              vos catégories et votre vitrine QR sont générées automatiquement.
            </p>
          </div>

          {/* Carte Aperçu Temps Réel Desktop (lg+) */}
          <div className="hidden rounded-3xl border border-white/15 bg-forest-950/90 p-5 shadow-xl lg:block">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-limeglow-400">
                Aperçu en direct de votre boutique
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-200">
                {SHOP_TYPE_SHORT_LABELS[form.shopType]}
              </span>
            </div>

            <div className="mt-3.5 flex items-center gap-3.5">
              {form.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.logoUrl}
                  alt={form.shopName || 'Logo'}
                  className="h-16 w-16 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-sm"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-xl font-black text-limeglow-400 ring-1 ring-white/15">
                  {(form.shopName || 'MB').slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-extrabold text-white">
                  {form.shopName || 'Nom de votre boutique'}
                </p>
                <p className="truncate text-xs text-emerald-200/85">
                  {form.slogan || SHOP_TYPE_DESCRIPTIONS[form.shopType]}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-emerald-200/70">
                  {form.shopAddress ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0 text-limeglow-400" />
                      <span className="truncate">{form.shopAddress}</span>
                    </span>
                  ) : null}
                  {form.shopPhone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3 shrink-0 text-limeglow-400" />
                      <span>{form.shopPhone}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/70">
                Paiements acceptés en caisse & vitrine :
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {form.shopPaymentMethodCodes.map((code) => {
                  const found = SHOP_PAYMENT_OPTIONS.find((o) => o.code === code);
                  return (
                    <span
                      key={code}
                      className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold text-white"
                    >
                      {found?.label || code}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="mt-3.5 border-t border-white/10 pt-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-limeglow-400">
                <Sparkles className="h-3 w-3 shrink-0" />
                <span>Catégories pré-configurées ({SHOP_TYPE_SHORT_LABELS[form.shopType]}) :</span>
              </p>
              <div className="mt-2 space-y-1.5">
                {suggestedCategories.map((cat) => (
                  <div
                    key={cat.name}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-white/5 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="truncate font-semibold text-white">{cat.name}</span>
                    <span className="shrink-0 rounded-full bg-limeglow-400/15 px-2 py-0.5 text-[9px] font-bold text-limeglow-300">
                      {CATEGORY_SELLING_MODE_SPECS[cat.sellingMode].shortLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-6 hidden text-xs text-emerald-200/60 lg:block">
          Propulsé par{' '}
          <sub className="bottom-[-0.18em] text-[11px] font-semibold tracking-wide text-emerald-200/80">
            Chakir’s Entreprise
          </sub>
        </p>
      </div>

      {/* Panneau droit : Formulaire en 3 étapes 100% responsive mobile/tablette/desktop */}
      <div className="flex flex-1 flex-col justify-start px-3 py-4 sm:px-6 sm:py-8 lg:col-span-7 lg:justify-center lg:bg-white lg:px-10">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:rounded-3xl sm:p-7 lg:border-0 lg:p-0 lg:shadow-none">
          {/* Barre de progression 3 étapes adaptée aux petits écrans mobiles */}
          <div className="mb-5 grid grid-cols-3 gap-1.5 sm:mb-6 sm:gap-2">
            {(
              [
                {
                  num: 1,
                  shortTitle: '1. Boutique',
                  fullTitle: '1. Boutique & Logo',
                  icon: Store,
                },
                {
                  num: 2,
                  shortTitle: '2. Paiements',
                  fullTitle: '2. Paiements & Formule',
                  icon: Wallet,
                },
                {
                  num: 3,
                  shortTitle: '3. Compte',
                  fullTitle: '3. Compte Propriétaire',
                  icon: UserCheck,
                },
              ] as const
            ).map((s) => {
              const Icon = s.icon;
              const active = step === s.num;
              const done = step > s.num;
              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => {
                    if (s.num < step) {
                      setStep(s.num);
                      scrollToTop();
                    }
                  }}
                  className={`flex min-w-0 items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-extrabold transition sm:gap-1.5 sm:rounded-2xl sm:px-3 sm:py-2.5 sm:text-xs ${
                    active
                      ? 'border-forest-900 bg-forest-900 text-white shadow-xs'
                      : done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 bg-porcelain-50 text-slate-500'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate sm:hidden">{s.shortTitle}</span>
                  <span className="hidden truncate sm:inline">{s.fullTitle}</span>
                </button>
              );
            })}
          </div>

          {error ? (
            <div
              role="alert"
              className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-semibold text-rose-800"
            >
              {error}
            </div>
          ) : null}

          {/* ÉTAPE 1 : MA BOUTIQUE, MON TYPE DE COMMERCE & MON LOGO */}
          {step === 1 ? (
            <form onSubmit={handleNextStep1} className="space-y-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 sm:text-xl">
                  Étape 1 — Votre boutique, son logo et son type
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Personnalisez votre caisse, vos catégories de produits et votre vitrine QR.
                </p>
              </div>

              <ImageUploader
                purpose="logo"
                aspect="wide"
                label="Logo de votre boutique (optionnel)"
                hint="Affiché sur votre vitrine QR et vos tickets de caisse."
                value={form.logoUrl}
                onChange={(url) => setForm((f) => ({ ...f, logoUrl: url }))}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Nom commercial de la boutique *
                  </label>
                  <input
                    required
                    value={form.shopName}
                    onChange={(e) => setForm({ ...form, shopName: e.target.value })}
                    placeholder="Ex. Boutique Kadi Cosmétiques"
                    className="sc-input mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Téléphone / WhatsApp de la boutique *
                  </label>
                  <input
                    required
                    type="tel"
                    value={form.shopPhone}
                    onChange={(e) => setForm({ ...form, shopPhone: e.target.value })}
                    placeholder="Ex. +223 70 00 00 00"
                    className="sc-input mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Adresse / Quartier & Ville
                  </label>
                  <input
                    value={form.shopAddress}
                    onChange={(e) => setForm({ ...form, shopAddress: e.target.value })}
                    placeholder="Ex. Hamdallaye ACI 2000, Bamako"
                    className="sc-input mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Slogan de la boutique (optionnel)
                  </label>
                  <input
                    value={form.slogan}
                    onChange={(e) => setForm({ ...form, slogan: e.target.value })}
                    placeholder="Ex. La qualité au meilleur prix"
                    className="sc-input mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                  <Layers className="h-4 w-4 shrink-0 text-brand-700" />
                  <span>Choisissez le type de votre boutique *</span>
                </label>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Adapte automatiquement vos catégories et la manière de vendre vos produits.
                </p>
                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SHOP_TYPES.map((t) => {
                    const active = form.shopType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm({ ...form, shopType: t })}
                        className={`rounded-2xl border p-3 text-left transition ${
                          active
                            ? 'border-forest-900 bg-forest-900 text-white shadow-sm'
                            : 'border-slate-200 bg-porcelain-50 text-slate-800 hover:border-brand-400 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-extrabold">{SHOP_TYPE_LABELS[t]}</p>
                          {active ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-limeglow-400" />
                          ) : null}
                        </div>
                        <p
                          className={`mt-1 line-clamp-2 text-[11px] leading-snug ${
                            active ? 'text-emerald-100/85' : 'text-slate-500'
                          }`}
                        >
                          {SHOP_TYPE_DESCRIPTIONS[t]}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Aperçu compact des catégories générées sur Mobile (< lg) */}
              <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-3 lg:hidden">
                <p className="flex items-center gap-1.5 text-[11px] font-extrabold text-forest-900">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-700" />
                  <span>
                    Catégories pré-créées pour {SHOP_TYPE_SHORT_LABELS[form.shopType]} :
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {suggestedCategories.map((cat) => (
                    <span
                      key={cat.name}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-800"
                    >
                      <span>{cat.name}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-forest-900 px-6 py-3.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-forest-800 sm:ml-auto sm:w-auto"
                >
                  <span>Continuer vers les modes de paiement</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>
              </div>
            </form>
          ) : null}

          {/* ÉTAPE 2 : MODES DE PAIEMENT & FORMULE D'ABONNEMENT */}
          {step === 2 ? (
            <form onSubmit={handleNextStep2} className="space-y-5">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 sm:text-xl">
                  Étape 2 — Modes de paiement & Formule
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Choisissez les moyens de paiement acceptés dans votre boutique et votre formule.
                </p>
              </div>

              {/* 1. Modes d'encaissement clients en boutique */}
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                  <Wallet className="h-4 w-4 shrink-0 text-brand-700" />
                  <span>Modes de paiement acceptés pour vos clients (Caisse & Vitrine) *</span>
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SHOP_PAYMENT_OPTIONS.map((opt) => {
                    const checked = form.shopPaymentMethodCodes.includes(opt.code);
                    return (
                      <button
                        key={opt.code}
                        type="button"
                        onClick={() => toggleShopPaymentMethod(opt.code)}
                        className={`flex items-start gap-2.5 rounded-2xl border p-3 text-left transition ${
                          checked
                            ? 'border-forest-900 bg-forest-900 text-white shadow-xs'
                            : 'border-slate-200 bg-porcelain-50 text-slate-800 hover:border-brand-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={checked}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded accent-limeglow-400"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold">{opt.label}</p>
                          <p
                            className={`text-[10px] ${
                              checked ? 'text-emerald-100/80' : 'text-slate-500'
                            }`}
                          >
                            {opt.desc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Formule d'abonnement */}
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                  <Sparkles className="h-4 w-4 shrink-0 text-brand-700" />
                  <span>Choisissez votre formule ShopControl *</span>
                </label>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {PLAN_CARDS.map((p) => {
                    const active = form.planCode === p.code;
                    return (
                      <button
                        key={p.code}
                        type="button"
                        onClick={() => setForm({ ...form, planCode: p.code })}
                        className={`relative flex flex-col justify-between rounded-2xl border p-3.5 text-left transition ${
                          active
                            ? 'border-forest-900 bg-forest-900 text-white shadow-md'
                            : 'border-slate-200 bg-porcelain-50 text-slate-800 hover:border-brand-400'
                        }`}
                      >
                        {p.badge ? (
                          <span className="mb-1.5 inline-block w-fit rounded-full bg-limeglow-400 px-2 py-0.5 text-[9px] font-black uppercase text-forest-950">
                            {p.badge}
                          </span>
                        ) : null}
                        <div>
                          <p className="text-xs font-extrabold">{p.title}</p>
                          <p
                            className={`mt-1 text-base font-black tabular ${
                              active ? 'text-limeglow-400' : 'text-slate-900'
                            }`}
                          >
                            {formatXof(p.priceXof)}
                            <span className="text-[10px] font-normal opacity-80"> / mois</span>
                          </p>
                          <ul
                            className={`mt-2 space-y-1 text-[10px] ${
                              active ? 'text-emerald-100/90' : 'text-slate-600'
                            }`}
                          >
                            {p.features.map((f) => (
                              <li key={f}>• {f}</li>
                            ))}
                          </ul>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Mode de règlement de l'abonnement */}
              <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5 sm:p-4">
                <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                  <CreditCard className="h-4 w-4 shrink-0 text-brand-700" />
                  <span>
                    Mode de règlement de l’abonnement ({formatXof(selectedPlan.priceXof)}) *
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {SUBSCRIPTION_PAYMENT_METHODS.map((m) => {
                    const active = form.subscriptionPaymentMethod === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm({ ...form, subscriptionPaymentMethod: m })}
                        className={`rounded-xl border px-3 py-2 text-center text-xs font-bold transition ${
                          active
                            ? 'border-forest-900 bg-forest-900 text-limeglow-400 shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400'
                        }`}
                      >
                        {SUBSCRIPTION_PAYMENT_METHOD_LABELS[m]}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">
                    Référence de transaction ou numéro Mobile Money utilisé (optionnel)
                  </label>
                  <input
                    value={form.subscriptionPaymentReference}
                    onChange={(e) =>
                      setForm({ ...form, subscriptionPaymentReference: e.target.value })
                    }
                    placeholder="Ex. Réf SMS Orange Money / Wave ou numéro déposant…"
                    className="sc-input mt-1 bg-white py-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2.5 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    scrollToTop();
                  }}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-slate-300 px-5 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Retour</span>
                </button>
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-forest-900 px-6 py-3.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-forest-800 sm:w-auto"
                >
                  <span>Continuer vers mes identifiants</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>
              </div>
            </form>
          ) : null}

          {/* ÉTAPE 3 : IDENTIFIANTS PROPRIÉTAIRE & VALIDATION */}
          {step === 3 ? (
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 sm:text-xl">
                  Étape 3 — Vos identifiants Propriétaire
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Créez votre compte propriétaire pour accéder immédiatement à votre boutique.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Votre nom complet *
                  </label>
                  <input
                    required
                    value={form.ownerFullName}
                    onChange={(e) => setForm({ ...form, ownerFullName: e.target.value })}
                    placeholder="Ex. Moussa Coulibaly"
                    className="sc-input mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Votre adresse e-mail de connexion *
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={form.ownerEmail}
                    onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                    placeholder="Ex. moussa@maboutique.com"
                    className="sc-input mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Mot de passe *
                  </label>
                  <div className="relative mt-1">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={form.ownerPassword}
                      onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                      placeholder="Min. 8 caractères (Maj, min, chiffre)"
                      className="sc-input pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Confirmer le mot de passe *
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={form.confirmPassword}
                    onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                    placeholder="Répétez le mot de passe"
                    className="sc-input mt-1"
                  />
                </div>
              </div>

              {/* Récapitulatif avant création */}
              <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs sm:p-4">
                <p className="font-extrabold text-emerald-950">
                  Récapitulatif de votre inscription :
                </p>
                <div className="grid grid-cols-1 gap-1.5 text-slate-700 sm:grid-cols-2">
                  <p className="truncate">
                    • Boutique : <strong>{form.shopName}</strong>
                  </p>
                  <p className="truncate">
                    • Type : <strong>{SHOP_TYPE_SHORT_LABELS[form.shopType]}</strong>
                  </p>
                  <p className="truncate">
                    • Formule :{' '}
                    <strong>
                      {selectedPlan.title} ({formatXof(selectedPlan.priceXof)}/mois)
                    </strong>
                  </p>
                  <p className="truncate">
                    • Règlement :{' '}
                    <strong>
                      {SUBSCRIPTION_PAYMENT_METHOD_LABELS[form.subscriptionPaymentMethod]}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2.5 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setStep(2);
                    scrollToTop();
                  }}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-slate-300 px-5 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Retour</span>
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-forest-900 px-6 py-3.5 text-xs font-extrabold text-limeglow-400 shadow-md transition hover:bg-forest-800 disabled:opacity-60 sm:w-auto sm:text-sm"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    {busy
                      ? 'Création de votre boutique…'
                      : 'Créer mon compte et ouvrir ma boutique'}
                  </span>
                </button>
              </div>
            </form>
          ) : null}

          <p className="mt-6 text-center text-[11px] text-slate-400 lg:hidden">
            Propulsé par{' '}
            <sub className="bottom-[-0.18em] text-[10px] font-semibold tracking-wide text-slate-500">
              Chakir’s Entreprise
            </sub>
          </p>
        </div>
      </div>
    </div>
  );
}
