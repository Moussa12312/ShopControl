'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { formatDateTimeInTimezone } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface SupportGrantRow {
  id: string;
  merchant: { id: string; name: string };
  superAdmin: { fullName: string; email: string };
  reason: string;
  readOnly: boolean;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
}

interface AuditRow {
  id: string;
  sequenceNumber: string;
  action: string;
  entityType: string;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export default function AdminSecurityPage() {
  const [grants, setGrants] = useState<SupportGrantRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [integrity, setIntegrity] = useState<{ valid: boolean; checkedCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, a] = await Promise.all([
        apiFetch<SupportGrantRow[]>('/admin/support-access'),
        apiFetch<{ items: AuditRow[] }>('/admin/audit-logs?limit=30'),
      ]);
      setGrants(g);
      setAudits(a.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement sécurité.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerifyChain = async () => {
    const res = await apiFetch<{ control: { valid: boolean; checkedCount: number } }>(
      '/audit-logs/verify-integrity',
    );
    setIntegrity(res.control);
  };

  const handleRevokeGrant = async (grantId: string) => {
    await apiFetch(`/admin/support-access/${grantId}`, { method: 'DELETE' });
    await load();
  };

  return (
    <AppShell
      allowedRoles={['SUPER_ADMIN']}
      title="Sécurité & Journaux d’audit"
      subtitle="Mandats d’assistance exceptionnels et journal plateforme immuable."
      headerActions={
        <button type="button" onClick={handleVerifyChain} className="sc-hero-btn-primary">
          <ShieldCheck className="h-3.5 w-3.5 text-brand-700" />
          Vérifier l’intégrité SHA-256
        </button>
      }
    >
      <div className="space-y-5">

        {integrity ? (
          <div
            className={`flex items-center gap-2 rounded-xl border p-4 text-sm font-medium ${
              integrity.valid
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            {integrity.valid ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            <span>
              {integrity.valid
                ? `Chaîne d’audit intègre (${integrity.checkedCount} entrées vérifiées).`
                : 'Alerte : rupture détectée dans la chaîne cryptographique d’audit.'}
            </span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-base font-semibold text-slate-900">
                Mandats d’accès d’assistance
              </h2>
              {grants.length === 0 ? (
                <p className="text-sm text-slate-500">Aucun mandat d’assistance émis.</p>
              ) : (
                <div className="divide-y divide-slate-100 text-sm">
                  {grants.map((g) => (
                    <div key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {g.merchant.name}{' '}
                          <span className="text-xs font-normal text-slate-500">
                            ({g.readOnly ? 'Lecture seule' : 'Étendu'})
                          </span>
                        </p>
                        <p className="text-xs text-slate-600">{g.reason}</p>
                        <p className="text-[11px] text-slate-400">
                          Par {g.superAdmin.fullName} · Expire : {formatDateTimeInTimezone(g.expiresAt)}
                        </p>
                      </div>
                      {g.active ? (
                        <button
                          type="button"
                          onClick={() => handleRevokeGrant(g.id)}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          Clôturer maintenant
                        </button>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                          Terminé
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3.5 sm:px-5 sm:py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Journal d’audit plateforme (immuable)
                </h2>
              </div>

              {/* Mobile cards (< md) */}
              <div className="divide-y divide-slate-100 md:hidden">
                {audits.map((row) => (
                  <div key={`m-${row.id}`} className="space-y-1 p-4 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex min-w-0 items-center gap-1.5 break-all font-mono font-semibold text-slate-900">
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        {row.action}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-400">
                        #{row.sequenceNumber}
                      </span>
                    </div>
                    <p className="text-slate-600">
                      {row.actorName || 'Système'}
                      {row.actorRole ? ` (${row.actorRole})` : ''}
                    </p>
                    {row.reason ? <p className="text-slate-500">{row.reason}</p> : null}
                    <p className="text-[11px] text-slate-400">
                      {formatDateTimeInTimezone(row.createdAt)}
                    </p>
                  </div>
                ))}
              </div>

              {/* Desktop table (>= md) */}
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Auteur</th>
                      <th className="px-4 py-3">Motif</th>
                      <th className="px-4 py-3">Date (Bamako)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {audits.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                          {row.sequenceNumber}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-800">
                            <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />
                            {row.action}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-700">
                          {row.actorName || 'Système'}{' '}
                          {row.actorRole ? <span className="text-slate-400">({row.actorRole})</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">{row.reason || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {formatDateTimeInTimezone(row.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
