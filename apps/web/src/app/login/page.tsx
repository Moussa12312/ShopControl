'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Lock, ShieldCheck, Store } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';

export default function LoginPage() {
  const router = useRouter();
  const { refreshMe } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectAfterLogin = async (role: string, mustSetupTwoFactor: boolean) => {
    await refreshMe();
    if (mustSetupTwoFactor) {
      router.replace('/setup-2fa');
      return;
    }
    if (role === 'SUPER_ADMIN') router.replace('/admin');
    else if (role === 'OWNER') router.replace('/owner');
    else router.replace('/agent');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<
        | { requiresTwoFactor: true; challengeToken: string }
        | {
            requiresTwoFactor: false;
            user: { role: string; mustSetupTwoFactor: boolean };
          }
      >('/auth/login', {
        method: 'POST',
        body: {
          email,
          password,
          deviceName: typeof navigator !== 'undefined' ? navigator.platform : 'Navigateur',
        },
        skipRefresh: true,
      });

      if (res.requiresTwoFactor) {
        setChallengeToken(res.challengeToken);
      } else {
        await redirectAfterLogin(res.user.role, res.user.mustSetupTwoFactor);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la connexion.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{
        user: { role: string; mustSetupTwoFactor: boolean };
      }>('/auth/2fa/verify-login', {
        method: 'POST',
        body: { challengeToken, code: totpCode },
        skipRefresh: true,
      });
      await redirectAfterLogin(res.user.role, res.user.mustSetupTwoFactor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Code 2FA invalide.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-brand-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white">
            <Store className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">ShopControl</h1>
            <p className="text-xs text-slate-500">Gestion commerciale multi-boutiques</p>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </div>
        ) : null}

        {!challengeToken ? (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                Adresse e-mail
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ex. proprietaire@boutique.ml"
                className="mt-1 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm shadow-xs focus:border-brand-600"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm shadow-xs focus:border-brand-600"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-brand-800 disabled:opacity-60"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Connexion en cours…' : 'Se connecter'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyTotp} className="space-y-4">
            <div className="rounded-xl bg-brand-50 p-3.5 text-sm text-brand-900">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4" />
                Vérification à deux facteurs (2FA)
              </div>
              <p className="mt-1 text-xs text-brand-800">
                Saisissez le code à 6 chiffres généré par votre application d’authentification.
              </p>
            </div>

            <div>
              <label htmlFor="totp" className="block text-sm font-medium text-slate-700">
                Code à 6 chiffres
              </label>
              <input
                id="totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="mt-1 block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-center text-lg tracking-widest shadow-xs"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setChallengeToken(null);
                  setTotpCode('');
                }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Retour
              </button>
              <button
                type="submit"
                disabled={busy || totpCode.length !== 6}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
              >
                <KeyRound className="h-4 w-4" />
                {busy ? 'Vérification…' : 'Valider le code'}
              </button>
            </div>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          Isolation par base dédiée · Journal d’audit immuable · XOF
        </p>
      </div>
    </div>
  );
}
