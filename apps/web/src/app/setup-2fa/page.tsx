'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingSkeleton } from '@/components/ui/StateViews';

export default function SetupTwoFactorPage() {
  const router = useRouter();
  const { user, refreshMe } = useAuth();

  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauthUri: string;
    qrCodeDataUrl: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<{ secret: string; otpauthUri: string; qrCodeDataUrl: string }>('/auth/2fa/setup', {
      method: 'POST',
    })
      .then((res) => {
        if (active) setSetupData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Erreur d’initialisation 2FA.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/2fa/confirm', { method: 'POST', body: { code } });
      await refreshMe();
      setDone(true);
      setTimeout(() => {
        router.replace(user?.role === 'SUPER_ADMIN' ? '/admin' : '/owner/settings');
      }, 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Code invalide.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell allowedRoles={['SUPER_ADMIN', 'OWNER']}>
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Configuration de la double authentification (2FA)
            </h1>
            <p className="text-xs text-slate-500">
              Scannez le QR code avec Google Authenticator, Authy ou FreeOTP.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="mt-6">
            <LoadingSkeleton rows={3} />
          </div>
        ) : done ? (
          <div className="mt-6 flex flex-col items-center py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <p className="mt-3 font-semibold text-slate-900">2FA activé avec succès !</p>
            <p className="text-xs text-slate-500">Redirection en cours…</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {error ? (
              <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {setupData ? (
              <>
                <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={setupData.qrCodeDataUrl}
                    alt="QR code 2FA ShopControl"
                    className="h-44 w-44 rounded-lg bg-white p-2 shadow-xs"
                  />
                  <p className="mt-3 text-xs text-slate-500">Clé manuelle :</p>
                  <code className="mt-1 select-all rounded-md bg-white px-2.5 py-1 text-xs font-mono font-semibold text-slate-800">
                    {setupData.secret}
                  </code>
                </div>

                <form onSubmit={handleConfirm} className="space-y-4">
                  <div>
                    <label htmlFor="confirm-code" className="block text-sm font-medium text-slate-700">
                      Entrez le code à 6 chiffres affiché dans l’application
                    </label>
                    <input
                      id="confirm-code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-center text-lg tracking-widest"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy || code.length !== 6}
                    className="w-full rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    {busy ? 'Activation…' : 'Activer la double authentification'}
                  </button>
                </form>
              </>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
