'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Database, ShieldCheck, XCircle } from 'lucide-react';
import { formatDateTimeInTimezone } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface AuditRow {
  id: string;
  source: 'CONTROL' | 'SHOP_DB';
  sequenceNumber: string;
  shopName: string | null;
  actorName: string | null;
  actorRole: string | null;
  declaredOperatorName: string | null;
  action: string;
  entityType: string;
  reason: string | null;
  createdAt: string;
}

export default function OwnerAuditPage() {
  const { selectedShopId, supportGrantId } = useAuth();
  const [items, setItems] = useState<AuditRow[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<{
    allValid: boolean;
    control: { valid: boolean; checkedCount: number };
    shops: Array<{ shopName: string; valid: boolean; checkedCount: number }>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '40' });
      if (selectedShopId !== 'ALL') qs.set('shopId', selectedShopId);
      if (actionFilter.trim()) qs.set('action', actionFilter.trim());
      const res = await apiFetch<{ items: AuditRow[] }>(`/audit-logs?${qs.toString()}`, {
        supportGrantId,
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement du journal d’audit.');
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, actionFilter, supportGrantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerifyIntegrity = async () => {
    try {
      setError(null);
      const qs = selectedShopId !== 'ALL' ? `?shopId=${selectedShopId}` : '';
      const res = await apiFetch<{
        allValid: boolean;
        control: { valid: boolean; checkedCount: number };
        shops: Array<{ shopName: string; valid: boolean; checkedCount: number }>;
      }>(`/audit-logs/verify-integrity${qs}`, { supportGrantId });
      setIntegrity(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vérification d’intégrité impossible.');
    }
  };

  return (
    <AppShell
      allowedRoles={['OWNER']}
      title="Journal d’audit immuable"
      subtitle="Traçabilité consolidée (plateforme + bases dédiées des boutiques), avec compte et opérateur déclaré."
      headerActions={
        <button type="button" onClick={handleVerifyIntegrity} className="sc-hero-btn-primary">
          <ShieldCheck className="h-3.5 w-3.5 text-brand-700" />
          Vérifier l’intégrité SHA-256
        </button>
      }
    >
      <div className="space-y-5">

        {integrity ? (
          <div
            className={`rounded-2xl border p-4 text-sm ${
              integrity.allValid
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {integrity.allValid ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
              <span>
                {integrity.allValid
                  ? 'Toutes les chaînes cryptographiques d’audit sont intactes.'
                  : 'Anomalie détectée dans une chaîne d’audit.'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-white/80 px-2 py-1">
                Control DB : {integrity.control.checkedCount} entrées ({integrity.control.valid ? 'OK' : 'KO'})
              </span>
              {integrity.shops.map((s) => (
                <span key={s.shopName} className="rounded-md bg-white/80 px-2 py-1">
                  {s.shopName} : {s.checkedCount} entrées ({s.valid ? 'OK' : 'KO'})
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex gap-3">
          <input
            type="search"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Filtrer par code d’action (ex. SHOP_CREATED, TERMINAL_REGISTERED)…"
            className="w-full max-w-md rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm"
          />
        </div>

        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Aucune entrée d’audit"
            description="Les opérations sensibles sur votre entreprise et vos boutiques apparaîtront automatiquement ici."
          />
        ) : (
          <>
            {/* Mobile cards (< md) */}
            <div className="space-y-2.5 md:hidden">
              {items.map((row) => (
                <div
                  key={`m-${row.source}-${row.id}`}
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        row.source === 'SHOP_DB'
                          ? 'bg-brand-50 text-brand-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      <Database className="h-3 w-3" />
                      {row.source === 'SHOP_DB' ? 'Base boutique' : 'Plateforme'}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {formatDateTimeInTimezone(row.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono font-bold text-slate-900">{row.action}</p>
                  {row.reason ? <p className="mt-0.5 text-slate-600">{row.reason}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-slate-600">
                    <span>{row.shopName || 'Entreprise'}</span>
                    <span>·</span>
                    <span>{row.actorName || 'Système'}</span>
                    {row.declaredOperatorName ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">
                        Op. {row.declaredOperatorName}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table (>= md) */}
            <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Boutique</th>
                    <th className="px-4 py-3">Compte / Opérateur déclaré</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row) => (
                    <tr key={`${row.source}-${row.id}`}>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            row.source === 'SHOP_DB'
                              ? 'bg-brand-50 text-brand-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          <Database className="h-3 w-3" />
                          {row.source === 'SHOP_DB' ? 'Base boutique' : 'Plateforme'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-mono text-xs font-semibold text-slate-900">{row.action}</p>
                        {row.reason ? <p className="text-xs text-slate-500">{row.reason}</p> : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-700">{row.shopName || 'Entreprise'}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-700">
                        <span>{row.actorName || 'Système'}</span>
                        {row.declaredOperatorName ? (
                          <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">
                            Opérateur : {row.declaredOperatorName}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {formatDateTimeInTimezone(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
