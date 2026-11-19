'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  ChevronRight,
  Database,
  Package,
  Plus,
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

  const selectedShopMeta = shops.find((s) => s.shopId === selectedShopId);
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
    <div className="space-y-5">
      {/* Salutation + sélecteur de période + CTA blanc pill */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[26px]">
            Bonjour {firstName} !
          </h1>
          <p className="mt-0.5 text-xs text-emerald-200/70">
            {selectedShopId === 'ALL'
              ? `Données consolidées en temps réel · ${overview?.totals.totalShops ?? shops.length} boutique(s) isolée(s)`
              : `Boutique ${selectedShopMeta?.shopName || ''} · Base dédiée temps réel`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Sélecteur Jour / Semaine / Mois */}
          <div
            role="group"
            aria-label="Période d'analyse"
            className="inline-flex rounded-full border border-white/10 bg-forest-800 p-1 text-xs font-semibold"
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
                className={`rounded-full px-3.5 py-1.5 transition-all ${
                  period === opt.key
                    ? 'bg-white/15 text-white shadow-xs ring-1 ring-white/20'
                    : 'text-[#8ea9a4] hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {!supportGrantId ? (
            <Link
              href={shops.length > 0 ? '/pos' : '/owner/shops'}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-forest-900 shadow-sm transition hover:bg-emerald-50"
            >
              <span>{shops.length > 0 ? 'Nouvelle vente' : 'Créer boutique'}</span>
              <Plus className="h-4 w-4 stroke-[2.5]" />
            </Link>
          ) : null}
        </div>
      </div>

      {/* 4 cartes KPI sombres translucides + 4e carte Actions Lime-Glow */}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1 : Chiffre d'affaires */}
        <div className="rounded-2xl border border-white/10 bg-forest-800/85 p-4 backdrop-blur-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-emerald-200">
                <ShoppingBag className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-medium text-[#98b3ae]">Chiffre d’affaires</p>
                <p className="mt-0.5 text-xl font-bold tracking-tight text-white">
                  {formatXof(kpis?.currentSalesXof ?? 0)}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px]">
            <TrendingUp
              className={`h-3.5 w-3.5 ${
                (kpis?.salesDeltaPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            />
            <span
              className={`font-semibold ${
                (kpis?.salesDeltaPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {(kpis?.salesDeltaPercent ?? 0) >= 0 ? '+' : ''}
              {kpis?.salesDeltaPercent ?? 0}%
            </span>
            <span className="text-[#7c9994]">
              vs période préc. · {kpis?.currentSalesCount ?? 0} vente(s)
            </span>
          </div>
        </div>

        {/* KPI 2 : Total Produits */}
        <div className="rounded-2xl border border-white/10 bg-forest-800/85 p-4 backdrop-blur-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-emerald-200">
              <Package className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-medium text-[#98b3ae]">Total Produits</p>
              <p className="mt-0.5 text-xl font-bold tracking-tight text-white">
                {kpis?.totalProductsCount ?? 0}{' '}
                <span className="text-xs font-normal text-[#8ea9a4]">articles</span>
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[#7c9994]">
            <span
              className={`font-semibold ${
                (kpis?.lowStockCount ?? 0) > 0 ? 'text-amber-300' : 'text-emerald-400'
              }`}
            >
              {kpis?.lowStockCount ?? 0} en seuil bas
            </span>{' '}
            · {kpis?.outOfStockCount ?? 0} en rupture
          </p>
        </div>

        {/* KPI 3 : Créances / Risque encours */}
        <div className="rounded-2xl border border-white/10 bg-forest-800/85 p-4 backdrop-blur-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-emerald-200">
                <Receipt className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-medium text-[#98b3ae]">Créances clients</p>
                <p className="mt-0.5 text-xl font-bold tracking-tight text-white">
                  {kpis?.receivableRatioPercent ?? 0}
                  <span className="ml-0.5 text-xs font-normal text-[#8ea9a4]">%</span>
                </p>
              </div>
            </div>
            <HealthBarPill
              level={receivableRiskLevel}
              label={
                receivableRiskLevel === 'OK'
                  ? 'Faible'
                  : receivableRiskLevel === 'LOW'
                    ? 'Modéré'
                    : 'Élevé'
              }
            />
          </div>
          <p className="mt-3 text-[11px] text-[#7c9994]">
            Encours :{' '}
            <span className="font-semibold text-white">
              {formatXof(kpis?.openReceivablesAmountXof ?? 0)}
            </span>{' '}
            ({kpis?.openReceivablesCount ?? 0} dossier(s))
          </p>
        </div>

        {/* KPI 4 : Carte lumineuse Lime-Glow Actions prioritaires */}
        <div className="lime-glow-card flex flex-col justify-between rounded-2xl border border-limeglow-400/25 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-white">
                {kpis?.priorityActionsCount ?? 0}{' '}
                <span className="text-xs font-medium text-emerald-100/80">Actions</span>
              </p>
              <p className="text-xs font-semibold text-emerald-50">
                Alertes & suivi temps réel
              </p>
              <p className="mt-0.5 text-[11px] text-emerald-200/75">
                Dépenses : {formatXof(kpis?.expensesXof ?? 0)}
              </p>
            </div>
            <Link
              href={(kpis?.lowStockCount ?? 0) > 0 ? '/commerce/stock' : '/commerce/clients'}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-limeglow-400 px-3.5 py-2 text-xs font-bold text-forest-950 shadow-sm transition hover:bg-lime-300"
            >
              <span>Voir actions</span>
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
            <Link
              href="/owner/shops"
              className="inline-flex items-center gap-2 rounded-full bg-forest-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-800"
            >
              <Plus className="h-4 w-4" />
              Créer ma première boutique
            </Link>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          {/* Panneau gauche : Analytique rapide + Graphique double courbe + Actions rapides */}
          <section className="flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card lg:col-span-6">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900">Analytique rapide</h2>
                <div className="inline-flex items-center gap-1.5">
                  <select
                    value={chartMode}
                    onChange={(e) => setChartMode(e.target.value as 'sales' | 'count')}
                    aria-label="Indicateur du graphique"
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    <option value="sales">Vue Chiffre d’affaires (XOF)</option>
                    <option value="count">Vue Nombre de ventes</option>
                  </select>
                  <Link
                    href="/pos"
                    title="Ouvrir le comptoir POS"
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              {/* 3 mini-cartes KPI blanches (style screenshot : bordure foncée sur la 1re active) */}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setChartMode('sales')}
                  className={`rounded-2xl border p-3.5 text-left transition ${
                    chartMode === 'sales'
                      ? 'border-forest-900 bg-white shadow-xs ring-1 ring-forest-900/10'
                      : 'border-slate-200 bg-slate-50/60 hover:border-slate-300'
                  }`}
                >
                  <p className="text-[11px] font-medium text-slate-500">Panier moyen</p>
                  <p className="mt-1 text-base font-bold text-slate-900">
                    {formatXof(kpis?.averageOrderXof ?? 0)}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setChartMode('sales')}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 text-left transition hover:border-slate-300"
                >
                  <p className="text-[11px] font-medium text-slate-500">Période précédente</p>
                  <p className="mt-1 text-base font-bold text-slate-900">
                    {formatXof(kpis?.previousSalesXof ?? 0)}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setChartMode('count')}
                  className={`rounded-2xl border p-3.5 text-left transition ${
                    chartMode === 'count'
                      ? 'border-forest-900 bg-white shadow-xs ring-1 ring-forest-900/10'
                      : 'border-slate-200 bg-slate-50/60 hover:border-slate-300'
                  }`}
                >
                  <p className="text-[11px] font-medium text-slate-500">Produits stock bas</p>
                  <p className="mt-1 text-base font-bold text-slate-900">
                    {kpis?.lowStockCount ?? 0}{' '}
                    <span className="text-xs font-normal text-slate-500">articles</span>
                  </p>
                </button>
              </div>

              {/* Graphique SVG double courbe */}
              <div className="mt-5">
                <DualLineAnalyticsChart
                  points={analytics?.chartSeries || []}
                  metricMode={chartMode}
                />
              </div>
            </div>

            {/* 3 lignes d'actions rapides cliquables sous le graphique */}
            <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-slate-50/40">
              <Link
                href="/commerce/stock"
                className="flex items-center justify-between px-4 py-3 text-xs transition hover:bg-white"
              >
                <span className="flex items-center gap-2.5 text-slate-700">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>
                    <strong className="text-slate-900">{kpis?.lowStockCount ?? 0} produit(s)</strong>{' '}
                    en seuil bas ou rupture de stock
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>

              <Link
                href="/commerce/clients"
                className="flex items-center justify-between px-4 py-3 text-xs transition hover:bg-white"
              >
                <span className="flex items-center gap-2.5 text-slate-700">
                  <Receipt className="h-4 w-4 text-brand-700" />
                  <span>
                    <strong className="text-slate-900">
                      {kpis?.openReceivablesCount ?? 0} créance(s)
                    </strong>{' '}
                    client(s) à encaisser ({formatXof(kpis?.openReceivablesAmountXof ?? 0)})
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>

              <Link
                href="/commerce/cash"
                className="flex items-center justify-between px-4 py-3 text-xs transition hover:bg-white"
              >
                <span className="flex items-center gap-2.5 text-slate-700">
                  <Banknote className="h-4 w-4 text-emerald-700" />
                  <span>
                    <strong className="text-slate-900">
                      {kpis?.openCashSessionsCount ?? 0} caisse(s) ouverte(s)
                    </strong>
                    {(kpis?.recentDiscrepancies ?? 0) > 0
                      ? ` · ${kpis?.recentDiscrepancies} écart(s) récent(s) à vérifier`
                      : ' · suivi des clôtures et écarts'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            </div>
          </section>

          {/* Panneau droit : Tableau Produits (avec barres segmentées) & onglet Boutiques/BDD */}
          <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card lg:col-span-6">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRightTab('products')}
                  className={`rounded-full px-3 py-1 text-sm font-bold transition ${
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
                  className={`rounded-full px-3 py-1 text-sm font-bold transition ${
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
                <div className="relative flex-1 sm:max-w-[200px]">
                  <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="search"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Rechercher…"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs"
                  />
                </div>
              ) : null}
            </div>

            {rightTab === 'products' ? (
              filteredProducts.length === 0 ? (
                <div className="mt-6">
                  <EmptyState
                    title="Aucun produit dans cette vue"
                    description="Ajoutez vos articles dans Produits ou importez votre catalogue via Import CSV."
                    action={
                      <Link
                        href="/commerce/products"
                        className="rounded-full bg-forest-900 px-4 py-2 text-xs font-semibold text-white"
                      >
                        Ajouter des produits
                      </Link>
                    }
                  />
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <th className="pb-2.5 pr-3">Produit</th>
                        <th className="pb-2.5 pr-3">Prix</th>
                        <th className="pb-2.5 pr-3">Stock</th>
                        <th className="pb-2.5 pr-3">Ventes</th>
                        <th className="pb-2.5 text-right">Santé stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/80">
                      {filteredProducts.slice(0, 9).map((prod) => (
                        <tr
                          key={`${prod.shopId}-${prod.id}`}
                          className="group transition hover:bg-slate-50"
                        >
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-800">
                                {prod.name.slice(0, 2).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-slate-900">{prod.name}</p>
                                <p className="truncate text-[11px] text-slate-400">
                                  {prod.sku}
                                  {selectedShopId === 'ALL' ? ` · ${prod.shopName}` : ''}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-xs font-semibold text-slate-800">
                            {formatXof(prod.salePriceXof)}
                          </td>
                          <td className="py-3 pr-3 text-xs font-bold text-slate-700">
                            {prod.stockAvailable}
                          </td>
                          <td className="py-3 pr-3 text-xs font-medium text-slate-600">
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
              )
            ) : (
              <div className="mt-4 space-y-2.5">
                {(overview?.byShop || []).map((shop) => (
                  <div
                    key={shop.shopId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition hover:bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest-900 text-white">
                        <Store className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-900">{shop.shopName}</p>
                          <StatusBadge status={shop.status} />
                        </div>
                        <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
                          <Database className="h-3 w-3 text-brand-700" />
                          {shop.dbName}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-600">
                      <span>
                        {shop.activeAgentsCount} ag. · {shop.activeOperatorsCount} op.
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedShopId(shop.shopId)}
                        className="rounded-full bg-forest-900 px-3 py-1 text-xs font-semibold text-white hover:bg-forest-800"
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
    </AppShell>
  );
}
