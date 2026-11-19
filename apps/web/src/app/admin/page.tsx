'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Database, KeyRound, ShieldAlert, Store } from 'lucide-react';
import { formatDateTimeInTimezone } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface AdminDashboardData {
  merchants: {
    total: number;
    ACTIVE: number;
    PAST_DUE: number;
    SUSPENDED: number;
    TERMINATED: number;
  };
  shops: {
    total: number;
    ACTIVE: number;
    SUSPENDED: number;
    dbReady: number;
    dbFailed: number;
  };
  security: {
    activeSessionsCount: number;
    activeSupportGrantsCount: number;
  };
  recentAudit: Array<{
    id: string;
    action: string;
    entityType: string;
    actorName: string | null;
    reason: string | null;
    createdAt: string;
  }>;
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<AdminDashboardData>('/admin/dashboard');
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger le tableau de bord.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell allowedRoles={['SUPER_ADMIN']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Tableau de bord plateforme</h1>
            <p className="text-sm text-slate-600">
              Supervision globale des marchands, bases boutiques dédiées et sécurité.
            </p>
          </div>
          <Link
            href="/admin/merchants"
            className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Gérer les marchands
          </Link>
        </div>

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-xs font-medium uppercase">Marchands</span>
                  <Building2 className="h-5 w-5 text-brand-700" />
                </div>
                <p className="mt-2 text-3xl font-bold text-slate-900">{data.merchants.total}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {data.merchants.ACTIVE} actifs · {data.merchants.SUSPENDED} suspendus
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-xs font-medium uppercase">Boutiques</span>
                  <Store className="h-5 w-5 text-brand-700" />
                </div>
                <p className="mt-2 text-3xl font-bold text-slate-900">{data.shops.total}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {data.shops.ACTIVE} actives · {data.shops.SUSPENDED} suspendues
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-xs font-medium uppercase">Bases BDD boutiques</span>
                  <Database className="h-5 w-5 text-emerald-600" />
                </div>
                <p className="mt-2 text-3xl font-bold text-slate-900">{data.shops.dbReady}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {data.shops.dbFailed > 0 ? (
                    <span className="font-semibold text-red-600">
                      {data.shops.dbFailed} en erreur de migration
                    </span>
                  ) : (
                    'Toutes isolées et prêtes'
                  )}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-xs font-medium uppercase">Sécurité active</span>
                  <KeyRound className="h-5 w-5 text-indigo-600" />
                </div>
                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {data.security.activeSessionsCount}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  sessions · {data.security.activeSupportGrantsCount} mandat(s) support actif(s)
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">
                  Activité d’administration récente
                </h2>
                <Link
                  href="/admin/security"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  Voir le journal complet →
                </Link>
              </div>
              {data.recentAudit.length === 0 ? (
                <p className="text-sm text-slate-500">Aucun événement récent.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.recentAudit.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-slate-400" />
                        <span className="font-mono text-xs font-semibold text-slate-800">
                          {item.action}
                        </span>
                        <span className="text-slate-500">
                          ({item.entityType}
                          {item.actorName ? ` · ${item.actorName}` : ''})
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {formatDateTimeInTimezone(item.createdAt)}
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
