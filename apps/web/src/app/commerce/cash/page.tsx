'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, Lock, Unlock } from 'lucide-react';
import { formatDateTimeInTimezone, formatXof } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import {
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface CurrentCashSession {
  id: string;
  register: { id: string; name: string };
  openingAmountXof: number;
  theoreticalAmountXof: number;
  openedByOperatorName: string | null;
  openedAt: string;
  overdueAlert24h: boolean;
  movements: Array<{
    id: string;
    type: string;
    amountXof: number;
    signedAmountXof: number;
    reason: string | null;
    declaredOperatorName: string | null;
    createdAt: string;
  }>;
}

interface SessionHistoryRow {
  id: string;
  registerName: string;
  status: 'OPEN' | 'CLOSED';
  openingAmountXof: number;
  theoreticalAmountXof: number;
  countedAmountXof: number | null;
  discrepancyXof: number | null;
  openedByOperatorName: string | null;
  closedByOperatorName: string | null;
  openedAt: string;
  closedAt: string | null;
}

export default function CashPage() {
  const { activeOperator } = useAuth();
  const { shopId, selectShop } = useActiveOperationalShop();

  const [current, setCurrent] = useState<CurrentCashSession | null>(null);
  const [history, setHistory] = useState<SessionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [openingAmount, setOpeningAmount] = useState(0);
  const [mvType, setMvType] = useState<'MANUAL_IN' | 'MANUAL_OUT'>('MANUAL_IN');
  const [mvAmount, setMvAmount] = useState(0);
  const [mvReason, setMvReason] = useState('');
  const [countedClose, setCountedClose] = useState('');
  const [closeNotes, setCloseNotes] = useState('');

  const [regTarget, setRegTarget] = useState<SessionHistoryRow | null>(null);
  const [regType, setRegType] = useState<'REGULARIZATION_IN' | 'REGULARIZATION_OUT'>('REGULARIZATION_IN');
  const [regAmount, setRegAmount] = useState(0);
  const [regReason, setRegReason] = useState('');

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [curr, list] = await Promise.all([
        apiFetch<CurrentCashSession | null>(`/shops/${shopId}/cash/sessions/current`, { shopId }),
        apiFetch<SessionHistoryRow[]>(`/shops/${shopId}/cash/sessions`, { shopId }),
      ]);
      setCurrent(curr);
      setHistory(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement de la caisse.');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiFetch(`/shops/${shopId}/cash/sessions/open`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { openingAmountXof: Math.round(Number(openingAmount) || 0) },
      });
      setMsg('Session de caisse ouverte.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ouverture impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleManualMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !current) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/shops/${shopId}/cash/sessions/${current.id}/movements`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { type: mvType, amountXof: Math.round(Number(mvAmount)), reason: mvReason },
      });
      setMvAmount(0);
      setMvReason('');
      setMsg('Mouvement de caisse enregistré.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mouvement refusé.');
    } finally {
      setBusy(false);
    }
  };

  const handleCloseSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !current || countedClose.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const closed = await apiFetch<{ discrepancyXof: number }>(
        `/shops/${shopId}/cash/sessions/${current.id}/close`,
        {
          method: 'POST',
          shopId,
          operatorId: activeOperator?.id,
          body: {
            countedAmountXof: Math.round(Number(countedClose)),
            notes: closeNotes.trim() || undefined,
          },
        },
      );
      setCountedClose('');
      setCloseNotes('');
      setMsg(
        `Session clôturée définitivement. Écart constaté : ${formatXof(closed.discrepancyXof ?? 0)}${
          closed.discrepancyXof !== 0 ? ' (propriétaire notifié)' : ''
        }.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Clôture refusée.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegularize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !regTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/cash/sessions/${regTarget.id}/regularize`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: { type: regType, amountXof: Math.round(Number(regAmount)), reason: regReason },
      });
      setRegTarget(null);
      setRegAmount(0);
      setRegReason('');
      setMsg('Régularisation motivée enregistrée sur la clôture.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Régularisation refusée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['OWNER', 'AGENT']}
      title="Caisse & Clôtures"
      subtitle="Session rattachée à la boutique · Solde théorique temps réel · Clôture immuable avec alerte d’écart."
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
        ) : (
          <>
            {!current ? (
              <form
                onSubmit={handleOpenSession}
                className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"
              >
                <div className="flex items-center gap-2">
                  <Unlock className="h-5 w-5 text-brand-700" />
                  <h2 className="text-base font-bold text-slate-900">Ouvrir une session de caisse</h2>
                </div>
                <p className="text-xs text-slate-600">
                  Une session ouverte est requise pour encaisser des ventes ou décaisser des dépenses
                  en espèces.
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Fond de caisse initial (XOF)
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={openingAmount}
                    onChange={(e) => setOpeningAmount(Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-base font-bold"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 sm:w-auto"
                >
                  Ouvrir la caisse
                </button>
              </form>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
                <div className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Banknote className="h-5 w-5 shrink-0 text-emerald-600" />
                      <h2 className="truncate text-sm font-bold text-slate-900 sm:text-base">
                        Session ouverte — {current.register.name}
                      </h2>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                      OUVERTE
                    </span>
                  </div>

                  {current.overdueAlert24h ? (
                    <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                      <AlertTriangle className="h-4 w-4 text-amber-700" />
                      Cette session est ouverte depuis plus de 24 h. Pensez à la clôturer.
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-slate-500">Fond initial</p>
                      <p className="text-lg font-bold text-slate-900">
                        {formatXof(current.openingAmountXof)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Solde théorique actuel</p>
                      <p className="text-lg font-bold text-brand-800">
                        {formatXof(current.theoreticalAmountXof)}
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleManualMove} className="space-y-2.5 border-t border-slate-100 pt-4">
                    <h3 className="text-xs font-bold uppercase text-slate-600">
                      Mouvement manuel motivé
                    </h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <select
                        value={mvType}
                        onChange={(e) => setMvType(e.target.value as 'MANUAL_IN' | 'MANUAL_OUT')}
                        className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs sm:py-1.5"
                      >
                        <option value="MANUAL_IN">Encaissement (+)</option>
                        <option value="MANUAL_OUT">Décaissement (-)</option>
                      </select>
                      <input
                        type="number"
                        min={1}
                        required
                        placeholder="Montant XOF"
                        value={mvAmount || ''}
                        onChange={(e) => setMvAmount(Number(e.target.value) || 0)}
                        className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs sm:py-1.5"
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        required
                        value={mvReason}
                        onChange={(e) => setMvReason(e.target.value)}
                        placeholder="Motif obligatoire…"
                        className="flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs sm:py-1.5"
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full rounded-lg bg-forest-900 px-3 py-2 text-xs font-semibold text-white sm:w-auto sm:py-1.5"
                      >
                        Ajouter
                      </button>
                    </div>
                  </form>

                  <form onSubmit={handleCloseSession} className="space-y-2.5 border-t border-slate-100 pt-4">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-red-700">
                      <Lock className="h-3.5 w-3.5" />
                      Clôturer définitivement la caisse
                    </div>
                    <input
                      type="number"
                      min={0}
                      required
                      value={countedClose}
                      onChange={(e) => setCountedClose(e.target.value)}
                      placeholder="Montant réellement compté en caisse (XOF)"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
                    />
                    <input
                      value={closeNotes}
                      onChange={(e) => setCloseNotes(e.target.value)}
                      placeholder="Note de clôture (optionnel)"
                      className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={busy || countedClose.trim() === ''}
                      className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Valider le comptage et clôturer
                    </button>
                  </form>
                </div>

                <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <h3 className="mb-3 text-sm font-bold text-slate-900 sm:text-base">
                    Mouvements de la session en cours ({current.movements.length})
                  </h3>
                  <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-xs">
                    {current.movements.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-800">{m.type}</p>
                          <p className="truncate text-slate-500">{m.reason || '—'}</p>
                        </div>
                        <span
                          className={`shrink-0 font-mono font-bold tabular ${
                            m.signedAmountXof >= 0 ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {m.signedAmountXof >= 0 ? '+' : ''}
                          {formatXof(m.signedAmountXof)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Historique clôtures : cartes mobile + tableau desktop */}
            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3.5 sm:px-5 sm:py-4">
                <h2 className="text-base font-bold text-slate-900">Historique des sessions</h2>
              </div>

              {/* Cartes mobile (< md) */}
              <div className="divide-y divide-slate-100 md:hidden">
                {history.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-500">Aucune session enregistrée.</p>
                ) : (
                  history.map((s) => (
                    <div key={`m-${s.id}`} className="space-y-2.5 p-4 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-slate-900">{s.registerName}</p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateTimeInTimezone(s.openedAt)}
                            {s.closedAt ? ` → ${formatDateTimeInTimezone(s.closedAt)}` : ' (En cours)'}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            s.status === 'OPEN'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {s.status === 'OPEN' ? 'OUVERTE' : 'CLÔTURÉE'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-50 p-2 text-center tabular">
                        <div className="min-w-0">
                          <p className="text-[10px] text-slate-400">Théorique</p>
                          <p className="truncate font-mono text-[11px] font-bold text-slate-900">
                            {formatXof(s.theoreticalAmountXof)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] text-slate-400">Compté</p>
                          <p className="truncate font-mono text-[11px] font-semibold text-slate-700">
                            {s.countedAmountXof !== null ? formatXof(s.countedAmountXof) : '—'}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] text-slate-400">Écart</p>
                          <p
                            className={`truncate font-mono text-[11px] font-bold ${
                              s.discrepancyXof === null
                                ? 'text-slate-400'
                                : s.discrepancyXof === 0
                                  ? 'text-emerald-700'
                                  : 'text-red-600'
                            }`}
                          >
                            {s.discrepancyXof !== null ? formatXof(s.discrepancyXof) : '—'}
                          </p>
                        </div>
                      </div>
                      {s.status === 'CLOSED' ? (
                        <button
                          type="button"
                          onClick={() => setRegTarget(s)}
                          className="w-full rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700"
                        >
                          Régulariser
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              {/* Tableau desktop (>= md) */}
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Caisse / Dates</th>
                      <th className="px-4 py-3">Théorique</th>
                      <th className="px-4 py-3">Compté</th>
                      <th className="px-4 py-3">Écart</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2.5 text-xs">
                          <p className="font-semibold text-slate-900">{s.registerName}</p>
                          <p className="text-slate-500">
                            {formatDateTimeInTimezone(s.openedAt)}
                            {s.closedAt ? ` → ${formatDateTimeInTimezone(s.closedAt)}` : ' (En cours)'}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{formatXof(s.theoreticalAmountXof)}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {s.countedAmountXof !== null ? formatXof(s.countedAmountXof) : '—'}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs font-bold">
                          {s.discrepancyXof !== null ? (
                            <span className={s.discrepancyXof === 0 ? 'text-emerald-700' : 'text-red-600'}>
                              {formatXof(s.discrepancyXof)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {s.status === 'CLOSED' ? (
                            <button
                              type="button"
                              onClick={() => setRegTarget(s)}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Régulariser
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {regTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <form onSubmit={handleRegularize} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold text-slate-900">Régulariser une clôture</h3>
              <p className="text-xs text-slate-600">
                Une clôture n’est jamais modifiée directement : un mouvement de régularisation motivé
                est ajouté et journalisé (Critère #21).
              </p>
              <select
                value={regType}
                onChange={(e) =>
                  setRegType(e.target.value as 'REGULARIZATION_IN' | 'REGULARIZATION_OUT')
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="REGULARIZATION_IN">Régularisation entrée (+)</option>
                <option value="REGULARIZATION_OUT">Régularisation sortie (-)</option>
              </select>
              <input
                type="number"
                min={1}
                required
                placeholder="Montant XOF"
                value={regAmount || ''}
                onChange={(e) => setRegAmount(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
              />
              <textarea
                rows={2}
                required
                value={regReason}
                onChange={(e) => setRegReason(e.target.value)}
                placeholder="Motif détaillé obligatoire (8+ car.)…"
                className="w-full rounded-lg border border-slate-300 p-2.5 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRegTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  Enregistrer régularisation
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
