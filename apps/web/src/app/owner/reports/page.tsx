'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Truck,
} from 'lucide-react';
import {
  DAILY_REPORT_STATUS_LABELS,
  DailyReportStatus,
  formatDateTimeInTimezone,
  formatXof,
} from '@shopcontrol/shared';
import { apiFetch, API_BASE_URL, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface ShopSummaryRow {
  shopId: string;
  shopName: string;
  salesCount: number;
  itemsSoldQty: number;
  grossSalesXof: number;
  refundsXof: number;
  netSalesXof: number;
  cogsXof: number;
  grossMarginXof: number;
  expensesXof: number;
  estimatedNetProfitXof: number;
  isEstimated: boolean;
  missingCostProductsCount: number;
  receivablesOutstandingXof?: number;
}

interface ConsolidatedPayload {
  from: string;
  to: string;
  totals: {
    salesCount: number;
    itemsSoldQty: number;
    grossSalesXof: number;
    refundsXof: number;
    netSalesXof: number;
    cogsXof: number;
    grossMarginXof: number;
    shopsExpensesXof: number;
    companyExpensesXof: number;
    totalExpensesXof: number;
    estimatedNetProfitXof: number;
    isEstimated: boolean;
    missingCostProductsCount: number;
    paymentsBreakdown?: Record<string, number>;
    inTransitQty: number;
    inTransitValueXof: number;
  };
  paymentsBreakdown?: Record<string, number>;
  byShop: ShopSummaryRow[];
}

interface DailyReportRow {
  id: string;
  reportDate: string;
  version: number;
  status: DailyReportStatus;
  metrics?: {
    salesCount?: number;
    netSalesXof?: number;
    refundsXof?: number;
    expensesXof?: number;
    estimatedNetProfitXof?: number;
    isEstimated?: boolean;
  };
  createdAt: string;
}

export default function OwnerReportsPage() {
  const { shops, selectedShopId } = useAuth();
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;

  const [from, setFrom] = useState(monthStartStr);
  const [to, setTo] = useState(todayStr);
  const [report, setReport] = useState<ConsolidatedPayload | null>(null);
  const [dailyShopId, setDailyShopId] = useState('');
  const [dailyReports, setDailyReports] = useState<DailyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedShopId !== 'ALL' && shops.some((s) => s.shopId === selectedShopId)) {
      setDailyShopId(selectedShopId);
    } else if (shops[0]) {
      setDailyShopId((prev) => (prev && shops.some((s) => s.shopId === prev) ? prev : shops[0].shopId));
    }
  }, [selectedShopId, shops]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from, to });
      const res = await apiFetch<ConsolidatedPayload>(
        `/merchant/reports/consolidated?${qs.toString()}`,
      );
      setReport(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de calcul du bilan consolidé.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  const loadDaily = useCallback(async () => {
    if (!dailyShopId) return;
    try {
      const list = await apiFetch<DailyReportRow[]>(`/shops/${dailyShopId}/reports/daily`, {
        shopId: dailyShopId,
      });
      setDailyReports(Array.isArray(list) ? list : []);
    } catch {
      setDailyReports([]);
    }
  }, [dailyShopId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadDaily();
  }, [loadDaily]);

  const handleGenerateDaily = async () => {
    if (!dailyShopId) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const created = await apiFetch<DailyReportRow>(
        `/shops/${dailyShopId}/reports/daily/generate`,
        {
          method: 'POST',
          shopId: dailyShopId,
          body: { reportDate: todayStr },
        },
      );
      setMsg(
        `Bilan journalier v${created.version} archivé (${DAILY_REPORT_STATUS_LABELS[created.status]}).`,
      );
      await loadDaily();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Génération impossible.');
    } finally {
      setBusy(false);
    }
  };

  const t = report?.totals;
  const breakdown = t?.paymentsBreakdown || report?.paymentsBreakdown || {};

  return (
    <AppShell
      allowedRoles={['OWNER']}
      title="Bilans Financiers & Exports"
      subtitle="Somme exacte multi-boutiques · Dépenses entreprise distinctes · Stock en transit compté une seule fois."
      headerActions={
        <>
          <a
            href={`${API_BASE_URL}/merchant/reports/export.csv?from=${from}&to=${to}`}
            target="_blank"
            rel="noopener noreferrer"
            className="sc-hero-btn-ghost"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-limeglow-400" />
            Export CSV
          </a>
          <a
            href={`${API_BASE_URL}/merchant/reports/export.pdf?from=${from}&to=${to}`}
            target="_blank"
            rel="noopener noreferrer"
            className="sc-hero-btn-primary"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter PDF
          </a>
        </>
      }
    >
      <div className="space-y-5">

        {/* Sélecteur période */}
        <div className="sc-card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600">Du</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="sc-input mt-1 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">Au</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="sc-input mt-1 py-2 text-xs"
            />
          </div>
          <button type="button" onClick={() => void load()} className="sc-btn-ghost py-2 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Actualiser
          </button>
        </div>

        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : report && t ? (
          <>
            {t.isEstimated ? (
              <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-950">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Bénéfice affiché comme <strong>Estimé</strong> : {t.missingCostProductsCount}{' '}
                  article(s) vendu(s) sans coût d’achat renseigné.
                </span>
              </div>
            ) : null}

            {/* KPIs Consolidés */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sc-card p-4">
                <p className="text-xs font-semibold text-slate-500">Chiffre d’affaires Net</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-950 tabular">
                  {formatXof(t.netSalesXof)}
                </p>
                <p className="mt-1 text-xs text-slate-500 tabular">
                  Brut : {formatXof(t.grossSalesXof)} · Remb. : -{formatXof(t.refundsXof)}
                </p>
              </div>
              <div className="sc-card p-4">
                <p className="text-xs font-semibold text-slate-500">Marge Brute</p>
                <p className="mt-1 text-2xl font-extrabold text-brand-700 tabular">
                  {formatXof(t.grossMarginXof)}
                </p>
                <p className="mt-1 text-xs text-slate-500 tabular">
                  Coût achats vendus : {formatXof(t.cogsXof)}
                </p>
              </div>
              <div className="sc-card p-4">
                <p className="text-xs font-semibold text-slate-500">Total Dépenses</p>
                <p className="mt-1 text-2xl font-extrabold text-rose-700 tabular">
                  {formatXof(t.totalExpensesXof)}
                </p>
                <p className="mt-1 text-xs text-slate-500 tabular">
                  Boutiques : {formatXof(t.shopsExpensesXof)} · Entreprise :{' '}
                  {formatXof(t.companyExpensesXof)}
                </p>
              </div>
              <div className="rounded-2xl border border-forest-800 bg-forest-950 p-4 text-white shadow-card">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-emerald-200/80">Résultat Net</p>
                  {t.isEstimated ? (
                    <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                      ESTIMÉ
                    </span>
                  ) : null}
                </div>
                <p
                  className={`mt-1 text-2xl font-extrabold tabular ${
                    t.estimatedNetProfitXof >= 0 ? 'text-limeglow-400' : 'text-rose-400'
                  }`}
                >
                  {formatXof(t.estimatedNetProfitXof)}
                </p>
                <p className="mt-1 text-xs text-emerald-200/70">
                  {t.salesCount} vente(s) · {t.itemsSoldQty} article(s)
                </p>
              </div>
            </div>

            {/* Ligne Stock en transit + Ventilation Paiements */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="sc-card flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                    <Truck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-extrabold text-slate-900">
                      Stock actuellement en transit
                    </p>
                    <p className="text-xs text-slate-500">
                      Isolé hors boutiques, compté exactement 1 fois
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right tabular">
                  <p className="text-lg font-extrabold text-indigo-700">{t.inTransitQty} unité(s)</p>
                  <p className="text-xs font-semibold text-slate-600">
                    {formatXof(t.inTransitValueXof)}
                  </p>
                </div>
              </div>

              <div className="sc-card p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Encaissements par moyen de paiement
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {Object.keys(breakdown).length === 0 ? (
                    <span className="text-xs text-slate-400">Aucun encaissement sur la période.</span>
                  ) : (
                    Object.entries(breakdown).map(([code, amt]) => (
                      <span
                        key={code}
                        className="rounded-xl border border-slate-200 bg-porcelain-50 px-3 py-1.5 text-xs font-bold text-slate-800 tabular"
                      >
                        {code} : {formatXof(amt)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Comparatif par boutique : cartes mobile + tableau desktop */}
            <section className="sc-card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
                <BarChart3 className="h-4 w-4 text-brand-700" />
                <h2 className="text-sm font-extrabold text-slate-900">Comparatif par boutique</h2>
              </div>

              {/* Cartes mobile */}
              <div className="space-y-2.5 p-4 md:hidden">
                {report.byShop.map((s) => (
                  <div key={`m-${s.shopId}`} className="rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5 text-xs">
                    <p className="text-sm font-extrabold text-slate-900">{s.shopName}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 tabular">
                      <div>
                        <span className="text-slate-500">CA Net :</span>{' '}
                        <strong className="text-slate-900">{formatXof(s.netSalesXof)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Remb. :</span>{' '}
                        <strong className="text-rose-600">{formatXof(s.refundsXof)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Marge :</span>{' '}
                        <strong className="text-brand-700">{formatXof(s.grossMarginXof)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Résultat :</span>{' '}
                        <strong className="text-slate-900">{formatXof(s.estimatedNetProfitXof)}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tableau desktop */}
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-porcelain-50 text-left text-xs font-bold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Boutique</th>
                      <th className="px-4 py-3">Ventes</th>
                      <th className="px-4 py-3">CA Brut</th>
                      <th className="px-4 py-3">Remb.</th>
                      <th className="px-4 py-3">CA Net</th>
                      <th className="px-4 py-3">Marge</th>
                      <th className="px-4 py-3">Dépenses</th>
                      <th className="px-4 py-3">Résultat Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular">
                    {report.byShop.map((s) => (
                      <tr key={s.shopId} className="hover:bg-porcelain-50/70">
                        <td className="px-4 py-3 font-bold text-slate-900">{s.shopName}</td>
                        <td className="px-4 py-3 text-xs">{s.salesCount}</td>
                        <td className="px-4 py-3 text-xs">{formatXof(s.grossSalesXof)}</td>
                        <td className="px-4 py-3 text-xs text-rose-600">
                          {s.refundsXof > 0 ? `-${formatXof(s.refundsXof)}` : '0 F'}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {formatXof(s.netSalesXof)}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold text-brand-700">
                          {formatXof(s.grossMarginXof)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{formatXof(s.expensesXof)}</td>
                        <td className="px-4 py-3 font-extrabold text-slate-900">
                          {formatXof(s.estimatedNetProfitXof)}
                          {s.isEstimated ? (
                            <span className="ml-1 text-[10px] font-bold text-amber-600">(Est.)</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {t.companyExpensesXof > 0 ? (
                      <tr className="bg-amber-50/40 font-semibold">
                        <td className="px-4 py-3 text-amber-900" colSpan={6}>
                          Dépenses communes d’entreprise (non rattachées à une boutique)
                        </td>
                        <td className="px-4 py-3 text-rose-700">{formatXof(t.companyExpensesXof)}</td>
                        <td className="px-4 py-3 text-rose-700">-{formatXof(t.companyExpensesXof)}</td>
                      </tr>
                    ) : null}
                    <tr className="bg-forest-950 font-extrabold text-white">
                      <td className="px-4 py-3.5">TOTAL CONSOLIDÉ</td>
                      <td className="px-4 py-3.5">{t.salesCount}</td>
                      <td className="px-4 py-3.5">{formatXof(t.grossSalesXof)}</td>
                      <td className="px-4 py-3.5 text-rose-300">-{formatXof(t.refundsXof)}</td>
                      <td className="px-4 py-3.5 text-limeglow-400">{formatXof(t.netSalesXof)}</td>
                      <td className="px-4 py-3.5">{formatXof(t.grossMarginXof)}</td>
                      <td className="px-4 py-3.5">{formatXof(t.totalExpensesXof)}</td>
                      <td className="px-4 py-3.5 text-limeglow-400">
                        {formatXof(t.estimatedNetProfitXof)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Archive des Bilans Journaliers Versionnés */}
            <section className="sc-card space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Archive className="h-5 w-5 text-brand-700" />
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">
                      Bilans Journaliers Archivés (Versionnés)
                    </h2>
                    <p className="text-xs text-slate-500">
                      Provisoire si une caisse est encore ouverte, Définitif après clôture.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {shops.length > 1 ? (
                    <select
                      value={dailyShopId}
                      onChange={(e) => setDailyShopId(e.target.value)}
                      className="sc-input w-auto py-2 text-xs"
                    >
                      {shops.map((s) => (
                        <option key={s.shopId} value={s.shopId}>
                          {s.shopName}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || !dailyShopId}
                    onClick={handleGenerateDaily}
                    className="sc-btn-primary text-xs"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Archiver le bilan du jour
                  </button>
                </div>
              </div>

              {dailyReports.length === 0 ? (
                <EmptyState
                  title="Aucun bilan journalier archivé"
                  description="Cliquez sur « Archiver le bilan du jour » pour figer une photographie datée et versionnée de la journée."
                />
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {dailyReports.map((d) => {
                    const m = d.metrics || {};
                    return (
                      <div
                        key={d.id}
                        className="rounded-2xl border border-slate-200 bg-porcelain-50 p-4 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-extrabold text-slate-900">
                            {d.reportDate} · v{d.version}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              d.status === 'FINAL'
                                ? 'bg-emerald-100 text-emerald-800'
                                : d.status === 'PROVISIONAL'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {DAILY_REPORT_STATUS_LABELS[d.status]}
                          </span>
                        </div>
                        <div className="mt-2.5 grid grid-cols-2 gap-2 tabular">
                          <div>
                            <p className="text-[10px] text-slate-500">CA Net</p>
                            <p className="font-extrabold text-slate-900">
                              {formatXof(m.netSalesXof ?? 0)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500">Résultat</p>
                            <p className="font-extrabold text-brand-700">
                              {formatXof(m.estimatedNetProfitXof ?? 0)}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-[10px] text-slate-400">
                          Archivé le {formatDateTimeInTimezone(d.createdAt)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
