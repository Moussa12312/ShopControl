'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, CreditCard, XCircle } from 'lucide-react';
import {
  formatXof,
  SUBSCRIPTION_BILLING_CYCLE_LABELS,
  SUBSCRIPTION_PAYMENT_METHOD_LABELS,
  SUBSCRIPTION_PAYMENT_METHODS,
  SubscriptionBillingCycle,
  SubscriptionPaymentMethod,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingSkeleton } from '@/components/ui/StateViews';

interface PlanRow {
  code: string;
  name: string;
  monthlyPriceXof: number;
  yearlyPriceXof: number;
  directSalePriceXof: number;
  allowMonthly: boolean;
  allowYearly: boolean;
  allowDirectSale: boolean;
}

interface RenewalRow {
  id: string;
  planCode: string;
  billingCycle: SubscriptionBillingCycle;
  amountXof: number;
  paymentMethodCode: string;
  reference: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  createdAt: string;
}

interface SubscriptionPayload {
  subscription: {
    planCode: string;
    billingCycle: SubscriptionBillingCycle;
    currentPeriodEnd: string;
    trialEndsAt: string | null;
  };
  merchantStatus: 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'TERMINATED';
  statusReason: string | null;
  gracePeriodEndsAt: string | null;
  renewalRequests: RenewalRow[];
}

const STATUS_LABEL: Record<RenewalRow['status'], string> = {
  PENDING: 'En vérification',
  APPROVED: 'Validée',
  REJECTED: 'Refusée',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

function cyclePrice(plan: PlanRow, cycle: SubscriptionBillingCycle): number {
  return cycle === 'YEARLY'
    ? plan.yearlyPriceXof
    : cycle === 'DIRECT_SALE'
      ? plan.directSalePriceXof
      : plan.monthlyPriceXof;
}

function cycleAllowed(plan: PlanRow, cycle: SubscriptionBillingCycle): boolean {
  return cycle === 'YEARLY' ? plan.allowYearly : cycle === 'DIRECT_SALE' ? plan.allowDirectSale : plan.allowMonthly;
}

export default function OwnerSubscriptionPage() {
  const [data, setData] = useState<SubscriptionPayload | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [planCode, setPlanCode] = useState('');
  const [billingCycle, setBillingCycle] = useState<SubscriptionBillingCycle>('MONTHLY');
  const [method, setMethod] = useState<SubscriptionPaymentMethod>('ORANGE_MONEY');
  const [reference, setReference] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sub, pl] = await Promise.all([
        apiFetch<SubscriptionPayload>('/merchant/subscription'),
        apiFetch<PlanRow[]>('/public/plans'),
      ]);
      setData(sub);
      setPlans(pl);
      setPlanCode((prev) => prev || sub.subscription.planCode);
      setBillingCycle((prev) => (prev === 'MONTHLY' ? sub.subscription.billingCycle : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger votre abonnement.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedPlan = useMemo(() => plans.find((p) => p.code === planCode), [plans, planCode]);
  const pending = data?.renewalRequests.some((r) => r.status === 'PENDING') ?? false;
  const allowedCycles = (['MONTHLY', 'YEARLY', 'DIRECT_SALE'] as const).filter(
    (c) => selectedPlan && cycleAllowed(selectedPlan, c),
  );

  useEffect(() => {
    if (selectedPlan && !cycleAllowed(selectedPlan, billingCycle) && allowedCycles[0]) {
      setBillingCycle(allowedCycles[0]);
    }
  }, [selectedPlan, billingCycle, allowedCycles]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/merchant/subscription/renew', {
        method: 'POST',
        body: { planCode, billingCycle, paymentMethodCode: method, reference: reference.trim() },
      });
      setReference('');
      setSuccess('Demande envoyée. Votre compte sera activé dès que le paiement aura été vérifié.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  };

  const daysLeft = data
    ? Math.ceil((new Date(data.subscription.currentPeriodEnd).getTime() - Date.now()) / 86_400_000)
    : 0;
  const isTrial = Boolean(data?.subscription.trialEndsAt);

  return (
    <AppShell
      allowedRoles={['OWNER']}
      title="Mon abonnement"
      subtitle="Essai gratuit, échéance, activation et renouvellement de votre compte."
    >
      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <div className="mx-auto max-w-3xl space-y-5">
          {error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}
          {success ? (
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {success}
            </div>
          ) : null}

          {data ? (
            <section className="sc-card space-y-2 p-5" aria-label="État de l’abonnement">
              <div className="flex flex-wrap items-center gap-2">
                <CreditCard className="h-5 w-5 text-brand-700" aria-hidden />
                <h2 className="text-base font-extrabold text-slate-900">
                  {isTrial ? 'Essai gratuit' : 'Abonnement'} — formule {data.subscription.planCode}
                </h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    data.merchantStatus === 'ACTIVE'
                      ? 'bg-emerald-100 text-emerald-800'
                      : data.merchantStatus === 'PAST_DUE'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-red-100 text-red-800'
                  }`}
                >
                  {data.merchantStatus === 'ACTIVE'
                    ? 'Actif'
                    : data.merchantStatus === 'PAST_DUE'
                      ? 'Impayé'
                      : data.merchantStatus === 'SUSPENDED'
                        ? 'Suspendu'
                        : 'Résilié'}
                </span>
              </div>
              <p className="text-sm text-slate-700">
                Échéance : <strong>{fmtDate(data.subscription.currentPeriodEnd)}</strong>
                {data.merchantStatus === 'ACTIVE'
                  ? daysLeft >= 0
                    ? ` (${daysLeft} jour(s) restant(s))`
                    : ''
                  : ''}
              </p>
              {data.merchantStatus === 'PAST_DUE' && data.gracePeriodEndsAt ? (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Votre abonnement est arrivé à échéance. Renouvelez avant le{' '}
                  <strong>{fmtDate(data.gracePeriodEndsAt)}</strong> pour éviter la suspension.
                </p>
              ) : null}
              {data.merchantStatus === 'SUSPENDED' ? (
                <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Compte suspendu : consultation et export uniquement. Soumettez votre paiement ci-dessous pour le
                  réactiver.
                </p>
              ) : null}
            </section>
          ) : null}

          {data && data.merchantStatus !== 'TERMINATED' ? (
            <form onSubmit={handleSubmit} className="sc-card space-y-4 p-5" aria-label="Activer ou renouveler">
              <h2 className="text-base font-extrabold text-slate-900">Activer / renouveler mon abonnement</h2>
              <p className="text-xs text-slate-600">
                Effectuez le paiement par Mobile Money ou virement, puis saisissez ici la{' '}
                <strong>référence du transfert</strong> (obligatoire). Votre compte est activé après vérification.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="sub-plan" className="block text-xs font-medium text-slate-700">
                    Formule
                  </label>
                  <select
                    id="sub-plan"
                    value={planCode}
                    onChange={(e) => setPlanCode(e.target.value)}
                    className="sc-input mt-1"
                  >
                    {plans.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sub-cycle" className="block text-xs font-medium text-slate-700">
                    Durée
                  </label>
                  <select
                    id="sub-cycle"
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value as SubscriptionBillingCycle)}
                    className="sc-input mt-1"
                  >
                    {allowedCycles.map((c) => (
                      <option key={c} value={c}>
                        {SUBSCRIPTION_BILLING_CYCLE_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sub-method" className="block text-xs font-medium text-slate-700">
                    Moyen de paiement
                  </label>
                  <select
                    id="sub-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as SubscriptionPaymentMethod)}
                    className="sc-input mt-1"
                  >
                    {SUBSCRIPTION_PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {SUBSCRIPTION_PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sub-ref" className="block text-xs font-medium text-slate-700">
                    Référence du transfert *
                  </label>
                  <input
                    id="sub-ref"
                    required
                    minLength={4}
                    maxLength={120}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="ex. OM261119.123456"
                    className="sc-input mt-1 font-mono"
                  />
                </div>
              </div>

              {selectedPlan ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                  Montant à régler : {formatXof(cyclePrice(selectedPlan, billingCycle))}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy || pending || reference.trim().length < 4}
                className="sc-hero-btn-primary w-full justify-center disabled:opacity-50 sm:w-auto"
              >
                {pending ? 'Demande en cours de vérification' : busy ? 'Envoi…' : 'Envoyer ma demande'}
              </button>
            </form>
          ) : null}

          <section className="sc-card p-5" aria-label="Historique des demandes">
            <h2 className="mb-3 text-base font-extrabold text-slate-900">Mes demandes</h2>
            {data && data.renewalRequests.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {data.renewalRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {r.planCode} · {SUBSCRIPTION_BILLING_CYCLE_LABELS[r.billingCycle]} · {formatXof(r.amountXof)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fmtDate(r.createdAt)} · réf. <span className="font-mono">{r.reference}</span>
                      </p>
                      {r.reviewNote ? <p className="text-xs text-slate-600">Note : {r.reviewNote}</p> : null}
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        r.status === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : r.status === 'REJECTED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {r.status === 'APPROVED' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      ) : r.status === 'REJECTED' ? (
                        <XCircle className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {STATUS_LABEL[r.status]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Aucune demande pour le moment.</p>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
