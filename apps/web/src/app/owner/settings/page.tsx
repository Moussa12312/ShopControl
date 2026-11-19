'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Laptop, ShieldCheck } from 'lucide-react';
import { formatDateTimeInTimezone } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState, LoadingSkeleton, StatusBadge } from '@/components/ui/StateViews';

interface MerchantProfile {
  id: string;
  name: string;
  legalName: string | null;
  phone: string;
  email: string;
  status: string;
  currency: string;
  defaultTimezone: string;
  supportAccessHistory: Array<{
    id: string;
    superAdminName: string;
    reason: string;
    readOnly: boolean;
    expiresAt: string;
    active: boolean;
    createdAt: string;
  }>;
}

interface SessionRow {
  id: string;
  deviceName: string;
  ipAddress: string | null;
  lastActiveAt: string;
  isCurrent: boolean;
}

export default function OwnerSettingsPage() {
  const { user, refreshMe, supportGrantId } = useAuth();
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ name: '', legalName: '', phone: '', email: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        apiFetch<MerchantProfile>('/merchant', { supportGrantId }),
        apiFetch<SessionRow[]>('/auth/sessions'),
      ]);
      setProfile(p);
      setSessions(s);
      setForm({
        name: p.name,
        legalName: p.legalName || '',
        phone: p.phone,
        email: p.email,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des paramètres.');
    } finally {
      setLoading(false);
    }
  }, [supportGrantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSavedMsg(null);
    try {
      await apiFetch('/merchant', {
        method: 'PATCH',
        body: {
          name: form.name,
          legalName: form.legalName.trim() || null,
          phone: form.phone,
          email: form.email,
        },
      });
      await Promise.all([load(), refreshMe()]);
      setSavedMsg('Paramètres enregistrés avec succès.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mise à jour impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    await apiFetch(`/auth/sessions/${sessionId}`, { method: 'DELETE' });
    await load();
  };

  return (
    <AppShell allowedRoles={['OWNER']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Paramètres entreprise & sécurité</h1>
          <p className="text-sm text-slate-600">
            Informations commerciales, double authentification, sessions actives et transparence des
            accès support.
          </p>
        </div>

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : profile ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <form
              onSubmit={handleSave}
              className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Fiche entreprise</h2>
                <StatusBadge status={profile.status} />
              </div>

              {savedMsg ? (
                <p className="rounded-xl bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
                  {savedMsg}
                </p>
              ) : null}

              <div>
                <label className="block text-xs font-medium text-slate-700">Nom commercial</label>
                <input
                  required
                  disabled={Boolean(supportGrantId)}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Raison sociale</label>
                <input
                  disabled={Boolean(supportGrantId)}
                  value={form.legalName}
                  onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Téléphone</label>
                  <input
                    required
                    disabled={Boolean(supportGrantId)}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">E-mail</label>
                  <input
                    type="email"
                    required
                    disabled={Boolean(supportGrantId)}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                </div>
              </div>

              {!supportGrantId ? (
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  {busy ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </button>
              ) : null}
            </form>

            <div className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-brand-700" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Double authentification (2FA)
                    </h2>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      user?.totpEnabled
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {user?.totpEnabled ? 'Activé' : 'Inactif'}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Protégez l’accès à votre compte Propriétaire avec un code TOTP à 6 chiffres.
                </p>
                {!user?.totpEnabled && !supportGrantId ? (
                  <Link
                    href="/setup-2fa"
                    className="mt-4 inline-flex rounded-xl border border-brand-700 px-3.5 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-50"
                  >
                    Activer le 2FA maintenant
                  </Link>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="mb-3 flex items-center gap-2">
                  <Laptop className="h-5 w-5 text-slate-500" />
                  <h2 className="text-base font-semibold text-slate-900">Mes sessions actives</h2>
                </div>
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-900">
                          {s.deviceName}{' '}
                          {s.isCurrent ? (
                            <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                              Session actuelle
                            </span>
                          ) : null}
                        </p>
                        <p className="text-slate-500">
                          IP : {s.ipAddress || '—'} · Actif : {formatDateTimeInTimezone(s.lastActiveAt)}
                        </p>
                      </div>
                      {!s.isCurrent ? (
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(s.id)}
                          className="rounded-lg bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100"
                        >
                          Déconnecter
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-base font-semibold text-slate-900">
                  Historique des accès d’assistance plateforme
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Chaque intervention exceptionnelle d’un Super Admin est journalisée ici.
                </p>
                {profile.supportAccessHistory.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-400">Aucun accès d’assistance enregistré.</p>
                ) : (
                  <div className="mt-3 space-y-2 text-xs">
                    {profile.supportAccessHistory.map((g) => (
                      <div key={g.id} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-semibold text-slate-800">
                          {g.superAdminName} · {g.readOnly ? 'Lecture seule' : 'Étendu'}
                        </p>
                        <p className="text-slate-600">{g.reason}</p>
                        <p className="text-[11px] text-slate-400">
                          Ouvert : {formatDateTimeInTimezone(g.createdAt)} · Expire :{' '}
                          {formatDateTimeInTimezone(g.expiresAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
