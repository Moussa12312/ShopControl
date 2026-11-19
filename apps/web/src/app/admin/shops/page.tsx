'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Database, ExternalLink, RefreshCw } from 'lucide-react';
import { TenantStatus, TENANT_STATUSES, TENANT_STATUS_LABELS } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import {
  ConfirmModal,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '@/components/ui/StateViews';

interface AdminShopRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  dbName: string;
  dbStatus: string;
  dbSchemaVersion: string | null;
  merchant: { id: string; name: string; status: TenantStatus };
  createdAt: string;
}

export default function AdminShopsPage() {
  const [items, setItems] = useState<AdminShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusModal, setStatusModal] = useState<{
    shop: AdminShopRow;
    nextStatus: TenantStatus;
    reason: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: AdminShopRow[] }>('/admin/shops');
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des boutiques.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApplyStatus = async () => {
    if (!statusModal) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/shops/${statusModal.shop.id}/status`, {
        method: 'PATCH',
        body: { status: statusModal.nextStatus, reason: statusModal.reason },
      });
      setStatusModal(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de modifier le statut.');
    } finally {
      setBusy(false);
    }
  };

  const handleRetryProvision = async (shopId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/admin/shops/${shopId}/retry-provision`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du provisionnement BDD.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['SUPER_ADMIN']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Boutiques & Bases de données dédiées</h1>
          <p className="text-sm text-slate-600">
            Chaque boutique dispose de sa propre base PostgreSQL isolée et migrée automatiquement.
          </p>
        </div>

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Aucune boutique sur la plateforme"
            description="Les boutiques apparaîtront ici dès leur création par un marchand ou depuis l’écran Marchands."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3">Boutique</th>
                  <th className="px-4 py-3">Marchand</th>
                  <th className="px-4 py-3">Base PostgreSQL dédiée</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((shop) => (
                  <tr key={shop.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{shop.name}</p>
                      <Link
                        href={`/s/${shop.slug}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                      >
                        /s/{shop.slug}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{shop.merchant.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-slate-400" />
                        <code className="text-xs font-mono text-slate-800">{shop.dbName}</code>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusBadge status={shop.dbStatus} />
                        {shop.dbSchemaVersion ? (
                          <span className="text-[11px] text-slate-400">{shop.dbSchemaVersion}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={shop.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {shop.dbStatus !== 'READY' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRetryProvision(shop.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Migrer BDD
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() =>
                            setStatusModal({
                              shop,
                              nextStatus: shop.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                              reason: '',
                            })
                          }
                          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Statut
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ConfirmModal
          open={Boolean(statusModal)}
          title={`Statut de la boutique ${statusModal?.shop.name || ''}`}
          description="Une boutique suspendue passe en lecture seule et sa vitrine affiche « Boutique momentanément indisponible ». Ses données sont préservées."
          confirmLabel="Enregistrer"
          danger={statusModal?.nextStatus === 'SUSPENDED'}
          busy={busy}
          onCancel={() => setStatusModal(null)}
          onConfirm={handleApplyStatus}
        >
          {statusModal ? (
            <div className="space-y-3">
              <select
                value={statusModal.nextStatus}
                onChange={(e) =>
                  setStatusModal({ ...statusModal, nextStatus: e.target.value as TenantStatus })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {TENANT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TENANT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <textarea
                rows={2}
                required
                value={statusModal.reason}
                onChange={(e) => setStatusModal({ ...statusModal, reason: e.target.value })}
                placeholder="Motif obligatoire…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          ) : null}
        </ConfirmModal>
      </div>
    </AppShell>
  );
}
