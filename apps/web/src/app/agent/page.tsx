'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Laptop, ShieldCheck, Store, UserCheck } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { getOrCreateDeviceUid, saveLocalTerminalMeta } from '@/lib/local-db';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState, LoadingSkeleton, StatusBadge } from '@/components/ui/StateViews';

interface OperatorRow {
  id: string;
  firstName: string;
  hasPin: boolean;
  isActive: boolean;
}

interface ShopOverview {
  shop: {
    id: string;
    name: string;
    slug: string;
    status: string;
    currency: string;
    timezone: string;
    requireOperatorPin: boolean;
  };
  metrics: {
    activeOperatorsCount: number;
    activeTerminalsCount: number;
  };
}

interface TerminalResult {
  terminal: { id: string; label: string; prefix: string; lastSyncAt: string | null };
  activeReceiptRange: { seriesCode: string; rangeStart: number; rangeEnd: number; currentNumber: number };
}

export default function AgentHomePage() {
  const { shops, activeOperator, setActiveOperator } = useAuth();
  const shop = shops[0];

  const [overview, setOverview] = useState<ShopOverview | null>(null);
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [terminalInfo, setTerminalInfo] = useState<TerminalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pinModalOp, setPinModalOp] = useState<OperatorRow | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [verifiedPin, setVerifiedPin] = useState<string | null>(null);
  const [terminalLabel, setTerminalLabel] = useState('Comptoir Principal');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!shop) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [ov, ops] = await Promise.all([
        apiFetch<ShopOverview>(`/shops/${shop.shopId}/overview`, { shopId: shop.shopId }),
        apiFetch<OperatorRow[]>(`/shops/${shop.shopId}/operators`, { shopId: shop.shopId }),
      ]);
      setOverview(ov);
      setOperators(ops.filter((o) => o.isActive));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement de votre espace.');
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelectOperator = (op: OperatorRow) => {
    setActionErr(null);
    if (overview?.shop.requireOperatorPin || op.hasPin) {
      setPinModalOp(op);
      setPinInput('');
    } else {
      setActiveOperator({ id: op.id, firstName: op.firstName });
      setVerifiedPin(null);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shop || !pinModalOp) return;
    setBusy(true);
    setActionErr(null);
    try {
      await apiFetch(`/shops/${shop.shopId}/operators/verify-pin`, {
        method: 'POST',
        shopId: shop.shopId,
        body: { operatorId: pinModalOp.id, pin: pinInput },
      });
      setActiveOperator({ id: pinModalOp.id, firstName: pinModalOp.firstName });
      setVerifiedPin(pinInput);
      setPinModalOp(null);
      setPinInput('');
    } catch (err) {
      setActionErr(err instanceof ApiError ? err.message : 'Code PIN incorrect.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterTerminal = async () => {
    if (!shop) return;
    if (!activeOperator) {
      setActionErr('Sélectionnez d’abord votre prénom d’opérateur déclaré.');
      return;
    }
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const deviceUid = await getOrCreateDeviceUid();
      const res = await apiFetch<TerminalResult>(`/shops/${shop.shopId}/terminals/register`, {
        method: 'POST',
        shopId: shop.shopId,
        operatorId: activeOperator.id,
        operatorPin: verifiedPin,
        body: { deviceUid, label: terminalLabel },
      });
      setTerminalInfo(res);
      await saveLocalTerminalMeta({
        terminalPrefix: res.terminal.prefix,
        terminalLabel: res.terminal.label,
      });
      setActionMsg(
        `Terminal ${res.terminal.prefix} enregistré avec plage réservée ${res.activeReceiptRange.seriesCode}-${res.activeReceiptRange.rangeStart} à ${res.activeReceiptRange.rangeEnd}.`,
      );
      await load();
    } catch (err) {
      setActionErr(err instanceof ApiError ? err.message : 'Enregistrement du terminal refusé.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['AGENT']}>
      <div className="space-y-6">
        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !shop || !overview ? (
          <ErrorState message="Aucune boutique active n’est associée à ce compte Agent." />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white">
                  <Store className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">{overview.shop.name}</h1>
                  <p className="text-xs text-slate-500">
                    Espace opérationnel cloisonné · Devise {overview.shop.currency} ·{' '}
                    {overview.shop.timezone}
                  </p>
                </div>
              </div>
              <StatusBadge status={overview.shop.status} />
            </div>

            {actionErr ? (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
                {actionErr}
              </div>
            ) : null}
            {actionMsg ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <span>{actionMsg}</span>
              </div>
            ) : null}

            {/* Sélecteur d'opérateur déclaré (Section 4.3, Critère #26) */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-brand-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Qui travaille au comptoir ? (Opérateur déclaré)
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Chaque opération sensible est tracée sous ce compte Agent avec le prénom de
                l’opérateur sélectionné.
                {overview.shop.requireOperatorPin
                  ? ' Un code PIN est exigé par le propriétaire.'
                  : ''}
              </p>

              {operators.length === 0 ? (
                <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  Aucun opérateur déclaré n’a encore été ajouté par le propriétaire pour cette boutique.
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {operators.map((op) => {
                    const selected = activeOperator?.id === op.id;
                    return (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => handleSelectOperator(op)}
                        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                          selected
                            ? 'border-brand-700 bg-brand-700 text-white'
                            : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <span>{op.firstName}</span>
                        {op.hasPin ? <KeyRound className="h-3.5 w-3.5 opacity-80" /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Enregistrement terminal comptoir Option B (Section 14.3) */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <Laptop className="h-5 w-5 text-brand-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Terminal comptoir & plage de tickets hors-ligne (Option B)
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Enregistrez cet appareil pour réserver une plage séquentielle dédiée dans la base
                de données de la boutique et préparer les ventes comptoir même en cas de coupure réseau.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  value={terminalLabel}
                  onChange={(e) => setTerminalLabel(e.target.value)}
                  placeholder="Nom de ce poste (ex. Tablette Caisse 1)"
                  className="w-64 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRegisterTerminal}
                  className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  {busy ? 'Enregistrement…' : 'Enregistrer / synchroniser ce terminal'}
                </button>
              </div>

              {terminalInfo ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
                  <p>
                    Préfixe terminal : <strong>{terminalInfo.terminal.prefix}</strong> (
                    {terminalInfo.terminal.label})
                  </p>
                  <p className="mt-1">
                    Plage réservée :{' '}
                    <strong>
                      {terminalInfo.activeReceiptRange.seriesCode}-
                      {terminalInfo.activeReceiptRange.rangeStart} →{' '}
                      {terminalInfo.activeReceiptRange.rangeEnd}
                    </strong>
                  </p>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-brand-700" />
                <h2 className="text-base font-semibold text-slate-900">Droits actifs sur cette boutique</h2>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Plafond remise : <strong>{shop.maxDiscountPercent} %</strong> · Permissions actives :{' '}
                <strong>{Object.values(shop.permissions).filter(Boolean).length}</strong>. Les
                modules Ventes, Stocks et Caisse s’activeront automatiquement au Lot 2.
              </p>
            </section>
          </>
        )}

        {/* Modale PIN opérateur */}
        {pinModalOp ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-base font-bold text-slate-900">
                Code PIN — {pinModalOp.firstName}
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Saisissez votre code PIN opérateur pour confirmer votre prise de poste.
              </p>
              <form onSubmit={handleVerifyPin} className="mt-4 space-y-4">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  autoFocus
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-center text-lg tracking-widest"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPinModalOp(null)}
                    className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-700"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={busy || pinInput.length < 4}
                    className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    Valider
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
