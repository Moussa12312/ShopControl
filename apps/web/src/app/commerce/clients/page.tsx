'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  HandCoins,
  MessageCircle,
  Plus,
  Receipt,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  formatDateTimeInTimezone,
  formatXof,
  PaymentMethodConfig,
} from '@shopcontrol/shared';
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
  email?: string | null;
  address: string | null;
  creditLimitXof: number;
  outstandingDebtXof: number;
  openDebtsCount?: number;
  overdueDebtsCount?: number;
  hasAccount?: boolean;
  salesCount: number;
}

interface ReceivablePaymentRow {
  id: string;
  amountXof: number;
  paymentMethodCode: string;
  transactionRef: string | null;
  notes?: string | null;
  declaredOperatorName: string | null;
  createdAt: string;
}

interface ReceivableRow {
  id: string;
  status: string;
  description?: string | null;
  dueDate?: string | null;
  isOverdue?: boolean;
  initialAmountXof: number;
  paidAmountXof: number;
  remainingAmountXof: number;
  ageDays: number;
  client: { id: string; fullName: string; phone: string };
  sale: { id: string; saleNumber: string; totalXof: number } | null;
  payments?: ReceivablePaymentRow[];
  createdAt: string;
}

interface ShopDetailResponse {
  id: string;
  name: string;
  paymentMethods?: PaymentMethodConfig[];
}

export default function ClientsReceivablesPage() {
  const { user, activeOperator } = useAuth();
  const { shopId, selectShop } = useActiveOperationalShop();

  const [tab, setTab] = useState<'debts' | 'clients'>('debts');
  const [debtFilter, setDebtFilter] = useState<'OPEN' | 'PAID' | 'ALL'>('OPEN');
  const [clientFilterId, setClientFilterId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [onlyIndebted, setOnlyIndebted] = useState(false);

  const [shopName, setShopName] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Formulaire nouveau client
  const [showNewClient, setShowNewClient] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '', address: '', creditLimitXof: 0 });

  // Modal nouvelle dette directe
  const [showNewDebt, setShowNewDebt] = useState(false);
  const [debtForm, setDebtForm] = useState({
    clientId: '',
    amountXof: 0,
    description: '',
    dueDate: '',
    allowCreditOverride: false,
  });

  // Modal encaissement règlement dette
  const [payTarget, setPayTarget] = useState<ReceivableRow | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (debtFilter === 'ALL') qs.set('status', 'ALL');
      else if (debtFilter === 'PAID') qs.set('status', 'PAID');
      if (clientFilterId) qs.set('clientId', clientFilterId);

      const [shopDetail, cl, rec] = await Promise.all([
        apiFetch<ShopDetailResponse>(`/shops/${shopId}`, { shopId }).catch(() => null),
        apiFetch<ClientRow[]>(`/shops/${shopId}/clients`, { shopId }),
        apiFetch<ReceivableRow[]>(
          `/shops/${shopId}/receivables${qs.toString() ? `?${qs.toString()}` : ''}`,
          { shopId },
        ).catch(() => []),
      ]);

      if (shopDetail) {
        setShopName(shopDetail.name || '');
        const enabled = (shopDetail.paymentMethods || []).filter((m) => m.enabled);
        setPaymentMethods(enabled);
        setPayMethod((prev) =>
          prev && enabled.some((m) => m.code === prev) ? prev : enabled[0]?.code || '',
        );
      }
      setClients(cl);
      setReceivables(rec);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement clients & dettes.');
    } finally {
      setLoading(false);
    }
  }, [shopId, debtFilter, clientFilterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeMethodCfg = useMemo(
    () => paymentMethods.find((m) => m.code === payMethod) || null,
    [paymentMethods, payMethod],
  );

  const summary = useMemo(() => {
    const totalDebt = clients.reduce((sum, c) => sum + c.outstandingDebtXof, 0);
    const indebtedCount = clients.filter((c) => c.outstandingDebtXof > 0).length;
    const overdueCount = clients.reduce((sum, c) => sum + (c.overdueDebtsCount || 0), 0);
    const accountsCount = clients.filter((c) => c.hasAccount).length;
    return { totalDebt, indebtedCount, overdueCount, accountsCount };
  }, [clients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (onlyIndebted && c.outstandingDebtXof <= 0) return false;
      if (!q) return true;
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q)
      );
    });
  }, [clients, search, onlyIndebted]);

  const filteredReceivables = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receivables;
    return receivables.filter(
      (r) =>
        r.client.fullName.toLowerCase().includes(q) ||
        r.client.phone.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.sale?.saleNumber || '').toLowerCase().includes(q),
    );
  }, [receivables, search]);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
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
      setShowNewClient(false);
      setMsg('Fiche client enregistrée.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  const openNewDebtModal = (presetClientId?: string) => {
    setDebtForm({
      clientId: presetClientId || clients[0]?.id || '',
      amountXof: 0,
      description: '',
      dueDate: '',
      allowCreditOverride: false,
    });
    setShowNewDebt(true);
  };

  const handleCreateDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !debtForm.clientId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiFetch(`/shops/${shopId}/receivables`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          clientId: debtForm.clientId,
          amountXof: Math.round(Number(debtForm.amountXof) || 0),
          description: debtForm.description.trim(),
          dueDate: debtForm.dueDate ? new Date(`${debtForm.dueDate}T23:59:59Z`).toISOString() : null,
          allowCreditOverride: debtForm.allowCreditOverride,
        },
      });
      setShowNewDebt(false);
      setMsg('Dette client enregistrée.');
      setTab('debts');
      setDebtFilter('OPEN');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement de la dette refusé.');
    } finally {
      setBusy(false);
    }
  };

  const handlePayReceivable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !payTarget || !payMethod) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiFetch(`/shops/${shopId}/receivables/${payTarget.id}/payments`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          amountXof: Math.round(Number(payAmount) || 0),
          paymentMethodCode: payMethod,
          transactionRef: payRef.trim() || undefined,
          notes: payNotes.trim() || undefined,
        },
      });
      setPayTarget(null);
      setPayRef('');
      setPayNotes('');
      setMsg('Règlement de dette encaissé et journalisé.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Encaissement refusé.');
    } finally {
      setBusy(false);
    }
  };

  const buildWhatsAppReminderUrl = (r: ReceivableRow) => {
    const digits = r.client.phone.replace(/[^\d]/g, '');
    const text = `Bonjour ${r.client.fullName}, petit rappel de ${shopName || 'la boutique'} concernant votre solde restant de ${formatXof(r.remainingAmountXof)}${r.sale ? ` (Vente ${r.sale.saleNumber})` : r.description ? ` (${r.description})` : ''}. Merci pour votre confiance.`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  };

  const getMethodLabel = (code: string) =>
    paymentMethods.find((m) => m.code === code)?.label || code;

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-4 sm:space-y-5">
        {/* Entête allégée + Actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl">
              Clients & Dettes
            </h1>
            <p className="text-xs text-slate-500">
              Suivi des crédits clients, enregistrement de dettes directes, échéances et encaissements.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShopPickerInline shopId={shopId} onChange={selectShop} />
            <button
              type="button"
              onClick={() => setShowNewClient((v) => !v)}
              className="sc-btn-ghost flex-1 text-xs sm:flex-none"
            >
              <Plus className="h-3.5 w-3.5" />
              Nouveau client
            </button>
            <button
              type="button"
              disabled={clients.length === 0}
              onClick={() => openNewDebtModal()}
              className="sc-btn-primary flex-1 text-xs sm:flex-none"
            >
              <HandCoins className="h-3.5 w-3.5 text-limeglow-400" />
              Enregistrer une dette
            </button>
          </div>
        </div>

        {/* 4 KPIs Dettes & Clients */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <div className="sc-card p-3.5">
            <p className="text-[11px] font-medium text-slate-500">Total dettes dues</p>
            <p className="mt-1 truncate text-base font-extrabold text-amber-800 tabular sm:text-lg">
              {formatXof(summary.totalDebt)}
            </p>
          </div>
          <div className="sc-card p-3.5">
            <p className="text-[11px] font-medium text-slate-500">Clients endettés</p>
            <p className="mt-1 text-base font-extrabold text-slate-900 tabular sm:text-lg">
              {summary.indebtedCount}
            </p>
          </div>
          <div className="sc-card p-3.5">
            <p className="text-[11px] font-medium text-slate-500">Échéances en retard</p>
            <p
              className={`mt-1 text-base font-extrabold tabular sm:text-lg ${
                summary.overdueCount > 0 ? 'text-rose-600' : 'text-emerald-700'
              }`}
            >
              {summary.overdueCount}
            </p>
          </div>
          <div className="sc-card p-3.5">
            <p className="text-[11px] font-medium text-slate-500">Fichier clients</p>
            <p className="mt-1 text-base font-extrabold text-slate-900 tabular sm:text-lg">
              {clients.length}{' '}
              <span className="text-[11px] font-medium text-slate-400">
                ({summary.accountsCount} vitrine)
              </span>
            </p>
          </div>
        </div>

        {/* Formulaire création client repliable */}
        {showNewClient ? (
          <form onSubmit={handleCreateClient} className="sc-card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Nouvelle fiche client</h2>
              <button
                type="button"
                onClick={() => setShowNewClient(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="Nom complet *"
                className="sc-input"
              />
              <input
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Téléphone *"
                className="sc-input"
              />
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Quartier / Adresse"
                className="sc-input"
              />
              <input
                type="number"
                min={0}
                value={form.creditLimitXof || ''}
                onChange={(e) => setForm({ ...form, creditLimitXof: Number(e.target.value) || 0 })}
                placeholder="Plafond crédit XOF (0 = libre)"
                className="sc-input"
              />
              <button type="submit" disabled={busy} className="sc-btn-primary text-xs">
                <Plus className="h-4 w-4" />
                Enregistrer
              </button>
            </div>
          </form>
        ) : null}

        {/* Barre d'onglets + Recherche */}
        <div className="sc-card flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="grid w-full grid-cols-2 gap-1 rounded-xl bg-[#edf1f5] p-1 text-xs font-semibold sm:inline-flex sm:w-auto">
            <button
              type="button"
              onClick={() => setTab('debts')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                tab === 'debts' ? 'bg-forest-900 text-white' : 'text-slate-600'
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              Dettes ({receivables.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('clients')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                tab === 'clients' ? 'bg-forest-900 text-white' : 'text-slate-600'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Clients ({clients.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tab === 'debts' ? (
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
                {(
                  [
                    { key: 'OPEN', label: 'Ouvertes' },
                    { key: 'PAID', label: 'Soldées' },
                    { key: 'ALL', label: 'Toutes' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => setDebtFilter(st.key)}
                    className={`rounded-lg px-2.5 py-1 transition ${
                      debtFilter === st.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            ) : (
              <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={onlyIndebted}
                  onChange={(e) => setOnlyIndebted(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-700"
                />
                Endettés uniquement
              </label>
            )}

            {clientFilterId ? (
              <button
                type="button"
                onClick={() => setClientFilterId('')}
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800"
              >
                Filtre client actif
                <X className="h-3 w-3" />
              </button>
            ) : null}

            <div className="relative flex-1 sm:w-52 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher nom, tél…"
                className="sc-input py-1.5 pl-8 text-xs"
              />
            </div>
          </div>
        </div>

        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : tab === 'debts' ? (
          filteredReceivables.length === 0 ? (
            <EmptyState
              title="Aucune dette sur ce filtre"
              description="Enregistrez une dette directe ou effectuez une vente partiellement payée au comptoir POS."
              action={
                clients.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => openNewDebtModal()}
                    className="sc-btn-primary text-xs"
                  >
                    <HandCoins className="h-4 w-4 text-limeglow-400" />
                    Enregistrer une dette
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredReceivables.map((r) => {
                const isPaid = r.status === 'PAID';
                return (
                  <div
                    key={r.id}
                    className={`sc-card space-y-3 p-4 ${
                      r.isOverdue ? 'border-rose-300 bg-rose-50/20' : ''
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900">
                            {r.client.fullName}
                          </span>
                          <span className="text-xs text-slate-500">{r.client.phone}</span>
                          {r.sale ? (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700">
                              {r.sale.saleNumber}
                            </span>
                          ) : (
                            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                              Dette directe
                            </span>
                          )}
                          {isPaid ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                              Soldée
                            </span>
                          ) : r.isOverdue ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                              <AlertTriangle className="h-3 w-3" />
                              Échéance dépassée
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              {r.ageDays} j
                            </span>
                          )}
                        </div>

                        {r.description ? (
                          <p className="text-xs text-slate-700">{r.description}</p>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 tabular">
                          <span>Initial : {formatXof(r.initialAmountXof)}</span>
                          <span>Réglé : {formatXof(r.paidAmountXof)}</span>
                          <span
                            className={`font-extrabold ${
                              isPaid ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            Reste : {formatXof(r.remainingAmountXof)}
                          </span>
                          {r.dueDate ? (
                            <span className="inline-flex items-center gap-1 text-[11px]">
                              <CalendarClock className="h-3 w-3" />
                              Échéance : {new Date(r.dueDate).toLocaleDateString('fr-FR')}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {!isPaid ? (
                        <div className="flex flex-wrap gap-2 sm:shrink-0">
                          <a
                            href={buildWhatsAppReminderUrl(r)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sc-btn-ghost flex-1 py-1.5 text-xs sm:flex-none"
                          >
                            <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
                            Rappel
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setPayTarget(r);
                              setPayAmount(r.remainingAmountXof);
                              setPayMethod(paymentMethods[0]?.code || '');
                              setPayRef('');
                              setPayNotes('');
                            }}
                            className="sc-btn-primary flex-1 py-1.5 text-xs sm:flex-none"
                          >
                            <HandCoins className="h-3.5 w-3.5 text-limeglow-400" />
                            Encaisser
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {/* Historique des versements effectués */}
                    {r.payments && r.payments.length > 0 ? (
                      <div className="rounded-xl bg-[#f7f9fb] p-2.5 text-[11px]">
                        <p className="mb-1 font-semibold text-slate-500">
                          Versements ({r.payments.length})
                        </p>
                        <div className="space-y-1">
                          {r.payments.map((p) => (
                            <div
                              key={p.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-slate-600"
                            >
                              <span>
                                {formatDateTimeInTimezone(p.createdAt)} ·{' '}
                                <strong>{getMethodLabel(p.paymentMethodCode)}</strong>
                                {p.transactionRef ? ` (${p.transactionRef})` : ''}
                                {p.notes ? ` — ${p.notes}` : ''}
                              </span>
                              <span className="font-mono font-bold text-emerald-700">
                                +{formatXof(p.amountXof)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : filteredClients.length === 0 ? (
          <EmptyState
            title="Aucun client trouvé"
            description="Ajoutez vos clients réguliers ou crédits pour suivre leurs achats et dettes."
          />
        ) : (
          <>
            {/* Cartes mobiles (< md) */}
            <div className="space-y-2.5 md:hidden">
              {filteredClients.map((c) => (
                <div key={`m-${c.id}`} className="sc-card space-y-2.5 p-4 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-bold text-slate-900">{c.fullName}</p>
                        {c.hasAccount ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-800">
                            <UserCheck className="h-3 w-3" />
                            Compte
                          </span>
                        ) : null}
                      </div>
                      <p className="text-slate-500">
                        {c.phone}
                        {c.address ? ` · ${c.address}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#f7f9fb] p-2 text-center tabular">
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400">Plafond</p>
                      <p className="truncate font-semibold text-slate-800">
                        {c.creditLimitXof > 0 ? formatXof(c.creditLimitXof) : 'Libre'}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400">Dette due</p>
                      <p
                        className={`truncate font-bold ${
                          c.outstandingDebtXof > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {formatXof(c.outstandingDebtXof)}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400">Ventes</p>
                      <p className="font-semibold text-slate-700">{c.salesCount}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => openNewDebtModal(c.id)}
                      className="sc-btn-primary py-1.5 text-xs"
                    >
                      + Dette
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClientFilterId(c.id);
                        setDebtFilter('ALL');
                        setTab('debts');
                      }}
                      className="sc-btn-ghost py-1.5 text-xs"
                    >
                      Historique dettes
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Tableau desktop (>= md) */}
            <div className="sc-card hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-porcelain-50 text-left text-xs font-bold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Plafond crédit</th>
                    <th className="px-4 py-3">Dette en cours</th>
                    <th className="px-4 py-3">Ventes</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredClients.map((c) => (
                    <tr key={c.id} className="hover:bg-porcelain-50/70">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{c.fullName}</span>
                          {c.hasAccount ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-800">
                              <UserCheck className="h-3 w-3" />
                              Compte vitrine
                            </span>
                          ) : null}
                        </div>
                        <p className="text-slate-500">
                          {c.phone}
                          {c.address ? ` · ${c.address}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-medium tabular">
                        {c.creditLimitXof > 0 ? formatXof(c.creditLimitXof) : 'Libre'}
                      </td>
                      <td className="px-4 py-3 font-extrabold tabular">
                        <span
                          className={
                            c.outstandingDebtXof > 0 ? 'text-rose-700' : 'text-emerald-700'
                          }
                        >
                          {formatXof(c.outstandingDebtXof)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c.salesCount}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => openNewDebtModal(c.id)}
                            className="sc-btn-primary px-2.5 py-1.5 text-xs"
                          >
                            + Dette
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setClientFilterId(c.id);
                              setDebtFilter('ALL');
                              setTab('debts');
                            }}
                            className="sc-btn-ghost px-2.5 py-1.5 text-xs"
                          >
                            Détails
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Modal Nouvelle Dette Directe */}
        {showNewDebt ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleCreateDebt}
              className="w-full max-w-md space-y-3.5 rounded-2xl bg-white p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">Enregistrer une dette client</h3>
                <button
                  type="button"
                  onClick={() => setShowNewDebt(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Client *</label>
                <select
                  required
                  value={debtForm.clientId}
                  onChange={(e) => setDebtForm({ ...debtForm, clientId: e.target.value })}
                  className="sc-input"
                >
                  <option value="">Sélectionner un client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Montant de la dette (XOF) *
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={debtForm.amountXof || ''}
                  onChange={(e) =>
                    setDebtForm({ ...debtForm, amountXof: Number(e.target.value) || 0 })
                  }
                  placeholder="Ex. 15000"
                  className="sc-input font-bold tabular"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Motif / Description *
                </label>
                <input
                  required
                  minLength={2}
                  value={debtForm.description}
                  onChange={(e) => setDebtForm({ ...debtForm, description: e.target.value })}
                  placeholder="Ex. Marchandise prise à crédit, solde antérieur…"
                  className="sc-input"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Date d’échéance prévue (optionnel)
                </label>
                <input
                  type="date"
                  value={debtForm.dueDate}
                  onChange={(e) => setDebtForm({ ...debtForm, dueDate: e.target.value })}
                  className="sc-input"
                />
              </div>

              {user?.role === 'OWNER' ? (
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={debtForm.allowCreditOverride}
                    onChange={(e) =>
                      setDebtForm({ ...debtForm, allowCreditOverride: e.target.checked })
                    }
                    className="h-4 w-4 accent-brand-700"
                  />
                  Autoriser le dépassement du plafond crédit client
                </label>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewDebt(false)}
                  className="sc-btn-ghost text-xs"
                >
                  Annuler
                </button>
                <button type="submit" disabled={busy} className="sc-btn-primary text-xs">
                  {busy ? 'Enregistrement…' : 'Enregistrer la dette'}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Modal Encaissement Règlement (Moyens de paiement dynamiques de la boutique) */}
        {payTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4 backdrop-blur-xs">
            <form
              onSubmit={handlePayReceivable}
              className="w-full max-w-md space-y-3.5 rounded-2xl bg-white p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">
                  Encaisser — {payTarget.client.fullName}
                </h3>
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-950">
                Reste dû : <strong className="tabular">{formatXof(payTarget.remainingAmountXof)}</strong>
              </p>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Montant encaissé (XOF) *
                </label>
                <input
                  type="number"
                  min={1}
                  max={payTarget.remainingAmountXof}
                  required
                  value={payAmount || ''}
                  onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
                  className="sc-input font-bold tabular"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Moyen de paiement *
                </label>
                <select
                  required
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="sc-input"
                >
                  {paymentMethods.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                      {m.affectsCashDrawer ? ' (entrée en caisse)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {activeMethodCfg?.requireReference ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-amber-900">
                    Référence transaction ({activeMethodCfg.label}) *
                  </label>
                  <input
                    required
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    placeholder="Référence unique obligatoire"
                    className="sc-input border-amber-300 font-mono"
                  />
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Note (optionnel)
                </label>
                <input
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Ex. Acompte semaine 2"
                  className="sc-input"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="sc-btn-ghost text-xs"
                >
                  Annuler
                </button>
                <button type="submit" disabled={busy || !payMethod} className="sc-btn-primary text-xs">
                  {busy ? 'Encaissement…' : 'Confirmer le règlement'}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
