'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Crown,
  LifeBuoy,
  Megaphone,
  Plus,
  Send,
} from 'lucide-react';
import {
  formatDateTimeInTimezone,
  formatXof,
  PLATFORM_MODULE_LABELS,
  PLATFORM_MODULES,
  PlatformModuleKey,
  SUBSCRIPTION_PLAN_LABELS,
  SUBSCRIPTION_PLANS,
  SubscriptionPlan,
  SUPPORT_TICKET_STATUS_LABELS,
  SUPPORT_TICKET_STATUSES,
  SupportTicketStatus,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, ErrorState, LoadingSkeleton, StatusBadge } from '@/components/ui/StateViews';

interface SubscriptionRow {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantStatus: string;
  planCode: SubscriptionPlan;
  monthlyPriceXof: number;
  maxShops: number;
  maxAgentsPerShop: number;
  enabledModules: PlatformModuleKey[];
  currentPeriodEnd: string;
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
  const [tab, setTab] = useState<'subs' | 'payments' | 'tickets' | 'announcements'>('subs');
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
      const [s, p, t, a, m] = await Promise.all([
        apiFetch<SubscriptionRow[]>('/admin/subscriptions'),
        apiFetch<PlatformPaymentRow[]>('/admin/platform-payments'),
        apiFetch<SupportTicketRow[]>('/support/tickets'),
        apiFetch<AnnouncementRow[]>('/admin/announcements'),
        apiFetch<MerchantOpt[]>('/admin/merchants'),
      ]);
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
    <AppShell allowedRoles={['SUPER_ADMIN']}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Administration SaaS Plateforme
            </h1>
            <p className="text-sm text-slate-600">
              Gestion des abonnements & modules, encaissements SaaS, tickets support marchands et annonces globales.
            </p>
          </div>
          <div className="inline-flex flex-wrap rounded-2xl border border-slate-200 bg-white p-1 text-xs font-bold shadow-xs">
            {(
              [
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
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 transition ${
                    tab === t.id ? 'bg-forest-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {msg}
          </div>
        ) : null}

        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : tab === 'subs' ? (
          <div className="grid gap-4 md:grid-cols-2">
            {subs.map((s) => (
              <div key={s.id} className="sc-card flex flex-col justify-between p-5">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-extrabold text-slate-900">{s.merchantName}</h2>
                    <StatusBadge status={s.merchantStatus} />
                  </div>
                  <p className="mt-1 text-xs font-bold text-brand-700">
                    {SUBSCRIPTION_PLAN_LABELS[s.planCode]} · {formatXof(s.monthlyPriceXof)}/mois
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Quotas : max {s.maxShops} boutique(s) · {s.maxAgentsPerShop} agent(s)/boutique
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.enabledModules.map((m) => (
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
                    setEditingSub(s);
                    setSubForm({
                      planCode: s.planCode,
                      monthlyPriceXof: s.monthlyPriceXof,
                      maxShops: s.maxShops,
                      maxAgentsPerShop: s.maxAgentsPerShop,
                      enabledModules: s.enabledModules,
                    });
                  }}
                  className="sc-btn-ghost mt-4 w-full text-xs"
                >
                  Configurer plan & modules
                </button>
              </div>
            ))}
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
              <div className="grid grid-cols-2 gap-2">
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
                  <option value="ORANGE_MONEY">Orange Money</option>
                  <option value="WAVE">Wave</option>
                  <option value="BANK_TRANSFER">Virement</option>
                  <option value="CASH">Espèces</option>
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
              <div className="grid grid-cols-2 gap-2">
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
                    onChange={(e) =>
                      setSubForm({ ...subForm, planCode: e.target.value as SubscriptionPlan })
                    }
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
                  <label className="block text-xs font-semibold text-slate-700">Prix / mois (XOF)</label>
                  <input
                    type="number"
                    min={0}
                    value={subForm.monthlyPriceXof}
                    onChange={(e) =>
                      setSubForm({ ...subForm, monthlyPriceXof: Number(e.target.value) })
                    }
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
                <div className="grid grid-cols-2 gap-2">
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

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingSub(null)} className="sc-btn-ghost">
                  Annuler
                </button>
                <button type="submit" disabled={busy} className="sc-btn-primary">
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
