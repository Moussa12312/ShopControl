'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Crown,
  LifeBuoy,
  Megaphone,
  Plus,
  Save,
  Send,
  Sliders,
} from 'lucide-react';
import {
  DEFAULT_PAYMENT_METHODS,
  formatDateTimeInTimezone,
  formatXof,
  PLATFORM_MODULE_LABELS,
  PLATFORM_MODULES,
  PlatformModuleKey,
  SUBSCRIPTION_BILLING_CYCLE_LABELS,
  SUBSCRIPTION_BILLING_CYCLE_SUFFIX,
  SUBSCRIPTION_BILLING_CYCLES,
  SUBSCRIPTION_PLAN_LABELS,
  SUBSCRIPTION_PLANS,
  SubscriptionBillingCycle,
  SubscriptionPlan,
  SUPPORT_TICKET_STATUS_LABELS,
  SUPPORT_TICKET_STATUSES,
  SupportTicketStatus,
} from '@shopcontrol/shared';

const PLATFORM_PAYMENT_OPTIONS = [
  ...DEFAULT_PAYMENT_METHODS.map((m) => ({ code: m.code, label: m.label })),
  { code: 'BANK_TRANSFER', label: 'Virement bancaire' },
];
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, ErrorState, LoadingSkeleton, StatusBadge } from '@/components/ui/StateViews';

interface PlatformPlanConfigRow {
  code: string;
  name: string;
  tagline: string;
  badge: string | null;
  monthlyPriceXof: number;
  yearlyPriceXof: number;
  directSalePriceXof: number;
  allowMonthly: boolean;
  allowYearly: boolean;
  allowDirectSale: boolean;
  trialDays: number;
  maxShops: number;
  maxAgentsPerShop: number;
  features: string[];
  isActive: boolean;
  sortOrder: number;
}

interface SubscriptionRow {
  merchantId: string;
  merchantName: string;
  status: string;
  shopsCount: number;
  paymentsCount: number;
  subscription: {
    id: string;
    planCode: SubscriptionPlan;
    billingCycle?: SubscriptionBillingCycle;
    priceXof?: number;
    monthlyPriceXof: number;
    maxShops: number;
    maxAgentsPerShop: number;
    enabledModules: PlatformModuleKey[];
    trialEndsAt?: string | null;
    currentPeriodEnd: string;
  };
}

interface PlatformPaymentRow {
  id: string;
  merchantId: string;
  merchantName: string;
  amountXof: number;
  paymentMethodCode: string;
  periodLabel: string;
  reference: string | null;
  paidAt: string;
}

interface SupportTicketRow {
  id: string;
  ticketNumber: string;
  merchantName: string;
  subject: string;
  priority: string;
  status: SupportTicketStatus;
  createdAt: string;
  messages: Array<{ id: string; senderRole: string; senderName: string; body: string; createdAt: string }>;
}

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  priority: string;
  targetRole: string;
  isActive: boolean;
  createdAt: string;
}

interface MerchantOpt {
  id: string;
  name: string;
}

export default function AdminPlatformPage() {
  const [tab, setTab] = useState<'plans' | 'subs' | 'payments' | 'tickets' | 'announcements'>('plans');
  const [plans, setPlans] = useState<PlatformPlanConfigRow[]>([]);
  const [planDrafts, setPlanDrafts] = useState<
    Record<string, PlatformPlanConfigRow & { featuresText: string }>
  >({});
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [payments, setPayments] = useState<PlatformPaymentRow[]>([]);
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [merchants, setMerchants] = useState<MerchantOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Édition abonnement
  const [editingSub, setEditingSub] = useState<SubscriptionRow | null>(null);
  const [subForm, setSubForm] = useState({
    planCode: 'PRO' as SubscriptionPlan,
    billingCycle: 'MONTHLY' as SubscriptionBillingCycle,
    priceXof: 25000,
    monthlyPriceXof: 25000,
    maxShops: 5,
    maxAgentsPerShop: 10,
    enabledModules: [...PLATFORM_MODULES] as PlatformModuleKey[],
  });

  // Paiement plateforme
  const [payForm, setPayForm] = useState({
    merchantId: '',
    amountXof: 25000,
    paymentMethodCode: 'ORANGE_MONEY',
    periodLabel: 'Mois en cours',
    reference: '',
    reactivateIfPastDue: true,
  });

  // Réponse ticket
  const [replyMap, setReplyMap] = useState<Record<string, string>>({});

  // Nouvelle annonce
  const [annForm, setAnnForm] = useState({
    title: '',
    body: '',
    priority: 'INFO',
    targetRole: 'ALL',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pl, s, p, t, a, m] = await Promise.all([
        apiFetch<PlatformPlanConfigRow[]>('/admin/plans'),
        apiFetch<SubscriptionRow[]>('/admin/subscriptions'),
        apiFetch<PlatformPaymentRow[]>('/admin/platform-payments'),
        apiFetch<SupportTicketRow[]>('/support/tickets'),
        apiFetch<AnnouncementRow[]>('/admin/announcements'),
        apiFetch<MerchantOpt[]>('/admin/merchants'),
      ]);
      setPlans(pl);
      const drafts: Record<string, PlatformPlanConfigRow & { featuresText: string }> = {};
      for (const item of pl) {
        drafts[item.code] = {
          ...item,
          featuresText: (item.features || []).join('\n'),
        };
      }
      setPlanDrafts(drafts);
      setSubs(s);
      setPayments(p);
      setTickets(t);
      setAnnouncements(a);
      setMerchants(m);
      if (m[0]) setPayForm((f) => (f.merchantId ? f : { ...f, merchantId: m[0].id }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement plateforme.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSavePlanConfig = async (code: string) => {
    const draft = planDrafts[code];
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const features = draft.featuresText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      await apiFetch(`/admin/plans/${code}`, {
        method: 'PUT',
        body: {
          name: draft.name,
          tagline: draft.tagline,
          badge: draft.badge?.trim() || null,
          monthlyPriceXof: Math.max(0, Math.round(Number(draft.monthlyPriceXof) || 0)),
          yearlyPriceXof: Math.max(0, Math.round(Number(draft.yearlyPriceXof) || 0)),
          directSalePriceXof: Math.max(0, Math.round(Number(draft.directSalePriceXof) || 0)),
          allowMonthly: Boolean(draft.allowMonthly),
          allowYearly: Boolean(draft.allowYearly),
          allowDirectSale: Boolean(draft.allowDirectSale),
          trialDays: Math.max(0, Math.min(90, Math.round(Number(draft.trialDays) || 0))),
          maxShops: Math.max(1, Math.round(Number(draft.maxShops) || 1)),
          maxAgentsPerShop: Math.max(1, Math.round(Number(draft.maxAgentsPerShop) || 1)),
          features,
          isActive: Boolean(draft.isActive),
        },
      });
      setMsg(`Tarif de la formule « ${draft.name} » enregistré et appliqué en direct.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’enregistrer cette formule.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSub) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/admin/merchants/${editingSub.merchantId}/subscription`, {
        method: 'PUT',
        body: subForm,
      });
      setEditingSub(null);
      setMsg('Abonnement et modules marchand mis à jour.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mise à jour impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/admin/platform-payments', {
        method: 'POST',
        body: {
          ...payForm,
          amountXof: Math.round(Number(payForm.amountXof) || 0),
          reference: payForm.reference.trim() || undefined,
        },
      });
      setPayForm((f) => ({ ...f, reference: '' }));
      setMsg('Paiement plateforme enregistré.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleReplyTicket = async (ticketId: string) => {
    const body = (replyMap[ticketId] || '').trim();
    if (!body) return;
    await apiFetch(`/support/tickets/${ticketId}/reply`, { method: 'POST', body: { body } });
    setReplyMap((p) => ({ ...p, [ticketId]: '' }));
    await load();
  };

  const handleTicketStatus = async (ticketId: string, status: SupportTicketStatus) => {
    await apiFetch(`/support/tickets/${ticketId}/status`, { method: 'PATCH', body: { status } });
    await load();
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/admin/announcements', { method: 'POST', body: annForm });
      setAnnForm({ title: '', body: '', priority: 'INFO', targetRole: 'ALL' });
      setMsg('Annonce publiée auprès des utilisateurs.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Publication impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAnnouncement = async (a: AnnouncementRow) => {
    await apiFetch(`/admin/announcements/${a.id}`, {
      method: 'PATCH',
      body: { isActive: !a.isActive },
    });
    await load();
  };

  const toggleModule = (mod: PlatformModuleKey) => {
    setSubForm((prev) => {
      const has = prev.enabledModules.includes(mod);
      if (has && prev.enabledModules.length === 1) return prev;
      return {
        ...prev,
        enabledModules: has
          ? prev.enabledModules.filter((m) => m !== mod)
          : [...prev.enabledModules, mod],
      };
    });
  };

  return (
    <AppShell
      allowedRoles={['SUPER_ADMIN']}
      title="Administration SaaS Plateforme"
      subtitle="Gestion des abonnements & modules, encaissements SaaS, tickets support marchands et annonces globales."
      headerActions={
        <div className="grid w-full grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-forest-800/80 p-1 text-xs font-semibold sm:inline-flex sm:w-auto sm:flex-wrap sm:rounded-full sm:p-0.5">
          {(
            [
              { id: 'plans', label: 'Tarifs & Offres', icon: Sliders },
              { id: 'subs', label: 'Abonnements', icon: Crown },
              { id: 'payments', label: 'Paiements', icon: CreditCard },
              { id: 'tickets', label: `Support (${tickets.filter((t) => t.status === 'OPEN').length})`, icon: LifeBuoy },
              { id: 'announcements', label: 'Annonces', icon: Megaphone },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 transition sm:rounded-full sm:py-1 ${
                  tab === t.id ? 'bg-white font-bold text-forest-950' : 'text-[#8aa8a2] hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      }
    >
      <div className="space-y-5">

        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {msg}
          </div>
        ) : null}

        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : tab === 'plans' ? (
          <div className="space-y-4">
            <div className="sc-card p-4 text-xs text-slate-600">
              Configurez ici vos offres publiques et tarifs affichés sur la page d’accueil (/) et la page d’inscription (/register) : facturation <strong>Par mois</strong>, <strong>Par année</strong>, ou <strong>Vente directe</strong> (licence unique).
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {plans.map((pl) => {
                const draft = planDrafts[pl.code];
                if (!draft) return null;
                const updateDraft = (patch: Partial<PlatformPlanConfigRow & { featuresText: string }>) =>
                  setPlanDrafts((prev) => ({
                    ...prev,
                    [pl.code]: { ...prev[pl.code], ...patch },
                  }));
                return (
                  <div key={pl.code} className="sc-card flex flex-col justify-between space-y-3 p-4 sm:p-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div>
                          <span className="rounded-md bg-forest-900 px-2 py-0.5 font-mono text-[10px] font-bold text-limeglow-400">
                            {pl.code}
                          </span>
                          <h2 className="mt-1 text-base font-extrabold text-slate-900">{draft.name}</h2>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={draft.isActive}
                            onChange={(e) => updateDraft({ isActive: e.target.checked })}
                            className="h-4 w-4 accent-brand-700"
                          />
                          Visible
                        </label>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600">
                            Nom affiché
                          </label>
                          <input
                            value={draft.name}
                            onChange={(e) => updateDraft({ name: e.target.value })}
                            className="sc-input mt-0.5 py-1.5 text-xs font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600">
                            Badge (optionnel)
                          </label>
                          <input
                            value={draft.badge || ''}
                            onChange={(e) => updateDraft({ badge: e.target.value })}
                            placeholder="Ex. Recommandé"
                            className="sc-input mt-0.5 py-1.5 text-xs"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600">
                          Accroche
                        </label>
                        <input
                          value={draft.tagline}
                          onChange={(e) => updateDraft({ tagline: e.target.value })}
                          className="sc-input mt-0.5 py-1.5 text-xs"
                        />
                      </div>

                      {/* Tarification Par mois / Par année / Vente directe */}
                      <div className="space-y-2 rounded-2xl border border-slate-200 bg-porcelain-50 p-3">
                        <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">
                          Modes & Tarifs (XOF)
                        </p>

                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <input
                              type="checkbox"
                              checked={draft.allowMonthly}
                              onChange={(e) => updateDraft({ allowMonthly: e.target.checked })}
                              className="h-4 w-4 accent-brand-700"
                            />
                            Par mois
                          </label>
                          <input
                            type="number"
                            min={0}
                            disabled={!draft.allowMonthly}
                            value={draft.monthlyPriceXof}
                            onChange={(e) =>
                              updateDraft({ monthlyPriceXof: Number(e.target.value) })
                            }
                            className="sc-input w-32 py-1 text-right text-xs font-bold tabular disabled:opacity-50"
                          />
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <input
                              type="checkbox"
                              checked={draft.allowYearly}
                              onChange={(e) => updateDraft({ allowYearly: e.target.checked })}
                              className="h-4 w-4 accent-brand-700"
                            />
                            Par année
                          </label>
                          <input
                            type="number"
                            min={0}
                            disabled={!draft.allowYearly}
                            value={draft.yearlyPriceXof}
                            onChange={(e) =>
                              updateDraft({ yearlyPriceXof: Number(e.target.value) })
                            }
                            className="sc-input w-32 py-1 text-right text-xs font-bold tabular disabled:opacity-50"
                          />
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <input
                              type="checkbox"
                              checked={draft.allowDirectSale}
                              onChange={(e) => updateDraft({ allowDirectSale: e.target.checked })}
                              className="h-4 w-4 accent-brand-700"
                            />
                            Vente directe
                          </label>
                          <input
                            type="number"
                            min={0}
                            disabled={!draft.allowDirectSale}
                            value={draft.directSalePriceXof}
                            onChange={(e) =>
                              updateDraft({ directSalePriceXof: Number(e.target.value) })
                            }
                            className="sc-input w-32 py-1 text-right text-xs font-bold tabular disabled:opacity-50"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600">
                            Essai (jours)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={90}
                            value={draft.trialDays}
                            onChange={(e) => updateDraft({ trialDays: Number(e.target.value) })}
                            className="sc-input mt-0.5 py-1 text-xs font-bold tabular"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600">
                            Max boutiques
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={draft.maxShops}
                            onChange={(e) => updateDraft({ maxShops: Number(e.target.value) })}
                            className="sc-input mt-0.5 py-1 text-xs font-bold tabular"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600">
                            Agents / btq
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={draft.maxAgentsPerShop}
                            onChange={(e) =>
                              updateDraft({ maxAgentsPerShop: Number(e.target.value) })
                            }
                            className="sc-input mt-0.5 py-1 text-xs font-bold tabular"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600">
                          Avantages (1 ligne = 1 point)
                        </label>
                        <textarea
                          rows={4}
                          value={draft.featuresText}
                          onChange={(e) => updateDraft({ featuresText: e.target.value })}
                          className="sc-input mt-0.5 py-1.5 text-xs"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSavePlanConfig(pl.code)}
                      className="sc-btn-primary w-full text-xs"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Enregistrer ce tarif
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : tab === 'subs' ? (
          <div className="grid gap-4 md:grid-cols-2">
            {subs.map((row) => {
              const sub = row.subscription;
              const cycle = sub.billingCycle || 'MONTHLY';
              const shownPrice = sub.priceXof ?? sub.monthlyPriceXof;
              const isTrialActive =
                Boolean(sub.trialEndsAt) && new Date(sub.trialEndsAt!).getTime() > Date.now();
              return (
                <div key={row.merchantId} className="sc-card flex flex-col justify-between p-5">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-extrabold text-slate-900">{row.merchantName}</h2>
                      <div className="flex items-center gap-1.5">
                        {isTrialActive ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            Essai jusqu’au{' '}
                            {new Date(sub.trialEndsAt!).toLocaleDateString('fr-FR')}
                          </span>
                        ) : null}
                        <StatusBadge status={row.status} />
                      </div>
                    </div>
                    <p className="mt-1 text-xs font-bold text-brand-700">
                      {SUBSCRIPTION_PLAN_LABELS[sub.planCode]} ·{' '}
                      {SUBSCRIPTION_BILLING_CYCLE_LABELS[cycle]} · {formatXof(shownPrice)}{' '}
                      {SUBSCRIPTION_BILLING_CYCLE_SUFFIX[cycle]}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Boutiques : {row.shopsCount} / max {sub.maxShops} · {sub.maxAgentsPerShop}{' '}
                      agent(s)/boutique
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(sub.enabledModules || []).map((m) => (
                        <span
                          key={m}
                          className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-bold text-brand-800"
                        >
                          {PLATFORM_MODULE_LABELS[m] || m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSub(row);
                      setSubForm({
                        planCode: sub.planCode,
                        billingCycle: cycle,
                        priceXof: shownPrice,
                        monthlyPriceXof: sub.monthlyPriceXof,
                        maxShops: sub.maxShops,
                        maxAgentsPerShop: sub.maxAgentsPerShop,
                        enabledModules: sub.enabledModules || [...PLATFORM_MODULES],
                      });
                    }}
                    className="sc-btn-ghost mt-4 w-full text-xs"
                  >
                    Configurer plan & modules
                  </button>
                </div>
              );
            })}
          </div>
        ) : tab === 'payments' ? (
          <div className="grid gap-5 lg:grid-cols-12">
            <form onSubmit={handleRecordPayment} className="sc-card space-y-3 p-5 lg:col-span-5">
              <h2 className="text-base font-extrabold text-slate-900">Enregistrer un paiement SaaS</h2>
              <select
                required
                value={payForm.merchantId}
                onChange={(e) => setPayForm({ ...payForm, merchantId: e.target.value })}
                className="sc-input"
              >
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="number"
                  min={1}
                  required
                  value={payForm.amountXof}
                  onChange={(e) => setPayForm({ ...payForm, amountXof: Number(e.target.value) })}
                  placeholder="Montant XOF"
                  className="sc-input tabular"
                />
                <select
                  value={payForm.paymentMethodCode}
                  onChange={(e) => setPayForm({ ...payForm, paymentMethodCode: e.target.value })}
                  className="sc-input"
                >
                  {PLATFORM_PAYMENT_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                required
                value={payForm.periodLabel}
                onChange={(e) => setPayForm({ ...payForm, periodLabel: e.target.value })}
                placeholder="Période couverte (ex. Novembre 2026)"
                className="sc-input"
              />
              <input
                value={payForm.reference}
                onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                placeholder="Référence transaction"
                className="sc-input font-mono text-xs"
              />
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={payForm.reactivateIfPastDue}
                  onChange={(e) =>
                    setPayForm({ ...payForm, reactivateIfPastDue: e.target.checked })
                  }
                  className="h-4 w-4 accent-brand-700"
                />
                Réactiver automatiquement si le marchand est en impayé
              </label>
              <button type="submit" disabled={busy} className="sc-btn-primary w-full text-xs">
                <Plus className="h-4 w-4" />
                Enregistrer le règlement
              </button>
            </form>

            <div className="sc-card p-5 lg:col-span-7">
              <h2 className="text-base font-extrabold text-slate-900">Journal des paiements plateforme</h2>
              {payments.length === 0 ? (
                <EmptyState title="Aucun paiement enregistré" description="Les règlements d’abonnement apparaîtront ici." />
              ) : (
                <div className="mt-3 space-y-2 text-xs">
                  {payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-200 bg-porcelain-50 px-4 py-3"
                    >
                      <div>
                        <p className="font-bold text-slate-900">
                          {p.merchantName} · {p.periodLabel}
                        </p>
                        <p className="text-slate-500">
                          {p.paymentMethodCode}
                          {p.reference ? ` (${p.reference})` : ''} · {formatDateTimeInTimezone(p.paidAt)}
                        </p>
                      </div>
                      <span className="text-sm font-extrabold text-emerald-700 tabular">
                        {formatXof(p.amountXof)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : tab === 'tickets' ? (
          <div className="space-y-3">
            {tickets.length === 0 ? (
              <EmptyState title="Aucun ticket support" description="Les demandes des propriétaires apparaîtront ici." />
            ) : (
              tickets.map((t) => (
                <div key={t.id} className="sc-card space-y-3 p-5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">
                        <span className="font-mono text-brand-700">{t.ticketNumber}</span> · {t.subject}
                      </p>
                      <p className="text-slate-500">
                        Marchand : <strong>{t.merchantName}</strong> · {formatDateTimeInTimezone(t.createdAt)}
                      </p>
                    </div>
                    <select
                      value={t.status}
                      onChange={(e) => handleTicketStatus(t.id, e.target.value as SupportTicketStatus)}
                      className="rounded-xl border border-slate-200 bg-porcelain-50 px-3 py-1.5 text-xs font-bold"
                    >
                      {SUPPORT_TICKET_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {SUPPORT_TICKET_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    {t.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded-xl px-3.5 py-2.5 ${
                          m.senderRole === 'SUPER_ADMIN'
                            ? 'bg-forest-900 text-white'
                            : 'bg-porcelain-50 text-slate-800'
                        }`}
                      >
                        <p className="text-[10px] font-bold opacity-70">{m.senderName}</p>
                        <p className="mt-0.5">{m.body}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={replyMap[t.id] || ''}
                      onChange={(e) => setReplyMap((p) => ({ ...p, [t.id]: e.target.value }))}
                      placeholder="Répondre au propriétaire…"
                      className="sc-input py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleReplyTicket(t.id)}
                      className="sc-btn-primary px-4 py-2 text-xs"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Répondre
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-12">
            <form onSubmit={handleCreateAnnouncement} className="sc-card space-y-3 p-5 lg:col-span-5">
              <h2 className="text-base font-extrabold text-slate-900">Publier une annonce globale</h2>
              <input
                required
                minLength={3}
                value={annForm.title}
                onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })}
                placeholder="Titre court *"
                className="sc-input"
              />
              <textarea
                required
                minLength={5}
                rows={3}
                value={annForm.body}
                onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })}
                placeholder="Message affiché dans le bandeau supérieur…"
                className="sc-input"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select
                  value={annForm.priority}
                  onChange={(e) => setAnnForm({ ...annForm, priority: e.target.value })}
                  className="sc-input text-xs"
                >
                  <option value="INFO">Information</option>
                  <option value="WARNING">Avertissement</option>
                  <option value="URGENT">Urgent</option>
                </select>
                <select
                  value={annForm.targetRole}
                  onChange={(e) => setAnnForm({ ...annForm, targetRole: e.target.value })}
                  className="sc-input text-xs"
                >
                  <option value="ALL">Tous les utilisateurs</option>
                  <option value="OWNER">Propriétaires uniquement</option>
                  <option value="AGENT">Agents uniquement</option>
                </select>
              </div>
              <button type="submit" disabled={busy} className="sc-btn-primary w-full text-xs">
                <Megaphone className="h-4 w-4" />
                Publier l’annonce
              </button>
            </form>

            <div className="sc-card p-5 lg:col-span-7">
              <h2 className="text-base font-extrabold text-slate-900">Annonces publiées</h2>
              <div className="mt-3 space-y-2.5 text-xs">
                {announcements.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-porcelain-50 p-3.5"
                  >
                    <div>
                      <p className="font-bold text-slate-900">{a.title}</p>
                      <p className="mt-0.5 text-slate-600">{a.body}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        Cible : {a.targetRole} · {formatDateTimeInTimezone(a.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleAnnouncement(a)}
                      className={`shrink-0 rounded-full px-3 py-1 font-bold ${
                        a.isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {a.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Modale Edition Abonnement */}
        {editingSub ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/65 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleSaveSub}
              className="w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
            >
              <h3 className="text-lg font-extrabold text-slate-900">
                Abonnement — {editingSub.merchantName}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Offre</label>
                  <select
                    value={subForm.planCode}
                    onChange={(e) => {
                      const nextPlan = e.target.value as SubscriptionPlan;
                      const found = plans.find((p) => p.code === nextPlan);
                      const nextPrice = found
                        ? subForm.billingCycle === 'YEARLY'
                          ? found.yearlyPriceXof
                          : subForm.billingCycle === 'DIRECT_SALE'
                            ? found.directSalePriceXof
                            : found.monthlyPriceXof
                        : subForm.priceXof;
                      setSubForm({
                        ...subForm,
                        planCode: nextPlan,
                        priceXof: nextPrice,
                        monthlyPriceXof: found?.monthlyPriceXof ?? subForm.monthlyPriceXof,
                        maxShops: found?.maxShops ?? subForm.maxShops,
                        maxAgentsPerShop: found?.maxAgentsPerShop ?? subForm.maxAgentsPerShop,
                      });
                    }}
                    className="sc-input mt-1"
                  >
                    {SUBSCRIPTION_PLANS.map((p) => (
                      <option key={p} value={p}>
                        {SUBSCRIPTION_PLAN_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Mode de tarification
                  </label>
                  <select
                    value={subForm.billingCycle}
                    onChange={(e) => {
                      const nextCycle = e.target.value as SubscriptionBillingCycle;
                      const found = plans.find((p) => p.code === subForm.planCode);
                      const nextPrice = found
                        ? nextCycle === 'YEARLY'
                          ? found.yearlyPriceXof
                          : nextCycle === 'DIRECT_SALE'
                            ? found.directSalePriceXof
                            : found.monthlyPriceXof
                        : subForm.priceXof;
                      setSubForm({
                        ...subForm,
                        billingCycle: nextCycle,
                        priceXof: nextPrice,
                      });
                    }}
                    className="sc-input mt-1"
                  >
                    {SUBSCRIPTION_BILLING_CYCLES.map((c) => (
                      <option key={c} value={c}>
                        {SUBSCRIPTION_BILLING_CYCLE_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Tarif appliqué ({SUBSCRIPTION_BILLING_CYCLE_LABELS[subForm.billingCycle]}, XOF)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={subForm.priceXof}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setSubForm({
                        ...subForm,
                        priceXof: val,
                        monthlyPriceXof:
                          subForm.billingCycle === 'MONTHLY' ? val : subForm.monthlyPriceXof,
                      });
                    }}
                    className="sc-input mt-1 tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Max boutiques</label>
                  <input
                    type="number"
                    min={1}
                    value={subForm.maxShops}
                    onChange={(e) => setSubForm({ ...subForm, maxShops: Number(e.target.value) })}
                    className="sc-input mt-1 tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Max agents / boutique</label>
                  <input
                    type="number"
                    min={1}
                    value={subForm.maxAgentsPerShop}
                    onChange={(e) =>
                      setSubForm({ ...subForm, maxAgentsPerShop: Number(e.target.value) })
                    }
                    className="sc-input mt-1 tabular"
                  />
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold text-slate-700">Modules activés</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PLATFORM_MODULES.map((m) => (
                    <label
                      key={m}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 p-2 text-xs font-semibold"
                    >
                      <input
                        type="checkbox"
                        checked={subForm.enabledModules.includes(m)}
                        onChange={() => toggleModule(m)}
                        className="h-4 w-4 accent-brand-700"
                      />
                      {PLATFORM_MODULE_LABELS[m]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setEditingSub(null)} className="sc-btn-ghost w-full sm:w-auto">
                  Annuler
                </button>
                <button type="submit" disabled={busy} className="sc-btn-primary w-full sm:w-auto">
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
