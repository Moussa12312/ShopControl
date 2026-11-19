'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, KeyRound, Lock, ShieldCheck, Sparkles, Store } from 'lucide-react';
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
    <div className="grid min-h-screen w-full bg-white lg:grid-cols-12">
      {/* Panneau gauche Dark Forest Emerald plein écran */}
      <div className="flex flex-col justify-between bg-forest-900 px-6 py-8 text-white sm:px-10 lg:col-span-5 lg:min-h-screen lg:px-12 lg:py-12">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 font-black text-white ring-1 ring-white/15">
              SC
            </span>
            <div>
              <p className="text-lg font-bold tracking-tight">ShopControl</p>
              <p className="text-xs text-emerald-200/70">SaaS Commercial Multi-Boutiques</p>
            </div>
          </div>

          <h1 className="mt-6 text-2xl font-bold leading-snug text-white sm:text-3xl lg:mt-14">
            Pilotez toutes vos boutiques en temps réel.
          </h1>
          <p className="mt-3 max-w-md text-xs leading-relaxed text-[#9bb5b0] sm:text-sm">
            Ventes au comptoir résilientes, caisse, stocks, achats CMP, créances et supervision
            consolidée depuis un seul espace sécurisé.
          </p>
        </div>

        <div className="lime-glow-card mt-6 hidden space-y-2.5 rounded-2xl border border-limeglow-400/20 p-5 text-xs lg:block">
          <div className="flex items-center gap-2 font-semibold text-limeglow-400">
            <Sparkles className="h-4 w-4" />
            <span>Architecture isolée & fiable</span>
          </div>
          <p className="flex items-center gap-2 text-emerald-100/85">
            <Database className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
            1 base PostgreSQL dédiée par boutique
          </p>
          <p className="flex items-center gap-2 text-emerald-100/85">
            <Store className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
            Comptoir PWA hors-ligne · Entiers XOF
          </p>
        </div>
      </div>

      {/* Panneau droit Formulaire plein écran responsive */}
      <div className="flex flex-1 flex-col justify-center bg-[#f4f8f7] px-5 py-8 sm:px-10 lg:col-span-7 lg:bg-white">
        <div className="mx-auto w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-8 lg:border-0 lg:p-0 lg:shadow-none">
          <h2 className="text-2xl font-bold text-slate-900">Connexion à votre espace</h2>
          <p className="mt-1 text-sm text-slate-500">
            Super Admin, Propriétaire ou compte Agent boutique.
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800"
            >
              {error}
            </div>
          ) : null}

          {!challengeToken ? (
            <form onSubmit={handleLoginSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-700">
                  Adresse e-mail
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ex. admin@shopcontrol.local"
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-xs focus:border-forest-900"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
                  Mot de passe
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-xs focus:border-forest-900"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-forest-900 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-forest-800 disabled:opacity-60"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                {busy ? 'Connexion en cours…' : 'Se connecter'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyTotp} className="mt-6 space-y-4">
              <div className="rounded-2xl bg-brand-50 p-4 text-xs text-forest-900">
                <div className="flex items-center gap-2 font-bold">
                  <ShieldCheck className="h-4 w-4 text-brand-700" />
                  Vérification à deux facteurs (2FA)
                </div>
                <p className="mt-1 text-slate-600">
                  Saisissez le code à 6 chiffres généré par votre application d’authentification.
                </p>
              </div>

              <div>
                <label htmlFor="totp" className="block text-xs font-semibold text-slate-700">
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
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-lg tracking-widest"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setChallengeToken(null);
                    setTotpCode('');
                  }}
                  className="rounded-full border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Retour
                </button>
                <button
                  type="submit"
                  disabled={busy || totpCode.length !== 6}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-forest-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-forest-800 disabled:opacity-60"
                >
                  <KeyRound className="h-4 w-4" />
                  {busy ? 'Vérification…' : 'Valider le code'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
