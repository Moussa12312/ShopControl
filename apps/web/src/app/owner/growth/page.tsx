'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Cloud, FileSpreadsheet, Gift, MessageSquare, Smartphone, Tag } from 'lucide-react';
import { formatXof } from '@shopcontrol/shared';
import { apiFetch, API_BASE_URL, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

type TabKey = 'loyalty' | 'promotions' | 'commissions' | 'mobile' | 'ohada' | 'backup';

const TABS: Array<{ key: TabKey; label: string; icon: React.ElementType }> = [
  { key: 'loyalty', label: 'Fidélité', icon: Gift },
  { key: 'promotions', label: 'Promotions', icon: Tag },
  { key: 'commissions', label: 'Commissions', icon: Banknote },
  { key: 'mobile', label: 'Mobile Money & SMS', icon: Smartphone },
  { key: 'ohada', label: 'Comptabilité OHADA', icon: FileSpreadsheet },
  { key: 'backup', label: 'Sauvegarde', icon: Cloud },
];

interface LoyaltyOverview {
  rule: { isEnabled: boolean; pointsPer100Xof: number; minSaleXof: number };
  tiers: Array<{ id: string; name: string; minLifetimePoints: number; discountPercent: number; badgeColor: string }>;
  rewards: Array<{ id: string; name: string; pointsCost: number; discountType: string; discountValue: number }>;
}
interface GrowthConfig {
  smsEnabled?: boolean;
  waveLink?: string;
  wavePhone?: string;
  orangeMoneyCode?: string;
}
interface CommissionRule {
  id: string;
  agentUserId: string | null;
  percentBps: number;
  minSaleXof: number;
  isActive: boolean;
}
interface CommissionReport {
  month: string;
  totalEarnedXof: number;
  totalUnpaidXof: number;
  agents: Array<{
    agentUserId: string;
    agentName: string;
    salesCount: number;
    salesTotalXof: number;
    earnedXof: number;
    unpaidXof: number;
  }>;
}
interface AgentRow {
  id: string;
  fullName: string;
}
interface TvaSummary {
  salesCount: number;
  turnoverHtXof: number;
  turnoverTtcXof: number;
  tvaCollecteeXof: number;
  tvaDeductibleXof: number;
  soldeADeclarerXof: number;
}
interface BackupStatus {
  enabled: boolean;
  configured: boolean;
  last: { at: string; ok: boolean; message: string } | null;
}

const inputCls =
  'w-full rounded-xl border border-white/10 bg-forest-900/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30';
const btnCls =
  'inline-flex w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-forest-950 transition hover:bg-emerald-400 disabled:opacity-50 sm:w-auto';
const cardCls = 'rounded-2xl border border-white/10 bg-forest-800/60 p-4 sm:p-5';

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function GrowthPage() {
  const { shops, selectedShopId } = useAuth();
  const [tab, setTab] = useState<TabKey>('loyalty');
  const [shopId, setShopId] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (shopId || !shops?.length) return;
    const preferred = selectedShopId !== 'ALL' ? shops.find((s) => s.shopId === selectedShopId) : null;
    setShopId((preferred ?? shops[0]).shopId);
  }, [shops, selectedShopId, shopId]);

  const flash = useCallback((ok: boolean, err: unknown) => {
    setNotice({ ok, text: typeof err === 'string' ? err : err instanceof ApiError ? err.message : 'Une erreur est survenue.' });
  }, []);

  return (
    <AppShell
      allowedRoles={['OWNER']}
      title="Croissance & Comptabilité"
      subtitle="Fidélité clients, commissions agents, paiement mobile, export OHADA et sauvegarde."
      headerActions={
        shops && shops.length > 1 ? (
          <select
            aria-label="Boutique"
            className={`${inputCls} sm:w-56`}
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
          >
            {shops.map((s) => (
              <option key={s.shopId} value={s.shopId}>
                {s.shopName}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-forest-800/80 p-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key);
                setNotice(null);
              }}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold sm:text-sm ${
                tab === key ? 'bg-emerald-500 text-forest-950' : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>

        {notice && (
          <p
            role="status"
            className={`rounded-xl border px-3 py-2 text-sm ${
              notice.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'
            }`}
          >
            {notice.text}
          </p>
        )}

        {!shopId ? (
          <LoadingSkeleton />
        ) : (
          <>
            {tab === 'loyalty' && <LoyaltyTab shopId={shopId} flash={flash} />}
            {tab === 'promotions' && <PromotionsTab shopId={shopId} flash={flash} />}
            {tab === 'commissions' && <CommissionsTab shopId={shopId} flash={flash} />}
            {tab === 'mobile' && <MobileTab shopId={shopId} flash={flash} />}
            {tab === 'ohada' && <OhadaTab shopId={shopId} flash={flash} />}
            {tab === 'backup' && <BackupTab flash={flash} />}
          </>
        )}
      </div>
    </AppShell>
  );
}

type TabProps = { shopId: string; flash: (ok: boolean, err: unknown) => void };

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-xs font-medium text-slate-300">
      <span>{label}</span>
      {children}
      {hint && <span className="block text-[11px] font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

/* ----------------------------------------------------------------- Fidélité */

function LoyaltyTab({ shopId, flash }: TabProps) {
  const [data, setData] = useState<LoyaltyOverview | null>(null);
  const [error, setError] = useState('');
  const [rule, setRule] = useState({ isEnabled: false, pointsPer100Xof: 1, minSaleXof: 500 });
  const [reward, setReward] = useState({ name: '', pointsCost: 100, discountType: 'PERCENT', discountValue: 5 });

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<LoyaltyOverview>(`/shops/${shopId}/loyalty`, { shopId });
      setData(res);
      setRule(res.rule);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRule = async () => {
    try {
      await apiFetch(`/shops/${shopId}/loyalty/rule`, { method: 'PUT', shopId, body: rule });
      flash(true, 'Programme de fidélité enregistré.');
      void load();
    } catch (e) {
      flash(false, e);
    }
  };

  const addReward = async () => {
    try {
      await apiFetch(`/shops/${shopId}/loyalty/rewards`, { method: 'POST', shopId, body: reward });
      flash(true, 'Récompense ajoutée.');
      setReward({ name: '', pointsCost: 100, discountType: 'PERCENT', discountValue: 5 });
      void load();
    } catch (e) {
      flash(false, e);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingSkeleton />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${cardCls} space-y-3`}>
        <h2 className="text-sm font-bold text-white">Règles des points</h2>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={rule.isEnabled} onChange={(e) => setRule({ ...rule, isEnabled: e.target.checked })} />
          Activer le programme de fidélité
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Points par tranche de 100 FCFA">
            <input type="number" min={1} max={100} className={inputCls} value={rule.pointsPer100Xof} onChange={(e) => setRule({ ...rule, pointsPer100Xof: Number(e.target.value) })} />
          </Field>
          <Field label="Achat minimum (FCFA)">
            <input type="number" min={0} className={inputCls} value={rule.minSaleXof} onChange={(e) => setRule({ ...rule, minSaleXof: Number(e.target.value) })} />
          </Field>
        </div>
        <button className={btnCls} onClick={saveRule}>Enregistrer</button>
        <h3 className="pt-2 text-xs font-bold uppercase tracking-wide text-slate-400">Paliers</h3>
        <ul className="space-y-1 text-sm text-slate-200">
          {data.tiers.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5">
              <span className="font-semibold" style={{ color: t.badgeColor }}>{t.name}</span>
              <span className="text-xs text-slate-400">dès {t.minLifetimePoints} pts · remise {t.discountPercent}%</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${cardCls} space-y-3`}>
        <h2 className="text-sm font-bold text-white">Récompenses échangeables</h2>
        {data.rewards.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune récompense. Ajoutez-en une ci-dessous.</p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-200">
            {data.rewards.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5">
                <span>{r.name}</span>
                <span className="text-xs text-slate-400">
                  {r.pointsCost} pts → {r.discountType === 'PERCENT' ? `${r.discountValue}%` : formatXof(r.discountValue)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nom">
            <input className={inputCls} value={reward.name} onChange={(e) => setReward({ ...reward, name: e.target.value })} />
          </Field>
          <Field label="Coût (points)">
            <input type="number" min={1} className={inputCls} value={reward.pointsCost} onChange={(e) => setReward({ ...reward, pointsCost: Number(e.target.value) })} />
          </Field>
          <Field label="Type de remise">
            <select className={inputCls} value={reward.discountType} onChange={(e) => setReward({ ...reward, discountType: e.target.value })}>
              <option value="PERCENT">Pourcentage</option>
              <option value="FIXED">Montant fixe (FCFA)</option>
            </select>
          </Field>
          <Field label="Valeur">
            <input type="number" min={1} className={inputCls} value={reward.discountValue} onChange={(e) => setReward({ ...reward, discountValue: Number(e.target.value) })} />
          </Field>
        </div>
        <button className={btnCls} disabled={reward.name.trim().length < 2} onClick={addReward}>Ajouter la récompense</button>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Promotions */

interface PromotionRow {
  id: string;
  name: string;
  discountPercent: number;
  appliesToAll: boolean;
  productIds: string[];
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}
interface ProductOption {
  id: string;
  name: string;
}

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function PromotionsTab({ shopId, flash }: TabProps) {
  const [rows, setRows] = useState<PromotionRow[] | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    discountPercent: 10,
    appliesToAll: true,
    productIds: [] as string[],
    startsAt: toLocalInput(new Date()),
    endsAt: toLocalInput(new Date(Date.now() + 7 * 86_400_000)),
  });

  const load = useCallback(async () => {
    try {
      const [p, prods] = await Promise.all([
        apiFetch<PromotionRow[]>(`/shops/${shopId}/promotions`, { shopId }),
        apiFetch<ProductOption[] | { items: ProductOption[] }>(`/shops/${shopId}/products`, { shopId }),
      ]);
      setRows(p);
      setProducts(Array.isArray(prods) ? prods : prods.items ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    try {
      await apiFetch(`/shops/${shopId}/promotions`, {
        method: 'POST',
        shopId,
        body: {
          ...form,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        },
      });
      flash(true, 'Promotion créée.');
      setForm({ ...form, name: '', productIds: [] });
      void load();
    } catch (e) {
      flash(false, e);
    }
  };

  const toggle = async (p: PromotionRow) => {
    try {
      await apiFetch(`/shops/${shopId}/promotions/${p.id}/active`, { method: 'PUT', shopId, body: { isActive: !p.isActive } });
      void load();
    } catch (e) {
      flash(false, e);
    }
  };

  const remove = async (p: PromotionRow) => {
    if (!window.confirm(`Supprimer la promotion « ${p.name} » ?`)) return;
    try {
      await apiFetch(`/shops/${shopId}/promotions/${p.id}`, { method: 'DELETE', shopId });
      void load();
    } catch (e) {
      flash(false, e);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <LoadingSkeleton />;

  const now = Date.now();
  const status = (p: PromotionRow) =>
    !p.isActive ? 'Suspendue' : now < Date.parse(p.startsAt) ? 'À venir' : now > Date.parse(p.endsAt) ? 'Terminée' : 'En cours';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${cardCls} space-y-3`}>
        <h2 className="text-sm font-bold text-white">Nouvelle promotion</h2>
        <p className="text-xs text-slate-400">
          Appliquée automatiquement à la caisse entre les deux dates. Une remise saisie à la main sur un article remplace la promotion.
        </p>
        <Field label="Nom (ex. Soldes de fin d’année)">
          <input className={inputCls} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Remise (%)">
          <input type="number" min={1} max={100} step={0.5} className={inputCls} value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Début"><input type="datetime-local" className={inputCls} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
          <Field label="Fin"><input type="datetime-local" className={inputCls} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={form.appliesToAll} onChange={(e) => setForm({ ...form, appliesToAll: e.target.checked })} />
          Toute la boutique
        </label>
        {!form.appliesToAll && (
          <Field label="Produits concernés (Ctrl/Cmd pour en choisir plusieurs)">
            <select
              multiple
              size={6}
              className={inputCls}
              value={form.productIds}
              onChange={(e) => setForm({ ...form, productIds: Array.from(e.target.selectedOptions, (o) => o.value) })}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        )}
        <button
          className={btnCls}
          disabled={form.name.trim().length < 2 || (!form.appliesToAll && form.productIds.length === 0)}
          onClick={create}
        >
          Créer la promotion
        </button>
      </section>

      <section className={`${cardCls} space-y-3`}>
        <h2 className="text-sm font-bold text-white">Promotions</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune promotion pour le moment.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => (
              <li key={p.id} className="space-y-1 rounded-xl bg-white/5 p-3 text-sm text-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{p.name} · −{p.discountPercent} %</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">{status(p)}</span>
                </div>
                <p className="text-xs text-slate-400">
                  {new Date(p.startsAt).toLocaleString('fr-FR')} → {new Date(p.endsAt).toLocaleString('fr-FR')} ·{' '}
                  {p.appliesToAll ? 'Toute la boutique' : `${p.productIds.length} produit(s)`}
                </p>
                <div className="flex gap-2 pt-1">
                  <button className="rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20" onClick={() => toggle(p)}>
                    {p.isActive ? 'Suspendre' : 'Réactiver'}
                  </button>
                  <button className="rounded-lg bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/30" onClick={() => remove(p)}>
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------- Commissions */

function CommissionsTab({ shopId, flash }: TabProps) {
  const [month, setMonth] = useState(thisMonth());
  const [report, setReport] = useState<CommissionReport | null>(null);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ agentUserId: '', percent: 2, minSaleXof: 0 });

  const load = useCallback(async () => {
    try {
      const [r, ru, ag] = await Promise.all([
        apiFetch<CommissionReport>(`/shops/${shopId}/commissions/report?month=${month}`, { shopId }),
        apiFetch<CommissionRule[]>(`/shops/${shopId}/commissions/rules`, { shopId }),
        apiFetch<AgentRow[]>(`/shops/${shopId}/agents`, { shopId }),
      ]);
      setReport(r);
      setRules(ru);
      setAgents(ag);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    }
  }, [shopId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const names = useMemo(() => new Map(agents.map((a) => [a.id, a.fullName])), [agents]);

  const saveRule = async () => {
    try {
      await apiFetch(`/shops/${shopId}/commissions/rules`, {
        method: 'PUT',
        shopId,
        body: {
          agentUserId: draft.agentUserId || null,
          percentBps: Math.round(draft.percent * 100),
          minSaleXof: draft.minSaleXof,
          isActive: true,
        },
      });
      flash(true, 'Règle de commission enregistrée.');
      void load();
    } catch (e) {
      flash(false, e);
    }
  };

  const markPaid = async (agentUserId: string) => {
    try {
      await apiFetch(`/shops/${shopId}/commissions/mark-paid`, { method: 'POST', shopId, body: { month, agentUserId } });
      flash(true, 'Commissions marquées comme payées.');
      void load();
    } catch (e) {
      flash(false, e);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!report) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <section className={`${cardCls} space-y-3`}>
        <h2 className="text-sm font-bold text-white">Taux de commission</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Agent">
            <select className={inputCls} value={draft.agentUserId} onChange={(e) => setDraft({ ...draft, agentUserId: e.target.value })}>
              <option value="">Tous les agents (règle globale)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.fullName}</option>
              ))}
            </select>
          </Field>
          <Field label="Commission (%)">
            <input type="number" min={0} max={50} step={0.1} className={inputCls} value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: Number(e.target.value) })} />
          </Field>
          <Field label="Vente minimum (FCFA)">
            <input type="number" min={0} className={inputCls} value={draft.minSaleXof} onChange={(e) => setDraft({ ...draft, minSaleXof: Number(e.target.value) })} />
          </Field>
          <div className="flex items-end">
            <button className={btnCls} onClick={saveRule}>Enregistrer</button>
          </div>
        </div>
        {rules.length > 0 && (
          <ul className="space-y-1 text-sm text-slate-200">
            {rules.map((r) => (
              <li key={r.id} className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5">
                <span>{r.agentUserId ? names.get(r.agentUserId) ?? 'Agent' : 'Règle globale'}</span>
                <span className="text-xs text-slate-400">{(r.percentBps / 100).toFixed(2)}% dès {formatXof(r.minSaleXof)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${cardCls} space-y-3`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-white">Paie du mois</h2>
          <input type="month" aria-label="Mois" className={`${inputCls} sm:w-44`} value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        {report.agents.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune commission sur cette période.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm text-slate-200">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-2">Agent</th>
                  <th>Ventes</th>
                  <th>CA</th>
                  <th>Commission</th>
                  <th>Reste à payer</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {report.agents.map((a) => (
                  <tr key={a.agentUserId} className="border-t border-white/5">
                    <td className="py-2 font-medium">{a.agentName}</td>
                    <td>{a.salesCount}</td>
                    <td>{formatXof(a.salesTotalXof)}</td>
                    <td>{formatXof(a.earnedXof)}</td>
                    <td>{formatXof(a.unpaidXof)}</td>
                    <td className="text-right">
                      {a.unpaidXof > 0 ? (
                        <button className="rounded-lg bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30" onClick={() => markPaid(a.agentUserId)}>
                          Marquer payé
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-300">Payé</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400">
          Total : {formatXof(report.totalEarnedXof)} · Reste à payer : {formatXof(report.totalUnpaidXof)}
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------- Mobile Money & SMS */

function MobileTab({ shopId, flash }: TabProps) {
  const [cfg, setCfg] = useState<GrowthConfig | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setCfg(await apiFetch<GrowthConfig>(`/shops/${shopId}/growth/config`, { shopId }));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!cfg) return;
    try {
      await apiFetch(`/shops/${shopId}/growth/config`, {
        method: 'PUT',
        shopId,
        body: {
          smsEnabled: Boolean(cfg.smsEnabled),
          waveLink: cfg.waveLink ?? '',
          wavePhone: cfg.wavePhone ?? '',
          orangeMoneyCode: cfg.orangeMoneyCode ?? '',
        },
      });
      flash(true, 'Configuration enregistrée.');
    } catch (e) {
      flash(false, e);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!cfg) return <LoadingSkeleton />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${cardCls} space-y-3`}>
        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Smartphone className="h-4 w-4" aria-hidden /> Paiement mobile (QR)</h2>
        <Field label="Lien de paiement Wave Business" hint="Le montant est ajouté automatiquement au QR.">
          <input className={inputCls} placeholder="https://pay.wave.com/m/..." value={cfg.waveLink ?? ''} onChange={(e) => setCfg({ ...cfg, waveLink: e.target.value })} />
        </Field>
        <Field label="Numéro Wave marchand">
          <input className={inputCls} inputMode="tel" value={cfg.wavePhone ?? ''} onChange={(e) => setCfg({ ...cfg, wavePhone: e.target.value })} />
        </Field>
        <Field label="Code marchand Orange Money">
          <input className={inputCls} value={cfg.orangeMoneyCode ?? ''} onChange={(e) => setCfg({ ...cfg, orangeMoneyCode: e.target.value })} />
        </Field>
      </section>
      <section className={`${cardCls} space-y-3`}>
        <h2 className="flex items-center gap-2 text-sm font-bold text-white"><MessageSquare className="h-4 w-4" aria-hidden /> SMS / WhatsApp</h2>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={Boolean(cfg.smsEnabled)} onChange={(e) => setCfg({ ...cfg, smsEnabled: e.target.checked })} />
          Envoyer un SMS de confirmation après chaque vente d’un client enregistré
        </label>
        <p className="text-xs text-slate-400">
          Les messages passent par la passerelle définie côté serveur (variables REMINDER_WEBHOOK_URL / REMINDER_WEBHOOK_TOKEN). Les relances de dettes utilisent la même passerelle.
        </p>
        <button className={btnCls} onClick={save}>Enregistrer</button>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------------- OHADA */

function OhadaTab({ shopId, flash }: TabProps) {
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(today());
  const [month, setMonth] = useState(thisMonth());
  const [tva, setTva] = useState<TvaSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTva = useCallback(async () => {
    try {
      setTva(await apiFetch<TvaSummary>(`/shops/${shopId}/reports/ohada/tva-summary?month=${month}`, { shopId }));
    } catch (e) {
      flash(false, e);
    }
  }, [shopId, month, flash]);

  useEffect(() => {
    void loadTva();
  }, [loadTva]);

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/shops/${shopId}/reports/ohada/journal-ventes?from=${from}&to=${to}`, {
        credentials: 'include',
        headers: { 'x-shop-id': shopId },
      });
      if (!res.ok) throw new Error('Export impossible.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `journal-ventes-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      flash(false, e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${cardCls} space-y-3`}>
        <h2 className="text-sm font-bold text-white">Livre-journal des ventes (CSV)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Du"><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Au"><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <button className={btnCls} disabled={busy || !from || !to} onClick={download}>Télécharger le journal</button>
        <p className="text-xs text-slate-400">Comptes : 411 Clients (débit), 707 Ventes (crédit HT), 4431 TVA collectée.</p>
      </section>
      <section className={`${cardCls} space-y-3`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-white">Récapitulatif TVA</h2>
          <input type="month" aria-label="Mois" className={`${inputCls} w-40`} value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        {!tva ? (
          <LoadingSkeleton />
        ) : (
          <dl className="space-y-1 text-sm text-slate-200">
            {[
              ['Ventes', String(tva.salesCount)],
              ['Chiffre d’affaires HT', formatXof(tva.turnoverHtXof)],
              ['Chiffre d’affaires TTC', formatXof(tva.turnoverTtcXof)],
              ['TVA collectée', formatXof(tva.tvaCollecteeXof)],
              ['TVA déductible', formatXof(tva.tvaDeductibleXof)],
              ['Solde à déclarer', formatXof(tva.soldeADeclarerXof)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5">
                <dt className="text-slate-400">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Sauvegarde */

function BackupTab({ flash }: { flash: (ok: boolean, err: unknown) => void }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await apiFetch<BackupStatus>('/backup/status'));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/backup/run', { method: 'POST' });
      flash(res.ok, res.message);
      void load();
    } catch (e) {
      flash(false, e);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!status) return <LoadingSkeleton />;

  return (
    <section className={`${cardCls} space-y-3`}>
      <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Cloud className="h-4 w-4" aria-hidden /> Sauvegarde quotidienne Telegram</h2>
      <ul className="space-y-1 text-sm text-slate-200">
        <li>Planification automatique (02h UTC) : <strong>{status.enabled ? 'activée' : 'désactivée'}</strong></li>
        <li>Bot et canal Telegram : <strong>{status.configured ? 'configurés' : 'non configurés'}</strong></li>
        {status.last && (
          <li>
            Dernière sauvegarde : {new Date(status.last.at).toLocaleString('fr-FR')} — {status.last.ok ? 'réussie' : 'échec'} ({status.last.message})
          </li>
        )}
      </ul>
      <p className="text-xs text-slate-400">
        Le jeton du bot et l’identifiant du canal se définissent sur le serveur (BACKUP_ENABLED, BACKUP_TELEGRAM_BOT_TOKEN, BACKUP_TELEGRAM_CHAT_ID) afin de ne jamais exposer de secret dans le navigateur.
      </p>
      {user?.role === 'SUPER_ADMIN' && (
        <button className={btnCls} disabled={busy || !status.configured} onClick={run}>Lancer une sauvegarde maintenant</button>
      )}
    </section>
  );
}
