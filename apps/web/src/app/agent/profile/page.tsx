'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Laptop,
  LogOut,
  Store,
  User,
} from 'lucide-react';
import { formatDateTimeInTimezone } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingSkeleton } from '@/components/ui/StateViews';

interface SessionRow {
  id: string;
  deviceName: string;
  ipAddress: string | null;
  lastActiveAt: string;
  isCurrent: boolean;
}

export default function AgentProfilePage() {
  const { user, shops, activeOperator } = useAuth();
  const shop = shops[0];

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const list = await apiFetch<SessionRow[]>('/auth/sessions');
      setSessions(Array.isArray(list) ? list : []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (newPassword !== confirmPassword) {
      setErr('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMsg('Votre mot de passe a été modifié avec succès.');
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : 'Impossible de modifier le mot de passe.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/auth/sessions/${sessionId}`, { method: 'DELETE' });
      setMsg('Session déconnectée.');
      await loadSessions();
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : 'Action refusée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['AGENT']}
      title="Mon profil & Paramètres"
      subtitle="Informations de votre compte, sécurité du mot de passe et appareils connectés."
    >
      <div className="mx-auto max-w-3xl space-y-5">

        {/* Identité & Boutique (aucune permission affichée) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sc-card flex min-w-0 items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <User className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500">Mon compte</p>
              <p className="truncate text-sm font-bold text-slate-900">{user?.fullName}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>

          <div className="sc-card flex min-w-0 items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Store className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500">Boutique assignée</p>
              <p className="truncate text-sm font-bold text-slate-900">{shop?.shopName || '—'}</p>
              <p className="truncate text-xs text-slate-500">
                Opérateur : {activeOperator?.firstName || 'Non sélectionné'}
              </p>
            </div>
          </div>
        </div>

        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        {err ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold text-rose-800"
          >
            {err}
          </div>
        ) : null}

        {/* Modification du mot de passe */}
        <section className="sc-card p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand-700" />
            <h2 className="text-sm font-bold text-slate-900">Changer mon mot de passe</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Au moins 8 caractères dont une majuscule, une minuscule et un chiffre.
          </p>

          <form onSubmit={handlePasswordChange} className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Mot de passe actuel
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="sc-input"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Nouveau mot de passe
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="sc-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Confirmer le nouveau mot de passe
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="sc-input"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button type="submit" disabled={busy} className="sc-btn-primary w-full text-xs sm:w-auto">
                {busy ? 'Mise à jour…' : 'Enregistrer le mot de passe'}
              </button>
            </div>
          </form>
        </section>

        {/* Sessions actives */}
        <section className="sc-card p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Laptop className="h-4 w-4 text-brand-700" />
            <h2 className="text-sm font-bold text-slate-900">Appareils connectés</h2>
          </div>
          {loadingSessions ? (
            <div className="mt-3">
              <LoadingSkeleton rows={2} />
            </div>
          ) : sessions.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">Aucune autre session active.</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {s.deviceName}{' '}
                      {s.isCurrent ? (
                        <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          Actuel
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {s.ipAddress || 'IP locale'} · Actif le {formatDateTimeInTimezone(s.lastActiveAt)}
                    </p>
                  </div>
                  {!s.isCurrent ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRevokeSession(s.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Déconnecter
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
