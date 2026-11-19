'use client';

import React from 'react';
import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react';
import { TenantStatus, TENANT_STATUS_LABELS } from '@shopcontrol/shared';

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Chargement en cours">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 w-full animate-pulse rounded-xl bg-slate-200/70" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Inbox className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-600">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center"
    >
      <AlertTriangle className="mb-2 h-8 w-8 text-red-600" aria-hidden="true" />
      <p className="text-sm font-medium text-red-900">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Réessayer
        </button>
      ) : null}
    </div>
  );
}

export function AccessDeniedState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Lock className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-amber-950">Accès refusé</h2>
      <p className="mt-1 max-w-md text-sm text-amber-800">
        {message || 'Vous ne disposez pas des permissions nécessaires pour accéder à cette page.'}
      </p>
    </div>
  );
}

export function StatusBadge({ status }: { status: TenantStatus | string }) {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    READY: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    PAST_DUE: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    PROVISIONING: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    SUSPENDED: 'bg-red-50 text-red-700 ring-red-600/20',
    MIGRATION_FAILED: 'bg-red-50 text-red-700 ring-red-600/20',
    TERMINATED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  };

  const label =
    (TENANT_STATUS_LABELS as Record<string, string>)[status] ||
    (status === 'READY'
      ? 'BDD prête'
      : status === 'PROVISIONING'
        ? 'Provisionnement'
        : status === 'MIGRATION_FAILED'
          ? 'Erreur BDD'
          : status);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        styles[status] || 'bg-slate-100 text-slate-700 ring-slate-500/20'
      }`}
    >
      {label}
    </span>
  );
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="confirm-modal-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h3>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-700 hover:bg-brand-800'
            }`}
          >
            {busy ? 'Traitement…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
