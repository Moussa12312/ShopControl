'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  QrCode,
  Receipt,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';

export default function LoginPage() {
  const router = useRouter();
  const { refreshMe } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="min-h-screen w-full overflow-x-hidden bg-[#f4f8f7] lg:grid lg:grid-cols-12 lg:bg-white">
      {/* Panneau gauche Obsidian Emerald (compact sur mobile, plein écran sur desktop) */}
      <div className="obsidian-hero flex flex-col justify-between px-4 py-5 text-white sm:px-8 sm:py-7 lg:col-span-5 lg:min-h-screen lg:px-12 lg:py-12">
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-forest-700 text-sm font-black text-white shadow-sm ring-1 ring-white/20 sm:h-11 sm:w-11">
                SC
              </span>
              <div>
                <p className="text-base font-extrabold tracking-tight sm:text-lg">ShopControl</p>
                <p className="text-[11px] text-emerald-200/75 sm:text-xs">
                  Gestion de Boutique & Vitrine QR
                </p>
              </div>
            </div>
            <Link
              href="/register"
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-limeglow-400 transition hover:bg-white/20 lg:hidden"
            >
              <span>S’inscrire</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <h1 className="mt-4 text-lg font-extrabold leading-snug text-white sm:mt-6 sm:text-2xl lg:mt-14 lg:text-3xl">
            Gérez vos ventes, votre stock et votre vitrine en ligne en toute simplicité.
          </h1>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[#9bb5b0] sm:mt-3 sm:text-sm">
            Adapté à tous les commerces : alimentation, cosmétique, mode & vêtements,
            quincaillerie, électronique et pièces auto.
          </p>
        </div>

        <div className="lime-glow-card mt-6 hidden space-y-3 rounded-2xl border border-limeglow-400/25 p-5 text-xs lg:block">
          <p className="flex items-center gap-2.5 text-emerald-100/95">
            <Store className="h-4 w-4 shrink-0 text-limeglow-400" />
            <span>Catalogue & catégories adaptés à votre type de commerce</span>
          </p>
          <p className="flex items-center gap-2.5 text-emerald-100/95">
            <Receipt className="h-4 w-4 shrink-0 text-limeglow-400" />
            <span>Caisse POS rapide, tickets thermiques 58/80 mm & factures PDF</span>
          </p>
          <p className="flex items-center gap-2.5 text-emerald-100/95">
            <QrCode className="h-4 w-4 shrink-0 text-limeglow-400" />
            <span>Vitrine QR publique avec votre logo pour recevoir les commandes clients</span>
          </p>
        </div>
      </div>

      {/* Panneau droit Formulaire de connexion épuré */}
      <div className="flex flex-1 flex-col justify-start px-3 py-4 sm:px-8 sm:py-8 lg:col-span-7 lg:justify-center lg:bg-white">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:rounded-3xl sm:p-8 lg:border-0 lg:p-0 lg:shadow-none">
          <h2 className="text-2xl font-extrabold text-slate-900">Connexion</h2>
          <p className="mt-1 text-sm text-slate-500">
            Accédez au tableau de bord de votre boutique.
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800"
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
                  placeholder="ex. contact@maboutique.com"
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm shadow-xs focus:border-forest-900 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
                  Mot de passe
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="block w-full rounded-xl border border-slate-300 py-3 pl-4 pr-11 text-sm shadow-xs focus:border-forest-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
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

          {/* Appel à l'action vers la page d'inscription boutiquier */}
          <div className="mt-6 rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-4 text-center">
            <p className="text-xs font-bold text-slate-800">
              Vous êtes boutiquier et n’avez pas encore de compte ?
            </p>
            <p className="mt-0.5 text-[11px] text-slate-600">
              Créez votre boutique en 1 minute avec votre logo, votre type de commerce et vos modes de paiement.
            </p>
            <Link
              href="/register"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-forest-900 bg-white px-4 py-2.5 text-xs font-extrabold text-forest-900 shadow-2xs transition hover:bg-forest-900 hover:text-white"
            >
              <CheckCircle2 className="h-4 w-4 text-brand-700" />
              <span>Créer ma boutique (Inscription)</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <p className="mt-7 text-center text-[11px] text-slate-400">
            Propulsé par{' '}
            <sub className="bottom-[-0.18em] text-[10px] font-semibold tracking-wide text-slate-500">
              Chakir’s Entreprise
            </sub>
          </p>
        </div>
      </div>
    </div>
  );
}
