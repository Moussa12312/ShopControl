'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Database,
  KeyRound,
  Plus,
  ShieldAlert,
  Sparkles,
  Store,
} from 'lucide-react';
import { formatDateTimeInTimezone } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { HealthBarPill } from '@/components/ui/AnalyticsChart';
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
  const { user } = useAuth();
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

  const dbHealth: 'OK' | 'CRITICAL' = (data?.shops.dbFailed ?? 0) > 0 ? 'CRITICAL' : 'OK';

  const heroSection = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[26px]">
            Bonjour {user?.fullName.split(' ')[0] || 'Admin'} !
          </h1>
          <p className="mt-0.5 text-xs text-emerald-200/70">
            Supervision plateforme ShopControl · Isolation Control Plane + bases boutiques dédiées
          </p>
        </div>
        <Link
          href="/admin/merchants"
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-forest-900 shadow-sm hover:bg-emerald-50"
        >
          <span>Nouveau marchand</span>
          <Plus className="h-4 w-4 stroke-[2.5]" />
        </Link>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-forest-800/85 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-emerald-200">
              <Building2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-medium text-[#98b3ae]">Marchands</p>
              <p className="mt-0.5 text-xl font-bold text-white">{data?.merchants.total ?? 0}</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[#7c9994]">
            <span className="font-semibold text-emerald-400">
              {data?.merchants.ACTIVE ?? 0} actifs
            </span>{' '}
            · {data?.merchants.SUSPENDED ?? 0} suspendus
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-forest-800/85 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-emerald-200">
              <Store className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-medium text-[#98b3ae]">Boutiques actives</p>
              <p className="mt-0.5 text-xl font-bold text-white">{data?.shops.total ?? 0}</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[#7c9994]">
            {data?.shops.ACTIVE ?? 0} en ligne · {data?.shops.SUSPENDED ?? 0} suspendues
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-forest-800/85 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-emerald-200">
                <Database className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-medium text-[#98b3ae]">Bases BDD dédiées</p>
                <p className="mt-0.5 text-xl font-bold text-white">{data?.shops.dbReady ?? 0}</p>
              </div>
            </div>
            <HealthBarPill level={dbHealth} label={dbHealth === 'OK' ? 'Sain' : 'Erreur'} />
          </div>
          <p className="mt-3 text-[11px] text-[#7c9994]">
            {data?.shops.dbFailed ?? 0} erreur(s) de migration
          </p>
        </div>

        <div className="lime-glow-card flex flex-col justify-between rounded-2xl border border-limeglow-400/25 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-white">
                {data?.security.activeSessionsCount ?? 0}{' '}
                <span className="text-xs font-medium text-emerald-100/80">Sessions</span>
              </p>
              <p className="text-xs font-semibold text-emerald-50">
                {data?.security.activeSupportGrantsCount ?? 0} mandat(s) support
              </p>
              <p className="mt-0.5 text-[11px] text-emerald-200/75">Audit SHA-256 actif</p>
            </div>
            <Link
              href="/admin/security"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-limeglow-400 px-3.5 py-2 text-xs font-bold text-forest-950 hover:bg-lime-300"
            >
              <span>Audit</span>
              <Sparkles className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <AppShell allowedRoles={['SUPER_ADMIN']} hero={heroSection}>
      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : data ? (
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-brand-700" />
              <h2 className="text-base font-bold text-slate-900">
                Activité d’administration et de sécurité récente
              </h2>
            </div>
            <Link
              href="/admin/security"
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              Journal complet →
            </Link>
          </div>
          {data.recentAudit.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun événement récent.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recentAudit.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                      <ShieldAlert className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-mono text-xs font-bold text-slate-900">{item.action}</p>
                      <p className="text-xs text-slate-500">
                        {item.entityType}
                        {item.actorName ? ` · ${item.actorName}` : ''}
                        {item.reason ? ` — ${item.reason}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">
                    {formatDateTimeInTimezone(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </AppShell>
  );
}
