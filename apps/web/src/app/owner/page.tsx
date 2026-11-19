'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  BarChart3,
  ChevronRight,
  Database,
  Package,
  Plus,
  QrCode,
  Receipt,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingUp,
} from 'lucide-react';
import { formatXof } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ShopQrModal } from '@/components/commerce/ShopQrModal';
import {
  ChartPoint,
  DualLineAnalyticsChart,
  HealthBarPill,
} from '@/components/ui/AnalyticsChart';
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '@/components/ui/StateViews';

type Period = 'daily' | 'weekly' | 'monthly';

interface AnalyticsPayload {
  period: Period;
  kpis: {
    currentSalesXof: number;
    grossSalesXof?: number;
    refundsXof?: number;
    cogsXof?: number;
    grossMarginXof?: number;
    estimatedNetProfitXof?: number;
    isEstimated?: boolean;
    missingCostProductsCount?: number;
    pendingOrdersCount?: number;
    previousSalesXof: number;
    salesDeltaPercent: number;
    currentSalesCount: number;
    averageOrderXof: number;
    totalProductsCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    openReceivablesCount: number;
    openReceivablesAmountXof: number;
    receivableRatioPercent: number;
    expensesXof: number;
    openCashSessionsCount: number;
    overdueCashSessions: number;
    recentDiscrepancies: number;
    stockConflictsCount: number;
    priorityActionsCount: number;
  };
  chartSeries: ChartPoint[];
  topProducts: Array<{
    id: string;
    shopId: string;
    shopName: string;
    name: string;
    sku: string;
    categoryName: string | null;
    imageUrl?: string | null;
    salePriceXof: number;
    stockAvailable: number;
    alertThreshold: number;
    salesQty: number;
    health: 'OK' | 'LOW' | 'CRITICAL';
  }>;
}

interface ConsolidatedOverview {
  totals: {
    totalShops: number;
    activeShops: number;
    readyDatabases: number;
    activeAgentsCount: number;
    activeOperatorsCount: number;
    activeTerminalsCount: number;
  };
  byShop: Array<{
    shopId: string;
    shopName: string;
    slug: string;
    status: string;
    dbName: string;
    dbStatus: string;
    activeAgentsCount: number;
    activeOperatorsCount: number;
    activeTerminalsCount: number;
  }>;
}

export default function OwnerDashboardPage() {
  const { user, shops, selectedShopId, setSelectedShopId, supportGrantId } = useAuth();
  const [period, setPeriod] = useState<Period>('monthly');
  const [chartMode, setChartMode] = useState<'sales' | 'count'>('sales');
  const [rightTab, setRightTab] = useState<'products' | 'shops'>('products');
  const [productSearch, setProductSearch] = useState('');
  const [qrShop, setQrShop] = useState<{ slug: string; name: string } | null>(null);

  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [overview, setOverview] = useState<ConsolidatedOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const analyticsPath =
        selectedShopId === 'ALL'
          ? `/merchant/analytics?period=${period}`
          : `/shops/${selectedShopId}/analytics?period=${period}`;

      const [anRes, ovRes] = await Promise.all([
        apiFetch<AnalyticsPayload>(analyticsPath, {
          shopId: selectedShopId !== 'ALL' ? selectedShopId : undefined,
          supportGrantId,
        }),
        apiFetch<ConsolidatedOverview>('/merchant/overview', { supportGrantId }),
      ]);
      setAnalytics(anRes);
      setOverview(ovRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement du tableau de bord.');
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, period, supportGrantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredProducts = useMemo(() => {
    const list = analytics?.topProducts || [];
    const q = productSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.shopName.toLowerCase().includes(q),
    );
  }, [analytics, productSearch]);

  const selectedShopMeta = shops.find((s) => s.shopId === selectedShopId) || shops[0];
  const kpis = analytics?.kpis;
  const firstName = user?.fullName.split(' ')[0] || 'Propriétaire';

  const receivableRiskLevel: 'OK' | 'LOW' | 'CRITICAL' = !kpis
    ? 'OK'
    : kpis.receivableRatioPercent >= 25
      ? 'CRITICAL'
      : kpis.receivableRatioPercent >= 10
        ? 'LOW'
        : 'OK';

  const heroSection = (
    <div className="space-y-4 sm:space-y-5">
      {/* Salutation + sélecteur de période + CTA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-white sm:text-[26px]">
            Bonjour {firstName} !
          </h1>
          <p className="mt-0.5 text-xs text-emerald-200/70">
            {selectedShopId === 'ALL'
              ? `Données consolidées temps réel · ${overview?.totals.totalShops ?? shops.length} boutique(s) isolée(s)`
              : `Boutique ${selectedShopMeta?.shopName || ''} · Base dédiée temps réel`}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
          {/* Sélecteur Jour / Semaine / Mois */}
          <div
            role="group"
            aria-label="Période d'analyse"
            className="grid w-full grid-cols-3 rounded-full border border-white/10 bg-forest-800/80 p-1 text-xs font-semibold sm:inline-flex sm:w-auto"
          >
            {(
              [
                { key: 'daily', label: 'Jour' },
                { key: 'weekly', label: 'Semaine' },
                { key: 'monthly', label: 'Mois' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPeriod(opt.key)}
                className={`rounded-full px-3 py-1.5 text-center transition-all sm:px-3.5 ${
                  period === opt.key
                    ? 'bg-white/15 text-white shadow-xs ring-1 ring-white/20'
                    : 'text-[#8aa8a2] hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {selectedShopMeta ? (
              <button
                type="button"
                onClick={() =>
                  setQrShop({ slug: selectedShopMeta.slug, name: selectedShopMeta.shopName })
                }
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/15 sm:flex-none"
              >
                <QrCode className="h-3.5 w-3.5 text-limeglow-400" />
                <span>QR Vitrine</span>
              </button>
            ) : null}

            {!supportGrantId ? (
              <Link
                href={shops.length > 0 ? '/pos' : '/owner/shops'}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-extrabold text-forest-950 shadow-sm transition hover:bg-emerald-50 sm:flex-none"
              >
                <span>{shops.length > 0 ? 'Nouvelle vente' : 'Créer boutique'}</span>
                <Plus className="h-4 w-4 stroke-[2.5]" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* 4 cartes KPI Obsidian Glass sur 1 rangée dès lg (1024px+) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1 : Chiffre d'affaires Net (remboursements déduits !) */}
        <div className="sc-dark-glass min-w-0 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-500/20 text-limeglow-400 ring-1 ring-brand-400/25">
                <ShoppingBag className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#98b3ae]">Chiffre d’affaires net</p>
                <p className="mt-0.5 truncate text-lg font-extrabold tracking-tight text-white tabular sm:text-xl">
                  {formatXof(kpis?.currentSalesXof ?? 0)}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <TrendingUp
              className={`h-3.5 w-3.5 shrink-0 ${
                (kpis?.salesDeltaPercent ?? 0) >= 0 ? 'text-limeglow-400' : 'text-rose-400'
              }`}
            />
            <span
              className={`font-bold ${
                (kpis?.salesDeltaPercent ?? 0) >= 0 ? 'text-limeglow-400' : 'text-rose-400'
              }`}
            >
              {(kpis?.salesDeltaPercent ?? 0) >= 0 ? '+' : ''}
              {kpis?.salesDeltaPercent ?? 0}%
            </span>
            <span className="text-[#8aa8a2]">
              · {kpis?.currentSalesCount ?? 0} vente(s)
            </span>
            {(kpis?.refundsXof ?? 0) > 0 ? (
              <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-200">
                -{formatXof(kpis?.refundsXof ?? 0)} remb.
              </span>
            ) : null}
          </div>
        </div>

        {/* KPI 2 : Résultat Net & Marge */}
        <div className="sc-dark-glass min-w-0 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-emerald-200">
                <BarChart3 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-[#98b3ae]">Résultat net</p>
                  {kpis?.isEstimated ? (
                    <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200">
                      Estimé
                    </span>
                  ) : null}
                </div>
                <p
                  className={`mt-0.5 truncate text-lg font-extrabold tracking-tight tabular sm:text-xl ${
                    (kpis?.estimatedNetProfitXof ?? 0) >= 0 ? 'text-white' : 'text-rose-300'
                  }`}
                >
                  {formatXof(kpis?.estimatedNetProfitXof ?? 0)}
                </p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[#8aa8a2]">
            Marge : <strong className="text-emerald-200 tabular">{formatXof(kpis?.grossMarginXof ?? 0)}</strong>
            {' · '}Dép. : <strong className="text-white tabular">{formatXof(kpis?.expensesXof ?? 0)}</strong>
          </p>
        </div>

        {/* KPI 3 : Créances / Santé Trésorerie */}
        <div className="sc-dark-glass min-w-0 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-emerald-200">
                <Receipt className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#98b3ae]">Créances & Stocks</p>
                <p className="mt-0.5 text-lg font-extrabold tracking-tight text-white tabular sm:text-xl">
                  {formatXof(kpis?.openReceivablesAmountXof ?? 0)}
                </p>
              </div>
            </div>
            <HealthBarPill
              level={receivableRiskLevel}
              label={
                receivableRiskLevel === 'OK'
                  ? 'Sain'
                  : receivableRiskLevel === 'LOW'
                    ? 'Modéré'
                    : 'Élevé'
              }
            />
          </div>
          <p className="mt-3 text-[11px] text-[#8aa8a2]">
            <span className="font-semibold text-white">{kpis?.totalProductsCount ?? 0}</span> produits ·{' '}
            <span className={(kpis?.lowStockCount ?? 0) > 0 ? 'font-bold text-amber-300' : 'text-emerald-300'}>
              {kpis?.lowStockCount ?? 0} stock bas
            </span>
          </p>
        </div>

        {/* KPI 4 : Carte Lime-Glow Actions & Commandes QR */}
        <div className="lime-glow-card flex min-w-0 flex-col justify-between rounded-2xl border border-limeglow-400/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
            <div className="min-w-0">
              <p className="text-lg font-extrabold text-white tabular">
                {(kpis?.priorityActionsCount ?? 0) + (kpis?.pendingOrdersCount ?? 0)}{' '}
                <span className="text-xs font-semibold text-emerald-100/80">Actions</span>
              </p>
              <p className="text-xs font-semibold text-emerald-50">
                {(kpis?.pendingOrdersCount ?? 0) > 0
                  ? `${kpis?.pendingOrdersCount} commande(s) QR à traiter`
                  : 'Pilotage & alertes temps réel'}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-emerald-200/75">
                {kpis?.openCashSessionsCount ?? 0} caisse(s) ouverte(s)
              </p>
            </div>
            <Link
              href={(kpis?.pendingOrdersCount ?? 0) > 0 ? '/commerce/orders' : '/owner/reports'}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-limeglow-400 px-3.5 py-2 text-xs font-extrabold text-forest-950 shadow-lime transition hover:bg-limeglow-300"
            >
              <span>{(kpis?.pendingOrdersCount ?? 0) > 0 ? 'Commandes' : 'Bilans'}</span>
              <Sparkles className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <AppShell allowedRoles={['OWNER']} hero={heroSection}>
      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : shops.length === 0 ? (
        <EmptyState
          title="Créez votre première boutique"
          description="ShopControl provisionnera automatiquement une base PostgreSQL dédiée et isolée pour chaque boutique."
          action={
            <Link href="/owner/shops" className="sc-btn-primary rounded-full px-5">
              <Plus className="h-4 w-4" />
              Créer ma première boutique
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
          {/* Panneau gauche : Analytique rapide + Graphique double courbe + Actions */}
          <section className="sc-card flex min-w-0 flex-col justify-between rounded-3xl p-4 sm:p-5 lg:col-span-6">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-extrabold text-slate-900">Analytique rapide</h2>
                <div className="flex w-full items-center justify-between gap-1.5 sm:inline-flex sm:w-auto">
                  <select
                    value={chartMode}
                    onChange={(e) => setChartMode(e.target.value as 'sales' | 'count')}
                    aria-label="Indicateur du graphique"
                    className="flex-1 rounded-xl border border-slate-200 bg-porcelain-50 px-3 py-1.5 text-xs font-semibold text-slate-700 sm:flex-none"
                  >
                    <option value="sales">Chiffre d’affaires net (XOF)</option>
                    <option value="count">Nombre de ventes</option>
                  </select>
                  <Link
                    href="/owner/reports"
                    title="Ouvrir les bilans consolidés & exports PDF"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              {/* 3 mini-cartes KPI */}
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setChartMode('sales')}
                  className={`min-w-0 rounded-2xl border p-3 text-left transition sm:p-3.5 ${
                    chartMode === 'sales'
                      ? 'border-forest-900 bg-white shadow-xs ring-1 ring-forest-900/10'
                      : 'border-slate-200 bg-porcelain-50 hover:border-slate-300'
                  }`}
                >
                  <p className="truncate text-[11px] font-medium text-slate-500">Panier moyen</p>
                  <p className="mt-1 truncate text-sm font-extrabold text-slate-900 tabular sm:text-base">
                    {formatXof(kpis?.averageOrderXof ?? 0)}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setChartMode('sales')}
                  className="min-w-0 rounded-2xl border border-slate-200 bg-porcelain-50 p-3 text-left transition hover:border-slate-300 sm:p-3.5"
                >
                  <p className="truncate text-[11px] font-medium text-slate-500">Période préc.</p>
                  <p className="mt-1 truncate text-sm font-extrabold text-slate-900 tabular sm:text-base">
                    {formatXof(kpis?.previousSalesXof ?? 0)}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setChartMode('count')}
                  className={`col-span-2 min-w-0 rounded-2xl border p-3 text-left transition sm:col-span-1 sm:p-3.5 ${
                    chartMode === 'count'
                      ? 'border-forest-900 bg-white shadow-xs ring-1 ring-forest-900/10'
                      : 'border-slate-200 bg-porcelain-50 hover:border-slate-300'
                  }`}
                >
                  <p className="truncate text-[11px] font-medium text-slate-500">Remboursements</p>
                  <p className="mt-1 truncate text-sm font-extrabold text-rose-700 tabular sm:text-base">
                    {formatXof(kpis?.refundsXof ?? 0)}
                  </p>
                </button>
              </div>

              {/* Graphique double courbe */}
              <div className="mt-5">
                <DualLineAnalyticsChart
                  points={analytics?.chartSeries || []}
                  metricMode={chartMode}
                />
              </div>
            </div>

            {/* Lignes d'actions rapides */}
            <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-porcelain-50">
              <Link
                href="/commerce/orders"
                className="flex items-center justify-between gap-2 px-3.5 py-3 text-xs transition hover:bg-white sm:px-4"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-slate-700">
                  <ShoppingBag className="h-4 w-4 shrink-0 text-brand-700" />
                  <span className="min-w-0">
                    <strong className="text-slate-900">
                      {kpis?.pendingOrdersCount ?? 0} commande(s) vitrine QR
                    </strong>{' '}
                    en attente de confirmation
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>

              <Link
                href="/commerce/stock"
                className="flex items-center justify-between gap-2 px-3.5 py-3 text-xs transition hover:bg-white sm:px-4"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-slate-700">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0">
                    <strong className="text-slate-900">{kpis?.lowStockCount ?? 0} produit(s)</strong>{' '}
                    en seuil bas ou rupture de stock
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>

              <Link
                href="/commerce/clients"
                className="flex items-center justify-between gap-2 px-3.5 py-3 text-xs transition hover:bg-white sm:px-4"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-slate-700">
                  <Receipt className="h-4 w-4 shrink-0 text-indigo-600" />
                  <span className="min-w-0">
                    <strong className="text-slate-900">
                      {kpis?.openReceivablesCount ?? 0} créance(s)
                    </strong>{' '}
                    client(s) ({formatXof(kpis?.openReceivablesAmountXof ?? 0)})
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>

              <Link
                href="/commerce/cash"
                className="flex items-center justify-between gap-2 px-3.5 py-3 text-xs transition hover:bg-white sm:px-4"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-slate-700">
                  <Banknote className="h-4 w-4 shrink-0 text-emerald-700" />
                  <span className="min-w-0">
                    <strong className="text-slate-900">
                      {kpis?.openCashSessionsCount ?? 0} caisse(s) ouverte(s)
                    </strong>
                    {(kpis?.recentDiscrepancies ?? 0) > 0
                      ? ` · ${kpis?.recentDiscrepancies} écart(s) récent(s)`
                      : ' · clôtures & écarts'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            </div>
          </section>

          {/* Panneau droit : Produits avec photos & Boutiques/BDD */}
          <section className="sc-card min-w-0 rounded-3xl p-4 sm:p-5 lg:col-span-6">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setRightTab('products')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition sm:text-sm ${
                    rightTab === 'products'
                      ? 'bg-forest-900 text-white'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  Produits{' '}
                  <span className="ml-1 text-xs font-normal opacity-75">
                    {analytics?.kpis.totalProductsCount ?? 0}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setRightTab('shops')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition sm:text-sm ${
                    rightTab === 'shops'
                      ? 'bg-forest-900 text-white'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  Boutiques & BDD{' '}
                  <span className="ml-1 text-xs font-normal opacity-75">
                    {overview?.byShop.length ?? 0}
                  </span>
                </button>
              </div>

              {rightTab === 'products' ? (
                <div className="relative w-full sm:max-w-[210px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="search"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Rechercher…"
                    className="w-full rounded-xl border border-slate-200 bg-porcelain-50 py-2 pl-8 pr-3 text-xs sm:py-1.5"
                  />
                </div>
              ) : null}
            </div>

            {rightTab === 'products' ? (
              filteredProducts.length === 0 ? (
                <div className="mt-6">
                  <EmptyState
                    title="Aucun produit dans cette vue"
                    description="Ajoutez vos articles avec leurs photos dans Produits ou importez votre catalogue via CSV."
                    action={
                      <Link href="/commerce/products" className="sc-btn-primary rounded-full text-xs">
                        Ajouter des produits
                      </Link>
                    }
                  />
                </div>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="mt-4 space-y-2.5 sm:hidden">
                    {filteredProducts.slice(0, 9).map((prod) => (
                      <div
                        key={`m-${prod.shopId}-${prod.id}`}
                        className="rounded-2xl border border-slate-200/80 bg-porcelain-50 p-3.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            {prod.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={prod.imageUrl}
                                alt={prod.name}
                                className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 object-cover bg-white"
                              />
                            ) : (
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-800">
                                {prod.name.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-900">{prod.name}</p>
                              <p className="truncate text-[11px] text-slate-400">
                                {prod.sku}
                                {selectedShopId === 'ALL' ? ` · ${prod.shopName}` : ''}
                              </p>
                            </div>
                          </div>
                          <HealthBarPill
                            level={prod.health}
                            label={
                              prod.health === 'OK'
                                ? 'Sain'
                                : prod.health === 'LOW'
                                  ? 'Bas'
                                  : 'Critique'
                            }
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-white px-3 py-2 text-center text-xs">
                          <div>
                            <p className="text-[10px] text-slate-400">Prix</p>
                            <p className="font-bold text-slate-900 tabular">
                              {formatXof(prod.salePriceXof)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400">Stock</p>
                            <p className="font-bold text-slate-800 tabular">{prod.stockAvailable}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400">Ventes</p>
                            <p className="font-bold text-brand-700 tabular">{prod.salesQty}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop table */}
                  <div className="mt-4 hidden overflow-x-auto sm:block">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          <th className="pb-2.5 pr-3">Produit</th>
                          <th className="pb-2.5 pr-3">Prix</th>
                          <th className="pb-2.5 pr-3">Stock</th>
                          <th className="pb-2.5 pr-3">Ventes</th>
                          <th className="pb-2.5 text-right">Santé</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/80">
                        {filteredProducts.slice(0, 9).map((prod) => (
                          <tr
                            key={`${prod.shopId}-${prod.id}`}
                            className="group transition hover:bg-porcelain-50"
                          >
                            <td className="py-3 pr-3">
                              <div className="flex items-center gap-2.5">
                                {prod.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={prod.imageUrl}
                                    alt={prod.name}
                                    className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 object-cover bg-white"
                                  />
                                ) : (
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-800">
                                    {prod.name.slice(0, 2).toUpperCase()}
                                  </span>
                                )}
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-900">{prod.name}</p>
                                  <p className="truncate text-[11px] text-slate-400">
                                    {prod.sku}
                                    {selectedShopId === 'ALL' ? ` · ${prod.shopName}` : ''}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap py-3 pr-3 text-xs font-bold text-slate-800 tabular">
                              {formatXof(prod.salePriceXof)}
                            </td>
                            <td className="py-3 pr-3 text-xs font-bold text-slate-700 tabular">
                              {prod.stockAvailable}
                            </td>
                            <td className="py-3 pr-3 text-xs font-semibold text-brand-700 tabular">
                              {prod.salesQty}
                            </td>
                            <td className="py-3 text-right">
                              <HealthBarPill
                                level={prod.health}
                                label={
                                  prod.health === 'OK'
                                    ? 'Sain'
                                    : prod.health === 'LOW'
                                      ? 'Bas'
                                      : 'Critique'
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            ) : (
              <div className="mt-4 space-y-2.5">
                {(overview?.byShop || []).map((shop) => (
                  <div
                    key={shop.shopId}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-porcelain-50 p-3.5 transition hover:bg-white sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest-900 text-limeglow-400">
                        <Store className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-bold text-slate-900">{shop.shopName}</p>
                          <StatusBadge status={shop.status} />
                        </div>
                        <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
                          <Database className="h-3 w-3 shrink-0 text-brand-700" />
                          <span className="truncate">{shop.dbName}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-slate-200/60 pt-2.5 text-xs text-slate-600 sm:border-t-0 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => setQrShop({ slug: shop.slug, name: shop.shopName })}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        QR
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedShopId(shop.shopId)}
                        className="rounded-full bg-forest-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-forest-800"
                      >
                        Ouvrir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {qrShop ? (
        <ShopQrModal slug={qrShop.slug} shopName={qrShop.name} onClose={() => setQrShop(null)} />
      ) : null}
    </AppShell>
  );
}
