'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Database, Laptop, Plus, Store, UserCheck, Users } from 'lucide-react';
import { formatDateTimeInTimezone } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '@/components/ui/StateViews';

interface ConsolidatedOverview {
  merchantId: string;
  totals: {
    totalShops: number;
    activeShops: number;
    suspendedShops: number;
    readyDatabases: number;
    activeAgentsCount: number;
    activeOperatorsCount: number;
    activeTerminalsCount: number;
    shopAuditCount: number;
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
    shopAuditCount: number;
  }>;
}

interface SingleShopOverview {
  shop: {
    id: string;
    name: string;
    slug: string;
    status: string;
    dbName: string;
    dbStatus: string;
    dbSchemaVersion: string | null;
    currency: string;
    timezone: string;
    dailyReportTime: string;
    requireOperatorPin: boolean;
  };
  metrics: {
    activeAgentsCount: number;
    activeOperatorsCount: number;
    activeTerminalsCount: number;
    shopAuditCount: number;
  };
  recentShopEvents: Array<{
    id: string;
    action: string;
    entityType: string;
    declaredOperatorName: string | null;
    createdAt: string;
  }>;
}

export default function OwnerDashboardPage() {
  const { selectedShopId, setSelectedShopId, supportGrantId } = useAuth();
  const [consolidated, setConsolidated] = useState<ConsolidatedOverview | null>(null);
  const [shopOverview, setShopOverview] = useState<SingleShopOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (selectedShopId === 'ALL') {
        const res = await apiFetch<ConsolidatedOverview>('/merchant/overview', {
          supportGrantId,
        });
        setConsolidated(res);
        setShopOverview(null);
      } else {
        const res = await apiFetch<SingleShopOverview>(`/shops/${selectedShopId}/overview`, {
          shopId: selectedShopId,
          supportGrantId,
        });
        setShopOverview(res);
        setConsolidated(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors du chargement de la vue.');
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, supportGrantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell allowedRoles={['OWNER']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {selectedShopId === 'ALL'
                ? 'Vue consolidée multi-boutiques'
                : shopOverview?.shop.name || 'Synthèse boutique'}
            </h1>
            <p className="text-sm text-slate-600">
              {selectedShopId === 'ALL'
                ? 'Agrégation temps réel depuis la base PostgreSQL dédiée de chaque boutique.'
                : 'Données lues directement depuis la base dédiée isolée de cette boutique.'}
            </p>
          </div>
          {!supportGrantId ? (
            <Link
              href="/owner/shops"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              <Plus className="h-4 w-4" />
              Gérer mes boutiques
            </Link>
          ) : null}
        </div>

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : selectedShopId === 'ALL' && consolidated ? (
          consolidated.byShop.length === 0 ? (
            <EmptyState
              title="Aucune boutique configurée"
              description="Créez votre première boutique : ShopControl provisionnera automatiquement sa base de données dédiée."
              action={
                <Link
                  href="/owner/shops"
                  className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
                >
                  Créer ma première boutique
                </Link>
              }
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="Boutiques"
                  value={consolidated.totals.totalShops}
                  sub={`${consolidated.totals.activeShops} actives · ${consolidated.totals.readyDatabases} BDD prêtes`}
                  icon={Store}
                />
                <KpiCard
                  label="Comptes Agents"
                  value={consolidated.totals.activeAgentsCount}
                  sub="Cloisonnés par boutique"
                  icon={Users}
                />
                <KpiCard
                  label="Opérateurs déclarés"
                  value={consolidated.totals.activeOperatorsCount}
                  sub="Traçabilité comptoir"
                  icon={UserCheck}
                />
                <KpiCard
                  label="Terminaux comptoir"
                  value={consolidated.totals.activeTerminalsCount}
                  sub="Option B · Plages réservées"
                  icon={Laptop}
                />
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-base font-semibold text-slate-900">
                    Ventilation par boutique (bases de données isolées)
                  </h2>
                </div>
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Boutique</th>
                      <th className="px-4 py-3">Base dédiée</th>
                      <th className="px-4 py-3">Agents</th>
                      <th className="px-4 py-3">Opérateurs</th>
                      <th className="px-4 py-3">Terminaux</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3 text-right">Focus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {consolidated.byShop.map((s) => (
                      <tr key={s.shopId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{s.shopName}</p>
                          <p className="text-xs text-slate-500">/s/{s.slug}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-700">
                            <Database className="h-3.5 w-3.5 text-brand-700" />
                            {s.dbName}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium">{s.activeAgentsCount}</td>
                        <td className="px-4 py-3 font-medium">{s.activeOperatorsCount}</td>
                        <td className="px-4 py-3 font-medium">{s.activeTerminalsCount}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={s.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedShopId(s.shopId)}
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Ouvrir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : shopOverview ? (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-xs text-slate-600">
              <StatusBadge status={shopOverview.shop.status} />
              <StatusBadge status={shopOverview.shop.dbStatus} />
              <span className="inline-flex items-center gap-1 font-mono text-slate-800">
                <Database className="h-3.5 w-3.5 text-brand-700" />
                {shopOverview.shop.dbName}
              </span>
              <span>
                Devise : <strong>{shopOverview.shop.currency}</strong> · Fuseau :{' '}
                <strong>{shopOverview.shop.timezone}</strong> · Bilan :{' '}
                <strong>{shopOverview.shop.dailyReportTime}</strong>
              </span>
              <button
                type="button"
                onClick={() => setSelectedShopId('ALL')}
                className="ml-auto font-semibold text-brand-700 hover:underline"
              >
                ← Retour au consolidé
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Agents actifs"
                value={shopOverview.metrics.activeAgentsCount}
                sub="Rattachés uniquement ici"
                icon={Users}
              />
              <KpiCard
                label="Opérateurs déclarés"
                value={shopOverview.metrics.activeOperatorsCount}
                sub={shopOverview.shop.requireOperatorPin ? 'PIN obligatoire' : 'PIN facultatif'}
                icon={UserCheck}
              />
              <KpiCard
                label="Terminaux comptoir"
                value={shopOverview.metrics.activeTerminalsCount}
                sub="Plages hors-ligne allouées"
                icon={Laptop}
              />
              <KpiCard
                label="Événements audit BDD"
                value={shopOverview.metrics.shopAuditCount}
                sub="Chaîne locale immuable"
                icon={Database}
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-base font-semibold text-slate-900">
                Activité récente dans la base dédiée de {shopOverview.shop.name}
              </h2>
              {shopOverview.recentShopEvents.length === 0 ? (
                <p className="text-sm text-slate-500">Aucun événement opérationnel encore enregistré.</p>
              ) : (
                <div className="divide-y divide-slate-100 text-sm">
                  {shopOverview.recentShopEvents.map((ev) => (
                    <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <span className="font-mono text-xs font-semibold text-slate-800">
                          {ev.action}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">
                          {ev.entityType}
                          {ev.declaredOperatorName ? ` · Opérateur : ${ev.declaredOperatorName}` : ''}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {formatDateTimeInTimezone(ev.createdAt, shopOverview.shop.timezone)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-xs font-medium uppercase">{label}</span>
        <Icon className="h-5 w-5 text-brand-700" />
      </div>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}
