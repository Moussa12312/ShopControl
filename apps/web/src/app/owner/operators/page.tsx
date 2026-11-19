'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, UserCheck } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface OperatorRow {
  id: string;
  firstName: string;
  hasPin: boolean;
  isActive: boolean;
  createdAt: string;
}

export default function OwnerOperatorsPage() {
  const { shops, selectedShopId, supportGrantId } = useAuth();
  const [targetShopId, setTargetShopId] = useState(
    selectedShopId !== 'ALL' ? selectedShopId : shops[0]?.shopId || '',
  );
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [pin, setPin] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedShopId !== 'ALL') {
      setTargetShopId(selectedShopId);
    } else if (shops[0]) {
      setTargetShopId((prev) => (prev && shops.some((s) => s.shopId === prev) ? prev : shops[0].shopId));
    }
  }, [selectedShopId, shops]);

  const load = useCallback(async () => {
    if (!targetShopId) {
      setOperators([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<OperatorRow[]>(`/shops/${targetShopId}/operators`, {
        shopId: targetShopId,
        supportGrantId,
      });
      setOperators(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des opérateurs.');
    } finally {
      setLoading(false);
    }
  }, [targetShopId, supportGrantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetShopId) return;
    setFormError(null);
    setBusy(true);
    try {
      await apiFetch(`/shops/${targetShopId}/operators`, {
        method: 'POST',
        shopId: targetShopId,
        body: { firstName, pin: pin.trim() || undefined },
      });
      setFirstName('');
      setPin('');
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (op: OperatorRow) => {
    await apiFetch(`/shops/${targetShopId}/operators/${op.id}`, {
      method: 'PATCH',
      shopId: targetShopId,
      body: { isActive: !op.isActive },
    });
    await load();
  };

  return (
    <AppShell
      allowedRoles={['OWNER']}
      title="Opérateurs déclarés"
      subtitle="Prénoms stockés dans la base dédiée de chaque boutique pour tracer les opérations au comptoir."
      headerActions={
        shops.length > 0 ? (
          <select
            value={targetShopId}
            onChange={(e) => setTargetShopId(e.target.value)}
            aria-label="Choisir une boutique"
            className="rounded-full border border-white/15 bg-forest-800/90 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {shops.map((s) => (
              <option key={s.shopId} value={s.shopId} className="bg-forest-900 text-white">
                {s.shopName}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      <div className="space-y-5">

        {!supportGrantId && targetShopId ? (
          <form
            onSubmit={handleCreate}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <h2 className="text-sm font-semibold text-slate-900">Ajouter un opérateur déclaré</h2>
            {formError ? (
              <p className="mt-2 text-xs text-red-700">{formError}</p>
            ) : null}
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Prénom (ex. Aminata, Sékou…)"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm sm:min-w-[180px] sm:flex-1"
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="PIN 4–6 chiffres (optionnel)"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm sm:w-56"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-forest-900 px-4 py-2 text-sm font-semibold text-white hover:bg-forest-800 disabled:opacity-50 sm:w-auto"
              >
                <Plus className="h-4 w-4" />
                Ajouter
              </button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : operators.length === 0 ? (
          <EmptyState
            title="Aucun opérateur déclaré"
            description="Ajoutez les prénoms des membres de votre équipe qui utilisent le terminal partagé de cette boutique."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {operators.map((op) => (
              <div
                key={op.id}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{op.firstName}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                      <KeyRound className="h-3 w-3" />
                      {op.hasPin ? 'PIN configuré' : 'Sans PIN'} ·{' '}
                      {op.isActive ? 'Actif' : 'Désactivé'}
                    </p>
                  </div>
                </div>
                {!supportGrantId ? (
                  <button
                    type="button"
                    onClick={() => handleToggleActive(op)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {op.isActive ? 'Désactiver' : 'Réactiver'}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
