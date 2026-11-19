'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Database, ExternalLink, Pencil, Plus, QrCode, Settings } from 'lucide-react';
import {
  DEFAULT_CURRENCY,
  DEFAULT_DAILY_REPORT_TIME,
  DEFAULT_TIMEZONE,
  TaxMode,
  TAX_MODES,
} from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ShopQrModal } from '@/components/commerce/ShopQrModal';
import { ImageUploader } from '@/components/ui/ImageUploader';
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '@/components/ui/StateViews';

interface ShopRow {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  status: string;
  dbName: string;
  dbStatus: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  dailyReportTime: string;
  taxMode: TaxMode;
  defaultTaxRateBps: number;
  requireOperatorPin: boolean;
  activeAgentsCount: number;
  activeOperatorsCount: number;
  activeTerminalsCount: number;
}

export default function OwnerShopsPage() {
  const { refreshMe, supportGrantId } = useAuth();
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingShop, setEditingShop] = useState<ShopRow | null>(null);
  const [qrShop, setQrShop] = useState<ShopRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    logoUrl: null as string | null,
    phone: '',
    address: '',
    currency: DEFAULT_CURRENCY,
    timezone: DEFAULT_TIMEZONE,
    dailyReportTime: DEFAULT_DAILY_REPORT_TIME,
    taxMode: 'NONE' as TaxMode,
    defaultTaxRateBps: 0,
    requireOperatorPin: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ShopRow[]>('/shops', { supportGrantId });
      setShops(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les boutiques.');
    } finally {
      setLoading(false);
    }
  }, [supportGrantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingShop(null);
    setFormError(null);
    setForm({
      name: '',
      slug: '',
      logoUrl: null,
      phone: '',
      address: '',
      currency: DEFAULT_CURRENCY,
      timezone: DEFAULT_TIMEZONE,
      dailyReportTime: DEFAULT_DAILY_REPORT_TIME,
      taxMode: 'NONE',
      defaultTaxRateBps: 0,
      requireOperatorPin: false,
    });
    setModalOpen(true);
  };

  const openEdit = (shop: ShopRow) => {
    setEditingShop(shop);
    setFormError(null);
    setForm({
      name: shop.name,
      slug: shop.slug,
      logoUrl: shop.logoUrl || null,
      phone: shop.phone || '',
      address: shop.address || '',
      currency: shop.currency,
      timezone: shop.timezone,
      dailyReportTime: shop.dailyReportTime,
      taxMode: shop.taxMode,
      defaultTaxRateBps: shop.defaultTaxRateBps,
      requireOperatorPin: shop.requireOperatorPin,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
        logoUrl: form.logoUrl,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        currency: form.currency,
        timezone: form.timezone,
        dailyReportTime: form.dailyReportTime,
        taxMode: form.taxMode,
        defaultTaxRateBps: Number(form.defaultTaxRateBps) || 0,
        requireOperatorPin: form.requireOperatorPin,
      };

      if (editingShop) {
        await apiFetch(`/shops/${editingShop.id}`, {
          method: 'PATCH',
          shopId: editingShop.id,
          body: payload,
        });
      } else {
        await apiFetch('/shops', { method: 'POST', body: payload });
      }
      setModalOpen(false);
      await Promise.all([load(), refreshMe()]);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['OWNER']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Mes boutiques</h1>
            <p className="text-sm text-slate-600">
              Chaque boutique créée dispose automatiquement de sa propre base PostgreSQL isolée et
              de son URL vitrine stable.
            </p>
          </div>
          {!supportGrantId ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              <Plus className="h-4 w-4" />
              Nouvelle boutique
            </button>
          ) : null}
        </div>

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : shops.length === 0 ? (
          <EmptyState
            title="Aucune boutique"
            description="Créez votre première boutique pour démarrer."
            action={
              <button
                type="button"
                onClick={openCreate}
                className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
              >
                Créer une boutique
              </button>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {shops.map((shop) => (
              <div
                key={shop.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {shop.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={shop.logoUrl}
                          alt={shop.name}
                          className="h-12 w-12 shrink-0 rounded-2xl border border-slate-200 bg-white object-contain p-1"
                        />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-forest-900 text-sm font-black text-limeglow-400">
                          {shop.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-extrabold text-slate-900">{shop.name}</h2>
                        <Link
                          href={`/s/${shop.slug}`}
                          target="_blank"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                        >
                          Vitrine : /s/{shop.slug}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={shop.status} />
                      <StatusBadge status={shop.dbStatus} />
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 shrink-0 text-brand-700" />
                      <span className="shrink-0">Base dédiée :</span>
                      <code className="truncate font-mono font-semibold text-slate-800">
                        {shop.dbName}
                      </code>
                    </div>
                    <p>
                      Devise : <strong>{shop.currency}</strong> · Fuseau :{' '}
                      <strong>{shop.timezone}</strong> · Bilan auto :{' '}
                      <strong>{shop.dailyReportTime}</strong>
                    </p>
                    <p>
                      Taxes : <strong>{shop.taxMode}</strong> (
                      {(shop.defaultTaxRateBps / 100).toFixed(2)} %) · PIN opérateur :{' '}
                      <strong>{shop.requireOperatorPin ? 'Obligatoire' : 'Facultatif'}</strong>
                    </p>
                    {shop.address ? <p>Adresse : {shop.address}</p> : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span>
                    {shop.activeAgentsCount} agent(s) · {shop.activeOperatorsCount} opérateur(s) ·{' '}
                    {shop.activeTerminalsCount} terminal(aux)
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setQrShop(shop)}
                      className="inline-flex items-center gap-1 rounded-xl bg-forest-900 px-3 py-1.5 font-bold text-limeglow-400 hover:bg-forest-800"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      QR & Affiche
                    </button>
                    {!supportGrantId ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(shop)}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Modifier
                        </button>
                        <Link
                          href="/owner/settings"
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-50"
                          title="Logo, Tickets & Livraison"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </Link>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {modalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="text-lg font-bold text-slate-900">
                {editingShop ? `Modifier ${editingShop.name}` : 'Créer une boutique'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {editingShop
                  ? 'Si vous modifiez l’identifiant URL (slug), l’ancienne adresse redirigera automatiquement pour préserver vos QR codes.'
                  : 'Une base PostgreSQL dédiée sera créée et migrée automatiquement pour cette boutique.'}
              </p>

              {formError ? (
                <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">{formError}</div>
              ) : null}

              <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                <ImageUploader
                  purpose="logo"
                  aspect="wide"
                  label="Logo de la boutique (optionnel)"
                  value={form.logoUrl}
                  onChange={(url) => setForm((f) => ({ ...f, logoUrl: url }))}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Nom commercial *
                    </label>
                    <input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Identifiant URL (slug)
                    </label>
                    <input
                      value={form.slug}
                      onChange={(e) => setForm({ ...form, slug: e.target.value })}
                      placeholder="auto-généré si vide"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Téléphone</label>
                    <input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Heure du bilan journalier
                    </label>
                    <input
                      type="time"
                      value={form.dailyReportTime}
                      onChange={(e) => setForm({ ...form, dailyReportTime: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Adresse</label>
                  <input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Quartier, rue, repère…"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Devise</label>
                    <input
                      value={form.currency}
                      onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Mode taxes</label>
                    <select
                      value={form.taxMode}
                      onChange={(e) => setForm({ ...form, taxMode: e.target.value as TaxMode })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      {TAX_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m === 'NONE' ? 'Aucune taxe' : `Prix ${m}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Taux (centièmes %)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      disabled={form.taxMode === 'NONE'}
                      value={form.defaultTaxRateBps}
                      onChange={(e) =>
                        setForm({ ...form, defaultTaxRateBps: Number(e.target.value) })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.requireOperatorPin}
                    onChange={(e) => setForm({ ...form, requireOperatorPin: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-brand-700"
                  />
                  <span>
                    <strong>Exiger le code PIN de l’opérateur déclaré</strong> lors des opérations
                    sensibles effectuées sur un compte Agent partagé.
                  </span>
                </label>

                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    {busy ? 'Enregistrement…' : editingShop ? 'Enregistrer' : 'Créer & provisionner BDD'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {qrShop ? (
          <ShopQrModal
            slug={qrShop.slug}
            shopName={qrShop.name}
            logoUrl={qrShop.logoUrl}
            onClose={() => setQrShop(null)}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
