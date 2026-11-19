'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  KeyRound,
  Laptop,
  Plus,
  ShoppingBag,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { formatXof } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { getOrCreateDeviceUid, saveLocalTerminalMeta } from '@/lib/local-db';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

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

interface ShopAnalyticsMini {
  kpis: {
    currentSalesXof: number;
    currentSalesCount: number;
    lowStockCount: number;
    openCashSessionsCount: number;
  };
}

interface TerminalResult {
  terminal: { id: string; label: string; prefix: string; lastSyncAt: string | null };
  activeReceiptRange: {
    seriesCode: string;
    rangeStart: number;
    rangeEnd: number;
    currentNumber: number;
  };
}

export default function AgentHomePage() {
  const { shops, activeOperator, setActiveOperator } = useAuth();
  const shop = shops[0];

  const [overview, setOverview] = useState<ShopOverview | null>(null);
  const [analytics, setAnalytics] = useState<ShopAnalyticsMini | null>(null);
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
      const [ov, ops, an] = await Promise.all([
        apiFetch<ShopOverview>(`/shops/${shop.shopId}/overview`, { shopId: shop.shopId }),
        apiFetch<OperatorRow[]>(`/shops/${shop.shopId}/operators`, { shopId: shop.shopId }),
        apiFetch<ShopAnalyticsMini>(`/shops/${shop.shopId}/analytics?period=daily`, {
          shopId: shop.shopId,
        }).catch(() => null),
      ]);
      setOverview(ov);
      setOperators(ops.filter((o) => o.isActive));
      setAnalytics(an);
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
        `Terminal ${res.terminal.prefix} prêt · Plage hors-ligne ${res.activeReceiptRange.seriesCode}-${res.activeReceiptRange.rangeStart} à ${res.activeReceiptRange.rangeEnd}.`,
      );
      await load();
    } catch (err) {
      setActionErr(err instanceof ApiError ? err.message : 'Enregistrement refusé.');
    } finally {
      setBusy(false);
    }
  };

  const heroSection = (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">
            {overview?.shop.name || shop?.shopName || 'Espace Boutique'}
          </h1>
          <p className="mt-0.5 text-xs text-emerald-200/75">
            Poste opérationnel cloisonné · Opérateur actif :{' '}
            <strong className="text-limeglow-400">
              {activeOperator ? activeOperator.firstName : 'À sélectionner'}
            </strong>
          </p>
        </div>
        <Link
          href="/pos"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-forest-900 shadow-sm hover:bg-emerald-50 sm:w-auto"
        >
          <span>Ouvrir le comptoir POS</span>
          <Plus className="h-4 w-4 stroke-[2.5]" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3.5">
        <div className="min-w-0 rounded-2xl border border-white/10 bg-forest-800/85 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-emerald-200">
              <ShoppingBag className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-[#98b3ae]">Ventes (7 derniers jours)</p>
              <p className="truncate text-lg font-bold text-white">
                {formatXof(analytics?.kpis.currentSalesXof ?? 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-white/10 bg-forest-800/85 p-4">
          <p className="text-xs text-[#98b3ae]">Sessions de caisse ouvertes</p>
          <p className="mt-1 text-xl font-bold text-white">
            {analytics?.kpis.openCashSessionsCount ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-emerald-300">
            {(analytics?.kpis.openCashSessionsCount ?? 0) > 0
              ? 'Caisse prête pour les espèces'
              : 'Ouvrir une session dans Caisse'}
          </p>
        </div>

        <div className="lime-glow-card flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-limeglow-400/25 p-4 sm:flex-nowrap">
          <div className="min-w-0">
            <p className="text-lg font-bold text-white">
              {analytics?.kpis.lowStockCount ?? 0}{' '}
              <span className="text-xs font-normal text-emerald-100">alertes stock</span>
            </p>
            <p className="text-[11px] text-emerald-200/80">Suivi comptoir temps réel</p>
          </div>
          <Link
            href="/commerce/cash"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-limeglow-400 px-3.5 py-2 text-xs font-bold text-forest-950"
          >
            <span>Caisse</span>
            <Sparkles className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );

  return (
    <AppShell allowedRoles={['AGENT']} hero={heroSection}>
      <div className="space-y-6">
        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !shop || !overview ? (
          <ErrorState message="Aucune boutique active n’est associée à ce compte Agent." />
        ) : (
          <>
            {actionErr ? (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800"
              >
                {actionErr}
              </div>
            ) : null}
            {actionMsg ? (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <span>{actionMsg}</span>
              </div>
            ) : null}

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-brand-700" />
                  <h2 className="text-base font-bold text-slate-900">
                    Opérateur déclaré au comptoir
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Sélectionnez votre prénom pour tracer toutes les opérations sensibles sur ce poste
                  partagé.{overview.shop.requireOperatorPin ? ' Code PIN obligatoire.' : ''}
                </p>

                {operators.length === 0 ? (
                  <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800">
                    Aucun opérateur déclaré n’a encore été créé par le propriétaire.
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
                          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                            selected
                              ? 'border-forest-900 bg-forest-900 text-white shadow-sm'
                              : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
                          }`}
                        >
                          <span>{op.firstName}</span>
                          {op.hasPin ? <KeyRound className="h-3.5 w-3.5 opacity-75" /> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card">
                <div className="flex items-center gap-2">
                  <Laptop className="h-5 w-5 text-brand-700" />
                  <h2 className="text-base font-bold text-slate-900">
                    Terminal comptoir (Mode hors-ligne Option B)
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Réservez une plage de tickets séquentielle sur cet appareil pour continuer à vendre
                  en cas de coupure réseau.
                </p>

                <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                  <input
                    value={terminalLabel}
                    onChange={(e) => setTerminalLabel(e.target.value)}
                    placeholder="Nom du poste"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm sm:flex-1"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRegisterTerminal}
                    className="w-full rounded-full bg-forest-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-forest-800 disabled:opacity-50 sm:w-auto sm:py-2"
                  >
                    {busy ? 'Enregistrement…' : 'Synchroniser ce terminal'}
                  </button>
                </div>

                {terminalInfo ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-3.5 text-xs text-slate-700">
                    Préfixe : <strong>{terminalInfo.terminal.prefix}</strong> · Plage réservée :{' '}
                    <strong>
                      {terminalInfo.activeReceiptRange.seriesCode}-
                      {terminalInfo.activeReceiptRange.rangeStart} →{' '}
                      {terminalInfo.activeReceiptRange.rangeEnd}
                    </strong>
                  </div>
                ) : null}
              </section>
            </div>
          </>
        )}

        {pinModalOp ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
              <h3 className="text-base font-bold text-slate-900">
                Code PIN — {pinModalOp.firstName}
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Confirmez votre prise de poste au comptoir.
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
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={busy || pinInput.length < 4}
                    className="rounded-full bg-forest-900 px-5 py-2 text-xs font-bold text-white hover:bg-forest-800 disabled:opacity-50"
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
