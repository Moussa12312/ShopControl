'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  Clock,
  CreditCard,
  Database,
  Gift,
  Layers,
  MessageCircle,
  QrCode,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Truck,
  Users,
} from 'lucide-react';
import {
  formatXof,
  SHOP_TYPE_DESCRIPTIONS,
  SHOP_TYPE_LABELS,
  SHOP_TYPES,
  SUBSCRIPTION_BILLING_CYCLE_LABELS,
  SUBSCRIPTION_BILLING_CYCLE_SUFFIX,
  SUBSCRIPTION_BILLING_CYCLES,
  SubscriptionBillingCycle,
  SubscriptionPlan,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';

interface PublicPlan {
  code: SubscriptionPlan;
  name: string;
  tagline: string;
  badge: string | null;
  monthlyPriceXof: number;
  yearlyPriceXof: number;
  directSalePriceXof: number;
  allowMonthly: boolean;
  allowYearly: boolean;
  allowDirectSale: boolean;
  trialDays: number;
  maxShops: number;
  maxAgentsPerShop: number;
  features: string[];
}

function getPriceForCycle(plan: PublicPlan, cycle: SubscriptionBillingCycle): number {
  if (cycle === 'YEARLY') return plan.yearlyPriceXof;
  if (cycle === 'DIRECT_SALE') return plan.directSalePriceXof;
  return plan.monthlyPriceXof;
}

const USE_CASES = [
  {
    icon: ShoppingCart,
    title: 'Encaisser vite sans erreurs au comptoir',
    desc: 'Vendez par pièce, kilogramme, litre, carton ou par montant (ex. 500 F de riz) avec calcul automatique du rendu monnaie.',
  },
  {
    icon: Boxes,
    title: 'Maîtriser votre stock et vos péremptions',
    desc: 'Alertes automatiques de stock bas, suivi des dates de péremption (DLC), lots et mouvements détaillés à chaque vente ou achat.',
  },
  {
    icon: QrCode,
    title: 'Recevoir des commandes en ligne par QR Code',
    desc: 'Chaque boutique dispose de sa vitrine web avec son logo : vos clients scannent, commandent sans créer de compte et suivent leur livraison.',
  },
  {
    icon: BarChart3,
    title: 'Piloter à distance en toute confiance',
    desc: 'Suivez votre chiffre d’affaires, votre marge nette, vos dépenses, vos créances clients et les dettes fournisseurs depuis votre téléphone.',
  },
];

const PLATFORM_OFFERINGS = [
  {
    icon: Receipt,
    title: 'Caisse POS & Tickets 58/80mm',
    desc: 'Ouverture/clôture de caisse, remises plafonnées, paiements mixtes (Espèces, Orange Money, Wave, Moov) et impression thermique ou PDF.',
  },
  {
    icon: Layers,
    title: 'Catalogue & Codes-barres automatiques',
    desc: 'Référence SKU et code-barres EAN-13 générés automatiquement selon votre boutique et catégorie, prêts à être scannés.',
  },
  {
    icon: Store,
    title: 'Vitrine E-commerce & Messagerie client',
    desc: 'Catalogue en ligne adaptatif (liste rapide épicerie, galerie mode/cosmétique, fiche technique), panier avec tailles/couleurs et chat direct.',
  },
  {
    icon: Truck,
    title: 'Achats, Fournisseurs & Coût Moyen (CMP)',
    desc: 'Enregistrez ce que chaque fournisseur vend, réceptionnez vos commandes en gros ou détail et suivez vos règlements fournisseurs.',
  },
  {
    icon: Users,
    title: 'Multi-boutiques, Agents & Transferts',
    desc: 'Donnez des permissions sur mesure à vos vendeurs et transférez des marchandises d’une boutique à l’autre avec traçabilité complète.',
  },
  {
    icon: ShieldCheck,
    title: 'Base dédiée par boutique & Sécurité',
    desc: 'Chaque boutique dispose de sa propre base PostgreSQL isolée, chiffrement des sessions et double authentification.',
  },
];

export default function LandingPage() {
  const { loading: authLoading, user } = useAuth();

  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansErr, setPlansErr] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<SubscriptionBillingCycle>('MONTHLY');

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansErr(null);
    try {
      const data = await apiFetch<PublicPlan[]>('/public/plans', { requiresOnline: false });
      setPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      setPlansErr(
        err instanceof ApiError
          ? err.message
          : 'Impossible de charger la grille tarifaire pour le moment.',
      );
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const dashboardHref =
    user?.role === 'SUPER_ADMIN'
      ? '/admin'
      : user?.role === 'OWNER'
        ? '/owner'
        : user?.role === 'AGENT'
          ? '/agent'
          : '/login';

  const enabledCycles = SUBSCRIPTION_BILLING_CYCLES.filter((c) =>
    plans.length === 0
      ? true
      : plans.some((p) =>
          c === 'MONTHLY'
            ? p.allowMonthly
            : c === 'YEARLY'
              ? p.allowYearly
              : p.allowDirectSale,
        ),
  );
  const activeCycle: SubscriptionBillingCycle = enabledCycles.includes(billingCycle)
    ? billingCycle
    : enabledCycles[0] || 'MONTHLY';

  const maxTrialDays = plans.reduce((acc, p) => Math.max(acc, p.trialDays || 0), 14);

  return (
    <div className="min-h-screen w-full overflow-x-clip overscroll-none bg-porcelain-100 text-slate-900">
      {/* Navbar sticky Obsidian Emerald */}
      <header
        className="sticky top-0 z-40 border-b border-white/10 bg-forest-950/95 text-white backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-forest-700 text-sm font-black text-white ring-1 ring-white/20">
              SC
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold tracking-tight text-white">
                ShopControl
              </p>
              <p className="hidden truncate text-[10px] text-emerald-200/75 sm:block">
                Gestion Commerciale & Vitrine QR
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-5 text-xs font-bold text-emerald-100/85 md:flex">
            <a href="#utilite" className="hover:text-limeglow-400">
              À quoi ça sert
            </a>
            <a href="#offres" className="hover:text-limeglow-400">
              Ce qu’on offre
            </a>
            <a href="#metiers" className="hover:text-limeglow-400">
              Secteurs
            </a>
            <a href="#tarifs" className="hover:text-limeglow-400">
              Tarifs
            </a>
            <a href="#disponibilite" className="hover:text-limeglow-400">
              Disponibilité
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {!authLoading && user ? (
              <Link
                href={dashboardHref}
                className="inline-flex items-center gap-1.5 rounded-full bg-limeglow-400 px-3.5 py-2 text-xs font-extrabold text-forest-950 shadow-lime hover:bg-limeglow-300"
              >
                <span>Mon espace</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15 sm:px-4 sm:py-2"
                >
                  Se connecter
                </Link>
                <Link
                  href={`/register?billing=${activeCycle}&trial=1`}
                  className="inline-flex items-center gap-1 rounded-full bg-limeglow-400 px-3 py-1.5 text-xs font-extrabold text-forest-950 shadow-lime hover:bg-limeglow-300 sm:px-4 sm:py-2"
                >
                  <span>Essai {maxTrialDays}j</span>
                  <ArrowRight className="hidden h-3.5 w-3.5 sm:inline" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero principal */}
      <section className="obsidian-hero px-4 pb-12 pt-8 text-white sm:px-6 sm:pb-16 sm:pt-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-8 lg:grid-cols-12">
            <div className="space-y-5 lg:col-span-7">
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-limeglow-400/35 bg-limeglow-400/15 px-3.5 py-1.5 text-xs font-extrabold text-limeglow-300">
                <Gift className="h-4 w-4 text-limeglow-400" />
                <span>Essai gratuit de 2 semaines ({maxTrialDays} jours) · Sans engagement</span>
              </div>

              <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl lg:text-[42px]">
                Le logiciel tout-en-un pour gérer votre boutique, votre caisse et vos ventes en ligne.
              </h1>

              <p className="max-w-2xl text-sm leading-relaxed text-emerald-100/85 sm:text-base">
                <strong>ShopControl</strong> centralise votre comptoir POS, vos stocks, vos
                fournisseurs, vos créances clients et votre <strong>vitrine e-commerce par QR code</strong>.
                Conçu pour les commerçants sur téléphone, tablette et ordinateur.
              </p>

              <div className="flex flex-col gap-2.5 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
                <Link
                  href={`/register?billing=${activeCycle}&trial=1`}
                  className="sc-btn-lime justify-center rounded-full px-6 py-3.5 text-sm shadow-lime"
                >
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span>Activer mon essai gratuit ({maxTrialDays} jours)</span>
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 bg-white/10 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/20"
                >
                  <span>Se connecter à ma boutique</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="flex flex-wrap gap-3 pt-2 text-xs text-emerald-200/85">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
                  <Clock className="h-3.5 w-3.5 text-limeglow-400" />
                  Disponible 24h/24 & 7j/7
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
                  <Smartphone className="h-3.5 w-3.5 text-limeglow-400" />
                  Android · iPhone · PC
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
                  <Database className="h-3.5 w-3.5 text-limeglow-400" />
                  1 base isolée par boutique
                </span>
              </div>
            </div>

            {/* Panneau visuel résumé à droite */}
            <div className="lg:col-span-5">
              <div className="lime-glow-card space-y-4 rounded-3xl border border-limeglow-400/25 p-5 shadow-2xl sm:p-6">
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-limeglow-400">
                      Ce que vous obtenez dès l’inscription
                    </p>
                    <p className="text-base font-extrabold text-white">
                      Boutique prête en 2 minutes
                    </p>
                  </div>
                  <span className="rounded-2xl bg-white/10 p-2.5 text-limeglow-400">
                    <Store className="h-6 w-6" />
                  </span>
                </div>

                <ul className="space-y-2.5 text-xs text-emerald-50">
                  {[
                    'Caisse POS rapide avec tickets 58/80 mm & factures PDF',
                    'Catégories et produits pré-adaptés à votre commerce',
                    'Références SKU et codes-barres EAN-13 générés automatiquement',
                    'Vitrine QR personnalisée avec votre logo & suivi commande',
                    'Comptes Agents, Opérateurs PIN, Dépenses & Bilans en temps réel',
                    `2 semaines d’essai gratuit complet (${maxTrialDays} jours à 0 FCFA)`,
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-limeglow-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-3.5 text-xs">
                  <p className="font-bold text-limeglow-300">
                    Facturation flexible au choix :
                  </p>
                  <p className="mt-0.5 text-emerald-100/85">
                    Abonnement <strong>Par mois</strong>, <strong>Par année</strong> ou{' '}
                    <strong>Vente directe</strong> (licence unique) selon votre préférence.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-6 sm:py-14">
        {/* À quoi sert ShopControl ? */}
        <section id="utilite" className="scroll-mt-20 space-y-5">
          <div className="max-w-2xl">
            <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-brand-800">
              À quoi sert ShopControl ?
            </span>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">
              Remplacez les cahiers papier et contrôlez chaque franc de votre commerce.
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Que vous gériez une alimentation de quartier, une boutique de mode/cosmétiques ou un
              réseau de plusieurs points de vente, vous gardez une vue claire sur vos marges et vos stocks.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {USE_CASES.map((u) => {
              const Icon = u.icon;
              return (
                <div key={u.title} className="sc-card-hover p-5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-forest-900 text-limeglow-400">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3.5 text-base font-extrabold text-slate-900">{u.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{u.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Ce que la plateforme offre */}
        <section id="offres" className="scroll-mt-20 space-y-5">
          <div className="max-w-2xl">
            <span className="inline-block rounded-full bg-forest-900 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-limeglow-400">
              Fonctionnalités incluses
            </span>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">
              Ce que ShopControl vous offre au quotidien
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PLATFORM_OFFERINGS.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="sc-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900">{f.title}</h3>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-slate-600">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Secteurs métiers supportés */}
        <section id="metiers" className="scroll-mt-20 space-y-5">
          <div className="max-w-2xl">
            <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-brand-800">
              Secteurs adaptatifs
            </span>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">
              Une interface qui s’adapte automatiquement à votre métier
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Chaque catégorie applique sa propre manière de vendre : poids (kg), litre, carton/sac,
              tailles & couleurs, contenance & DLC, ou garantie & IMEI/châssis.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SHOP_TYPES.map((type) => (
              <div key={type} className="sc-card p-4">
                <p className="text-sm font-extrabold text-forest-950">{SHOP_TYPE_LABELS[type]}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {SHOP_TYPE_DESCRIPTIONS[type]}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Tarifs configurables en direct */}
        <section id="tarifs" className="scroll-mt-20 space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <span className="inline-block rounded-full bg-forest-900 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-limeglow-400">
                Tarifs & Abonnements
              </span>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-900 sm:text-3xl">
                Choisissez votre formule, commencez par {maxTrialDays} jours gratuits
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Tarifs transparents en Francs CFA (XOF), payables par mois, par année ou en vente directe.
              </p>
            </div>

            {/* Switcher Par mois | Par année | Vente directe */}
            {enabledCycles.length > 0 ? (
              <div
                role="group"
                aria-label="Mode de facturation"
                className="inline-flex w-full rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xs sm:w-auto"
              >
                {enabledCycles.map((cycle) => (
                  <button
                    key={cycle}
                    type="button"
                    onClick={() => setBillingCycle(cycle)}
                    className={`flex-1 rounded-xl px-3.5 py-2 text-xs font-extrabold transition sm:flex-initial ${
                      activeCycle === cycle
                        ? 'bg-forest-900 text-limeglow-400 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {SUBSCRIPTION_BILLING_CYCLE_LABELS[cycle]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {plansLoading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="sc-card h-72 animate-pulse bg-white/70 p-6" />
              ))}
            </div>
          ) : plansErr ? (
            <div className="sc-card flex flex-wrap items-center justify-between gap-3 border-rose-200 bg-rose-50 p-5 text-xs font-semibold text-rose-800">
              <span>{plansErr}</span>
              <button type="button" onClick={() => void loadPlans()} className="sc-btn-primary text-xs">
                Recharger les tarifs
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {plans.map((p) => {
                const isFeatured = Boolean(p.badge);
                const price = getPriceForCycle(p, activeCycle);
                const cycleEnabledOnPlan =
                  activeCycle === 'MONTHLY'
                    ? p.allowMonthly
                    : activeCycle === 'YEARLY'
                      ? p.allowYearly
                      : p.allowDirectSale;

                return (
                  <div
                    key={p.code}
                    className={`flex flex-col justify-between rounded-3xl p-6 transition ${
                      isFeatured
                        ? 'border-2 border-limeglow-400 bg-forest-950 text-white shadow-2xl'
                        : 'sc-card'
                    }`}
                  >
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3
                          className={`text-lg font-extrabold ${
                            isFeatured ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {p.name}
                        </h3>
                        {p.badge ? (
                          <span className="rounded-full bg-limeglow-400 px-3 py-0.5 text-[10px] font-black uppercase text-forest-950">
                            {p.badge}
                          </span>
                        ) : null}
                      </div>

                      <p
                        className={`mt-1 text-xs ${
                          isFeatured ? 'text-emerald-200/80' : 'text-slate-500'
                        }`}
                      >
                        {p.tagline}
                      </p>

                      <div className="mt-4 border-y border-current/10 py-4">
                        {cycleEnabledOnPlan ? (
                          <p
                            className={`text-3xl font-black tabular ${
                              isFeatured ? 'text-limeglow-400' : 'text-forest-950'
                            }`}
                          >
                            {formatXof(price)}
                            <span
                              className={`ml-1.5 text-xs font-semibold ${
                                isFeatured ? 'text-emerald-200/80' : 'text-slate-500'
                              }`}
                            >
                              {SUBSCRIPTION_BILLING_CYCLE_SUFFIX[activeCycle]}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs font-bold opacity-75">
                            Non disponible en mode {SUBSCRIPTION_BILLING_CYCLE_LABELS[activeCycle]}
                          </p>
                        )}
                        {p.trialDays > 0 ? (
                          <p
                            className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              isFeatured
                                ? 'bg-white/10 text-limeglow-300'
                                : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            <Gift className="h-3 w-3" />
                            Essai gratuit {p.trialDays} jours inclus
                          </p>
                        ) : null}
                      </div>

                      <p
                        className={`mt-3 text-xs font-bold ${
                          isFeatured ? 'text-emerald-100' : 'text-slate-700'
                        }`}
                      >
                        Jusqu’à {p.maxShops} boutique(s) · {p.maxAgentsPerShop} agents/boutique
                      </p>

                      <ul className="mt-3 space-y-2 text-xs">
                        {p.features.map((feat) => (
                          <li key={feat} className="flex items-start gap-2">
                            <CheckCircle2
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                isFeatured ? 'text-limeglow-400' : 'text-brand-600'
                              }`}
                            />
                            <span className={isFeatured ? 'text-emerald-50' : 'text-slate-600'}>
                              {feat}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <Link
                      href={`/register?plan=${p.code}&billing=${activeCycle}&trial=1`}
                      className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-xs font-extrabold transition ${
                        isFeatured
                          ? 'bg-limeglow-400 text-forest-950 shadow-lime hover:bg-limeglow-300'
                          : 'bg-forest-900 text-white hover:bg-forest-800'
                      }`}
                    >
                      <span>
                        {p.trialDays > 0
                          ? `Essai gratuit (${p.trialDays} jours)`
                          : 'Choisir cette offre'}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}

          <div className="sc-card flex flex-wrap items-center justify-between gap-3 bg-white p-4 text-xs text-slate-600">
            <span className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 shrink-0 text-brand-700" />
              Paiements acceptés après essai : <strong>Orange Money, Wave, Moov Money, Espèces ou Virement bancaire</strong>.
            </span>
            <Link href="/register?trial=1" className="font-extrabold text-brand-700 hover:underline">
              Créer mon compte maintenant →
            </Link>
          </div>
        </section>

        {/* Disponibilité & Mise en route */}
        <section id="disponibilite" className="scroll-mt-20 space-y-5">
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="sc-card space-y-4 p-6 lg:col-span-6">
              <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-brand-800">
                Disponibilité & Fiabilité
              </span>
              <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">
                Accessible partout, à tout moment
              </h2>
              <div className="space-y-3 text-xs text-slate-600">
                <p className="flex items-start gap-2.5">
                  <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                  <span>
                    <strong>100 % Mobile, Tablette & PC :</strong> aucune installation lourde
                    obligatoire, ouvrez directement depuis Chrome ou Safari en 4G/Wi-Fi.
                  </span>
                </p>
                <p className="flex items-start gap-2.5">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                  <span>
                    <strong>Service continu 24h/24 et 7j/7 :</strong> votre vitrine QR reste
                    accessible aux clients même en dehors des horaires d’ouverture.
                  </span>
                </p>
                <p className="flex items-start gap-2.5">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                  <span>
                    <strong>Accompagnement & Support intégré :</strong> messagerie directe avec le
                    support plateforme directement depuis vos paramètres.
                  </span>
                </p>
              </div>
            </div>

            <div className="obsidian-hero flex flex-col justify-between space-y-4 rounded-3xl p-6 text-white lg:col-span-6">
              <div className="space-y-3">
                <span className="inline-block rounded-full bg-limeglow-400/20 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-limeglow-300">
                  Démarrage rapide
                </span>
                <h2 className="text-xl font-extrabold text-white sm:text-2xl">
                  Démarrez votre essai gratuit de 2 semaines aujourd’hui
                </h2>
                <ol className="space-y-2 text-xs text-emerald-100/90">
                  <li>
                    <strong>1.</strong> Renseignez votre boutique, votre secteur et ajoutez votre logo.
                  </li>
                  <li>
                    <strong>2.</strong> Activez vos <strong>14 jours d’essai gratuit</strong> (0 FCFA aujourd’hui).
                  </li>
                  <li>
                    <strong>3.</strong> Ajoutez vos premiers articles et partagez le QR code à vos clients.
                  </li>
                </ol>
              </div>

              <div className="flex flex-col gap-2.5 pt-2 sm:flex-row">
                <Link
                  href={`/register?billing=${activeCycle}&trial=1`}
                  className="sc-btn-lime flex-1 justify-center rounded-full py-3 text-xs sm:text-sm"
                >
                  Activer mon essai gratuit ({maxTrialDays}j)
                </Link>
                <Link
                  href="/login"
                  className="inline-flex flex-1 items-center justify-center rounded-full border border-white/25 bg-white/10 px-4 py-3 text-xs font-bold text-white hover:bg-white/20 sm:text-sm"
                >
                  Se connecter
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer avec signature Chakir’s Entreprise */}
      <footer className="border-t border-slate-200/80 bg-white px-4 py-6 text-xs text-slate-500 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-center sm:text-left">
            ShopControl · Propulsé par{' '}
            <sub className="bottom-[-0.18em] text-[11px] font-semibold tracking-wide text-slate-700">
              Chakir’s Entreprise
            </sub>
          </p>
          <div className="flex flex-wrap items-center gap-4 font-bold">
            <Link href="/login" className="text-slate-700 hover:text-brand-700">
              Connexion
            </Link>
            <Link href="/register?trial=1" className="text-brand-700 hover:underline">
              Essai gratuit {maxTrialDays} jours
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
