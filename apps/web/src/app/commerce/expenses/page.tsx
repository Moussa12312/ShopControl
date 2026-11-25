'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Plus, XCircle } from 'lucide-react';
import { formatDateTimeInTimezone, formatXof } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface ExpenseCategory {
  id: string;
  name: string;
}

interface ShopExpenseRow {
  id: string;
  categoryName: string;
  amountXof: number;
  expenseDate: string;
  paymentMethodCode: string;
  paidFromCashDrawer: boolean;
  beneficiary: string | null;
  note: string | null;
  status: string;
  cancelReason: string | null;
}

interface CompanyExpenseRow {
  id: string;
  categoryName: string;
  amountXof: number;
  expenseDate: string;
  beneficiary: string | null;
  note: string | null;
  status: string;
}

export default function ExpensesPage() {
  const { activeOperator } = useAuth();
  const { shopId, selectShop, isOwner } = useActiveOperationalShop();

  const [tab, setTab] = useState<'shop' | 'company'>('shop');
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [shopExpenses, setShopExpenses] = useState<ShopExpenseRow[]>([]);
  const [shopTotal, setShopTotal] = useState(0);
  const [companyExpenses, setCompanyExpenses] = useState<CompanyExpenseRow[]>([]);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    categoryId: '',
    amountXof: 0,
    paidFromCashDrawer: true,
    beneficiary: '',
    note: '',
  });
  const [compForm, setCompForm] = useState({
    categoryName: 'Loyer siège / Abonnement',
    amountXof: 0,
    beneficiary: '',
    note: '',
  });
  const [cancelExpenseTarget, setCancelExpenseTarget] = useState<ShopExpenseRow | null>(null);
  const [cancelExpenseReason, setCancelExpenseReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (shopId) {
        const [cats, exp] = await Promise.all([
          apiFetch<ExpenseCategory[]>(`/shops/${shopId}/expense-categories`, { shopId }),
          apiFetch<{ totalActiveXof: number; items: ShopExpenseRow[] }>(`/shops/${shopId}/expenses`, {
            shopId,
          }),
        ]);
        setCategories(cats);
        setShopExpenses(exp.items);
        setShopTotal(exp.totalActiveXof);
        if (cats[0]) {
          setForm((f) => (f.categoryId && cats.some((c) => c.id === f.categoryId) ? f : { ...f, categoryId: cats[0].id }));
        }
      }
      if (isOwner) {
        const ce = await apiFetch<{ totalActiveXof: number; items: CompanyExpenseRow[] }>(
          '/merchant/expenses',
        );
        setCompanyExpenses(ce.items);
        setCompanyTotal(ce.totalActiveXof);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des dépenses.');
    } finally {
      setLoading(false);
    }
  }, [shopId, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateShopExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiFetch(`/shops/${shopId}/expenses`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          categoryId: form.categoryId,
          amountXof: Math.round(Number(form.amountXof)),
          paidFromCashDrawer: form.paidFromCashDrawer,
          paymentMethodCode: form.paidFromCashDrawer ? 'CASH' : 'OTHER',
          beneficiary: form.beneficiary || undefined,
          note: form.note || undefined,
        },
      });
      setForm((f) => ({ ...f, amountXof: 0, beneficiary: '', note: '' }));
      setMsg('Dépense boutique enregistrée.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement refusé.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelShopExpense = async () => {
    if (!cancelExpenseTarget || cancelExpenseReason.trim().length < 5) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/shops/${shopId}/expenses/${cancelExpenseTarget.id}/cancel`, {
        method: 'POST',
        shopId,
        body: { reason: cancelExpenseReason.trim() },
      });
      setCancelExpenseTarget(null);
      setCancelExpenseReason('');
      setMsg('Dépense boutique annulée et journalisée.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Annulation refusée.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCompanyExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/merchant/expenses', {
        method: 'POST',
        body: {
          categoryName: compForm.categoryName,
          amountXof: Math.round(Number(compForm.amountXof)),
          beneficiary: compForm.beneficiary || undefined,
          note: compForm.note || undefined,
        },
      });
      setCompForm((f) => ({ ...f, amountXof: 0, beneficiary: '', note: '' }));
      setMsg('Dépense commune d’entreprise enregistrée (vue consolidée).');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur dépense entreprise.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['OWNER', 'AGENT']}
      title="Dépenses"
      subtitle="Prises en compte dans le bénéfice net estimé ; décaissement automatique si payée depuis la caisse."
      headerActions={
        <>
          {isOwner ? (
            <div className="inline-flex rounded-full border border-white/10 bg-forest-800/80 p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab('shop')}
                className={`rounded-full px-3 py-1 transition ${
                  tab === 'shop' ? 'bg-white font-bold text-forest-950' : 'text-[#8aa8a2] hover:text-white'
                }`}
              >
                Boutique ({formatXof(shopTotal)})
              </button>
              <button
                type="button"
                onClick={() => setTab('company')}
                className={`rounded-full px-3 py-1 transition ${
                  tab === 'company' ? 'bg-white font-bold text-forest-950' : 'text-[#8aa8a2] hover:text-white'
                }`}
              >
                Entreprise ({formatXof(companyTotal)})
              </button>
            </div>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">

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
        ) : tab === 'shop' ? (
          <div className="space-y-4">
            <form
              onSubmit={handleCreateShopExpense}
              className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-5"
            >
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                required
                placeholder="Montant XOF *"
                value={form.amountXof || ''}
                onChange={(e) => setForm({ ...form, amountXof: Number(e.target.value) || 0 })}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
              />
              <input
                value={form.beneficiary}
                onChange={(e) => setForm({ ...form, beneficiary: e.target.value })}
                placeholder="Bénéficiaire"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={form.paidFromCashDrawer}
                  onChange={(e) => setForm({ ...form, paidFromCashDrawer: e.target.checked })}
                />
                Payée depuis la caisse
              </label>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                Enregistrer
              </button>
            </form>

            {shopExpenses.length === 0 ? (
              <EmptyState title="Aucune dépense boutique" description="Les charges enregistrées s’afficheront ici." />
            ) : (
              <>
                {/* Cartes mobiles (< md) */}
                <div className="space-y-2.5 md:hidden">
                  {shopExpenses.map((e) => (
                    <div
                      key={`m-${e.id}`}
                      className={`rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-xs ${
                        e.status === 'CANCELLED' ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {e.categoryName}
                          </p>
                          <p className="text-slate-500">
                            {e.beneficiary || '—'} ·{' '}
                            {e.paidFromCashDrawer ? 'Caisse espèces' : e.paymentMethodCode}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-bold text-slate-900">
                          {formatXof(e.amountXof)}
                        </span>
                      </div>
                      {e.cancelReason ? (
                        <p className="mt-1 text-red-600">Annulée : {e.cancelReason}</p>
                      ) : null}
                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                        <span className="text-[11px] text-slate-400">
                          {formatDateTimeInTimezone(e.expenseDate)}
                        </span>
                        {isOwner ? (
                          e.status === 'ACTIVE' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCancelExpenseTarget(e);
                                setCancelExpenseReason('');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Annuler
                            </button>
                          ) : (
                            <span className="text-xs font-semibold text-red-600">Annulée</span>
                          )
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tableau desktop (>= md) */}
                <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                      <tr>
                        <th className="px-4 py-3">Catégorie / Bénéficiaire</th>
                        <th className="px-4 py-3">Montant</th>
                        <th className="px-4 py-3">Mode</th>
                        <th className="px-4 py-3">Date</th>
                        {isOwner ? <th className="px-4 py-3 text-right">Action</th> : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shopExpenses.map((e) => (
                        <tr key={e.id} className={e.status === 'CANCELLED' ? 'opacity-50' : ''}>
                          <td className="px-4 py-2.5">
                            <p className="font-semibold text-slate-900">{e.categoryName}</p>
                            <p className="text-xs text-slate-500">
                              {e.beneficiary || '—'}{' '}
                              {e.cancelReason ? `· Annulée : ${e.cancelReason}` : ''}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 font-bold text-slate-900">
                            {formatXof(e.amountXof)}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">
                            {e.paidFromCashDrawer ? 'Caisse espèces' : e.paymentMethodCode}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">
                            {formatDateTimeInTimezone(e.expenseDate)}
                          </td>
                          {isOwner ? (
                            <td className="px-4 py-2.5 text-right">
                              {e.status === 'ACTIVE' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCancelExpenseTarget(e);
                                    setCancelExpenseReason('');
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Annuler
                                </button>
                              ) : (
                                <span className="text-xs text-red-600">Annulée</span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <form
              onSubmit={handleCreateCompanyExpense}
              className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-4 sm:p-5"
            >
              <input
                required
                value={compForm.categoryName}
                onChange={(e) => setCompForm({ ...compForm, categoryName: e.target.value })}
                placeholder="Catégorie entreprise *"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                min={1}
                required
                placeholder="Montant XOF *"
                value={compForm.amountXof || ''}
                onChange={(e) => setCompForm({ ...compForm, amountXof: Number(e.target.value) || 0 })}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
              />
              <input
                value={compForm.beneficiary}
                onChange={(e) => setCompForm({ ...compForm, beneficiary: e.target.value })}
                placeholder="Bénéficiaire / Note"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
              >
                Ajouter (Consolidé)
              </button>
            </form>

            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              {companyExpenses.length === 0 ? (
                <p className="py-6 text-center text-slate-500">Aucune dépense commune d’entreprise.</p>
              ) : (
                companyExpenses.map((ce) => (
                  <div key={ce.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="font-semibold text-slate-900">{ce.categoryName}</p>
                      <p className="text-xs text-slate-500">
                        {ce.beneficiary || '—'} · {formatDateTimeInTimezone(ce.expenseDate)}
                      </p>
                    </div>
                    <span className="font-bold text-slate-900">{formatXof(ce.amountXof)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {cancelExpenseTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">
                Annuler la dépense ({formatXof(cancelExpenseTarget.amountXof)})
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                La dépense reste visible dans l’historique avec mention ANNULÉE (aucune suppression
                physique).
              </p>
              <textarea
                rows={3}
                required
                value={cancelExpenseReason}
                onChange={(e) => setCancelExpenseReason(e.target.value)}
                placeholder="Motif d’annulation obligatoire (5+ caractères)…"
                className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm"
              />
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setCancelExpenseTarget(null)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 sm:w-auto"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={busy || cancelExpenseReason.trim().length < 5}
                  onClick={handleCancelShopExpense}
                  className="w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                >
                  Confirmer l’annulation
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
