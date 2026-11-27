'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Banknote,
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
import { getLocalTerminalMeta, getOrCreateDeviceUid, saveLocalTerminalMeta } from '@/lib/local-db';
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
  const [terminalLabel, setTerminalLabel] = useState('');
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
      const anQs = new URLSearchParams({ period: 'today' });
      if (activeOperator?.id) anQs.set('operatorId', activeOperator.id);

      const [ov, ops, an, localMeta] = await Promise.all([
        apiFetch<ShopOverview>(`/shops/${shop.shopId}/overview`, { shopId: shop.shopId }),
        apiFetch<OperatorRow[]>(`/shops/${shop.shopId}/operators`, { shopId: shop.shopId }),
        apiFetch<ShopAnalyticsMini>(`/shops/${shop.shopId}/analytics?${anQs.toString()}`, {
          shopId: shop.shopId,
        }).catch(() => null),
        getLocalTerminalMeta(),
      ]);
      setOverview(ov);
      setOperators(ops.filter((o) => o.isActive));
      setAnalytics(an);
      if (localMeta?.terminalLabel) {
        setTerminalLabel((prev) => prev || localMeta.terminalLabel || '');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement de votre espace.');
    } finally {
      setLoading(false);
    }
  }, [shop, activeOperator?.id]);

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
    const cleanLabel = terminalLabel.trim();
    if (cleanLabel.length < 2) {
      setActionErr('Indiquez un nom pour ce poste (au moins 2 caractères).');
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
        body: { deviceUid, label: cleanLabel },
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
    <div className="space-y-3.5">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-extrabold tracking-tight text-white sm:text-xl">
            {overview?.shop.name || shop?.shopName || 'Accueil boutique'}
          </h1>
          <p className="text-[11px] text-emerald-200/75">
            Opérateur actif :{' '}
            <strong className="text-limeglow-400">
              {activeOperator ? activeOperator.firstName : 'À sélectionner ci-dessous'}
            </strong>
          </p>
        </div>
        <Link
          href="/pos"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-forest-950 shadow-sm hover:bg-emerald-50 sm:w-auto"
        >
          <span>Ouvrir le comptoir POS</span>
          <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="sc-dark-glass flex min-w-0 items-center gap-3 p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-limeglow-400 ring-1 ring-brand-400/25">
            <ShoppingBag className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] text-[#98b3ae]">
              {activeOperator ? `Mes ventes d'aujourd'hui (${activeOperator.firstName})` : "Ventes d'aujourd'hui"}
            </p>
            <div className="flex items-baseline gap-2">
              <p className="truncate text-base font-extrabold text-white tabular">
                {formatXof(analytics?.kpis.currentSalesXof ?? 0)}
              </p>
              <span className="text-xs font-semibold text-emerald-200/80">
                · {analytics?.kpis.currentSalesCount ?? 0} vente(s)
              </span>
            </div>
          </div>
        </div>

        <div className="sc-dark-glass flex min-w-0 items-center justify-between gap-2 p-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-200">
              <Banknote className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] text-[#98b3ae]">Caisse ouverte</p>
              <p className="text-base font-extrabold text-white tabular">
                {analytics?.kpis.openCashSessionsCount ?? 0}
              </p>
            </div>
          </div>
          <Link
            href="/commerce/cash"
            className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
          >
            Caisse
          </Link>
        </div>

        <div className="lime-glow-card flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-limeglow-400/30 p-3.5">
          <div className="min-w-0">
            <p className="text-base font-extrabold text-white tabular">
              {analytics?.kpis.lowStockCount ?? 0}{' '}
              <span className="text-xs font-normal text-emerald-100">alertes stock</span>
            </p>
            <p className="text-[11px] text-emerald-200/80">Suivi temps réel</p>
          </div>
          <Link
            href="/commerce/stock"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-limeglow-400 px-3 py-1.5 text-xs font-extrabold text-forest-950 shadow-lime"
          >
            <span>Stocks</span>
            <Sparkles className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );

  return (
    <AppShell allowedRoles={['AGENT']} hero={heroSection}>
      <div className="space-y-4 sm:space-y-5">

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !shop || !overview ? (
          <ErrorState message="Aucune boutique active n’est associée à ce compte." />
        ) : (
          <>
            {actionErr ? (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-800"
              >
                {actionErr}
              </div>
            ) : null}
            {actionMsg ? (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-900">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{actionMsg}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="sc-card min-w-0 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-brand-700" />
                  <h2 className="text-sm font-bold text-slate-900">
                    Opérateur déclaré au comptoir
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Sélectionnez votre prénom pour tracer vos opérations sur ce poste.
                  {overview.shop.requireOperatorPin ? ' Code PIN obligatoire.' : ''}
                </p>

                {operators.length === 0 ? (
                  <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                    Aucun opérateur déclaré n’a encore été créé par le propriétaire.
                  </p>
                ) : (
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    {operators.map((op) => {
                      const selected = activeOperator?.id === op.id;
                      return (
                        <button
                          key={op.id}
                          type="button"
                          onClick={() => handleSelectOperator(op)}
                          className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${selected
                              ? 'border-forest-900 bg-forest-900 text-white shadow-xs'
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

              <section className="sc-card min-w-0 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-brand-700" />
                  <h2 className="text-sm font-bold text-slate-900">
                    Terminal comptoir (Mode hors-ligne)
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Réservez une plage de tickets sur cet appareil pour continuer à vendre sans
                  connexion.
                </p>

                <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={terminalLabel}
                    onChange={(e) => setTerminalLabel(e.target.value)}
                    placeholder="Nom du poste (ex. Comptoir 1)"
                    className="sc-input sm:flex-1"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRegisterTerminal}
                    className="sc-btn-primary w-full shrink-0 text-xs sm:w-auto"
                  >
                    {busy ? 'Enregistrement…' : 'Synchroniser'}
                  </button>
                </div>

                {terminalInfo ? (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    Préfixe : <strong>{terminalInfo.terminal.prefix}</strong> · Plage :{' '}
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
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
              <h3 className="text-sm font-bold text-slate-900">
                Code PIN — {pinModalOp.firstName}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Confirmez votre prise de poste au comptoir.
              </p>
              <form onSubmit={handleVerifyPin} className="mt-4 space-y-3">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  autoFocus
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••"
                  className="sc-input text-center text-lg tracking-widest"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPinModalOp(null)}
                    className="sc-btn-ghost text-xs"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={busy || pinInput.length < 4}
                    className="sc-btn-primary text-xs"
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
