'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Plus, Receipt } from 'lucide-react';
import { formatXof } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface ClientRow {
  id: string;
  fullName: string;
  phone: string;
  address: string | null;
  creditLimitXof: number;
  outstandingDebtXof: number;
  salesCount: number;
}

interface ReceivableRow {
  id: string;
  status: string;
  initialAmountXof: number;
  paidAmountXof: number;
  remainingAmountXof: number;
  ageDays: number;
  client: { id: string; fullName: string; phone: string };
  sale: { id: string; saleNumber: string; totalXof: number };
}

export default function ClientsReceivablesPage() {
  const { activeOperator } = useAuth();
  const { shopId, selectShop } = useActiveOperationalShop();

  const [tab, setTab] = useState<'clients' | 'receivables'>('clients');
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ fullName: '', phone: '', address: '', creditLimitXof: 0 });
  const [payTarget, setPayTarget] = useState<ReceivableRow | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('CASH');
  const [payRef, setPayRef] = useState('');

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cl, rec] = await Promise.all([
        apiFetch<ClientRow[]>(`/shops/${shopId}/clients`, { shopId }),
        apiFetch<ReceivableRow[]>(`/shops/${shopId}/receivables`, { shopId }).catch(() => []),
      ]);
      setClients(cl);
      setReceivables(rec);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement clients/créances.');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/shops/${shopId}/clients`, {
        method: 'POST',
        shopId,
        body: {
          fullName: form.fullName,
          phone: form.phone,
          address: form.address || undefined,
          creditLimitXof: Math.round(Number(form.creditLimitXof) || 0),
        },
      });
      setForm({ fullName: '', phone: '', address: '', creditLimitXof: 0 });
      setMsg('Client créé.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handlePayReceivable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !payTarget) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/shops/${shopId}/receivables/${payTarget.id}/payments`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          amountXof: payAmount,
          paymentMethodCode: payMethod,
          transactionRef: payRef.trim() || undefined,
        },
      });
      setPayTarget(null);
      setPayRef('');
      setMsg('Encaissement de créance enregistré.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Encaissement refusé.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Clients & Créances</h1>
            <p className="text-sm text-slate-600">
              Plafonds de crédit par client, suivi d’ancienneté et encaissements partiels ou totaux.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShopPickerInline shopId={shopId} onChange={selectShop} />
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab('clients')}
                className={`rounded-lg px-3 py-1.5 ${tab === 'clients' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
              >
                Clients ({clients.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('receivables')}
                className={`rounded-lg px-3 py-1.5 ${tab === 'receivables' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
              >
                Créances ouvertes ({receivables.length})
              </button>
            </div>
          </div>
        </div>

        {msg ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : tab === 'clients' ? (
          <div className="space-y-4">
            <form
              onSubmit={handleCreateClient}
              className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-5"
            >
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="Nom complet *"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Téléphone *"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Quartier / Adresse"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                min={0}
                value={form.creditLimitXof || ''}
                onChange={(e) => setForm({ ...form, creditLimitXof: Number(e.target.value) || 0 })}
                placeholder="Plafond crédit XOF"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                Ajouter
              </button>
            </form>

            {clients.length === 0 ? (
              <EmptyState title="Aucun client" description="Ajoutez vos clients réguliers ou crédits." />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Client</th>
                      <th className="px-4 py-3">Plafond crédit</th>
                      <th className="px-4 py-3">Encours dû</th>
                      <th className="px-4 py-3">Ventes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clients.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{c.fullName}</p>
                          <p className="text-xs text-slate-500">
                            {c.phone}
                            {c.address ? ` · ${c.address}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{formatXof(c.creditLimitXof)}</td>
                        <td className="px-4 py-3 text-xs font-bold">
                          <span className={c.outstandingDebtXof > 0 ? 'text-amber-800' : 'text-emerald-700'}>
                            {formatXof(c.outstandingDebtXof)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{c.salesCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : receivables.length === 0 ? (
          <EmptyState
            title="Aucune créance en attente"
            description="Les ventes payées partiellement ou à crédit apparaîtront ici avec leur ancienneté."
          />
        ) : (
          <div className="space-y-3">
            {receivables.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-brand-700" />
                    <span className="font-bold text-slate-900">{r.client.fullName}</span>
                    <span className="text-xs text-slate-500">({r.client.phone})</span>
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      Ancienneté : {r.ageDays} j
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Vente <code className="font-mono font-bold">{r.sale.saleNumber}</code> · Initial :{' '}
                    {formatXof(r.initialAmountXof)} · Payé : {formatXof(r.paidAmountXof)} ·{' '}
                    <strong className="text-red-700">Reste dû : {formatXof(r.remainingAmountXof)}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPayTarget(r);
                    setPayAmount(r.remainingAmountXof);
                    setPayMethod('CASH');
                    setPayRef('');
                  }}
                  className="rounded-xl bg-brand-700 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-800"
                >
                  Encaisser règlement
                </button>
              </div>
            ))}
          </div>
        )}

        {payTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form onSubmit={handlePayReceivable} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold text-slate-900">
                Encaissement créance — {payTarget.client.fullName}
              </h3>
              <p className="text-xs text-slate-600">
                Solde dû : <strong>{formatXof(payTarget.remainingAmountXof)}</strong>
              </p>
              <input
                type="number"
                min={1}
                max={payTarget.remainingAmountXof}
                required
                value={payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
              />
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="CASH">Espèces (entrée en caisse)</option>
                <option value="ORANGE_MONEY">Orange Money</option>
                <option value="WAVE">Wave</option>
              </select>
              {payMethod !== 'CASH' ? (
                <input
                  required
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Référence transaction obligatoire"
                  className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm font-mono"
                />
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Encaisser
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
