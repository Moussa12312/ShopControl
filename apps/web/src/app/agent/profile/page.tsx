'use client';

import React from 'react';
import { Check, Shield, X } from 'lucide-react';
import { formatXof, PERMISSION_CATALOG } from '@shopcontrol/shared';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';

export default function AgentProfilePage() {
  const { user, shops, activeOperator } = useAuth();
  const shop = shops[0];

  return (
    <AppShell allowedRoles={['AGENT']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mon profil Agent</h1>
          <p className="text-sm text-slate-600">
            Rattachement boutique et récapitulatif en lecture seule des permissions accordées par le
            propriétaire.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium uppercase text-slate-500">Compte Agent</p>
            <p className="mt-1 font-bold text-slate-900">{user?.fullName}</p>
            <p className="text-xs text-slate-500">{user?.email}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium uppercase text-slate-500">Boutique assignée</p>
            <p className="mt-1 font-bold text-slate-900">{shop?.shopName || '—'}</p>
            <p className="text-xs text-slate-500">
              Opérateur actif : {activeOperator?.firstName || 'Non sélectionné'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium uppercase text-slate-500">Plafonds configurés</p>
            <p className="mt-1 font-bold text-slate-900">
              Remise max : {shop?.maxDiscountPercent ?? 0} %
            </p>
            <p className="text-xs text-slate-500">
              Dépense max : {formatXof(shop?.maxExpenseAmountXof ?? 0)}
            </p>
          </div>
        </div>

        {shop ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-brand-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Permissions accordées (contrôlées côté serveur)
              </h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PERMISSION_CATALOG.map((perm) => {
                const allowed = Boolean(shop.permissions[perm.key]);
                return (
                  <div
                    key={perm.key}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                      allowed
                        ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    {allowed ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <X className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <span>
                      <strong>{perm.domain}</strong> — {perm.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
