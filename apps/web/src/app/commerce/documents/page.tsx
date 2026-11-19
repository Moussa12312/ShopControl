'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Printer, Search } from 'lucide-react';
import {
  DOCUMENT_TYPE_LABELS,
  DocumentType,
  formatDateTimeInTimezone,
  formatXof,
} from '@shopcontrol/shared';
import { apiFetch, API_BASE_URL, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { ReceiptModal, SaleDocumentView } from '@/components/commerce/ReceiptModal';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

export default function DocumentsPage() {
  const { shopId, selectShop } = useActiveOperationalShop();
  const [docs, setDocs] = useState<SaleDocumentView[]>([]);
  const [typeFilter, setTypeFilter] = useState<'' | DocumentType>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<SaleDocumentView | null>(null);

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '80' });
      if (typeFilter) qs.set('type', typeFilter);
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiFetch<SaleDocumentView[]>(
        `/shops/${shopId}/documents?${qs.toString()}`,
        { shopId },
      );
      setDocs(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des justificatifs.');
    } finally {
      setLoading(false);
    }
  }, [shopId, typeFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDocUpdated = (updated: SaleDocumentView) => {
    setActiveDoc(updated);
    setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  };

  return (
    <AppShell allowedRoles={['OWNER', 'AGENT']}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Tickets de caisse & Avoirs
            </h1>
            <p className="text-sm text-slate-600">
              Numérotation séquentielle immuable · Réimpression marquée DUPLICATA · Format thermique
              58/80 mm et PDF.
            </p>
          </div>
          <ShopPickerInline shopId={shopId} onChange={selectShop} />
        </div>

        {/* Filtres */}
        <div className="sc-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-xl bg-porcelain-100 p-1 text-xs font-bold">
            {(
              [
                { value: '', label: 'Tous' },
                { value: 'SALE_RECEIPT', label: 'Tickets de vente' },
                { value: 'CREDIT_NOTE', label: 'Avoirs / Remboursements' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTypeFilter(opt.value)}
                className={`rounded-lg px-3 py-1.5 transition ${
                  typeFilter === opt.value
                    ? 'bg-forest-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher VTE-000001, AV-…"
              className="sc-input py-2 pl-9 text-xs"
            />
          </div>
        </div>

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : docs.length === 0 ? (
          <EmptyState
            title="Aucun justificatif trouvé"
            description="Les tickets de caisse et avoirs de remboursement sont générés automatiquement à chaque vente."
          />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {docs.map((doc) => {
                const isCredit = doc.documentType === 'CREDIT_NOTE';
                const amount = isCredit
                  ? -(doc.snapshot?.amountXof || 0)
                  : doc.snapshot?.totalXof || 0;
                return (
                  <div key={`m-${doc.id}`} className="sc-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-extrabold text-slate-900">
                          {doc.documentNumber}
                        </p>
                        <p className="text-xs text-slate-500">
                          {DOCUMENT_TYPE_LABELS[doc.documentType]}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {formatDateTimeInTimezone(doc.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-sm font-extrabold tabular ${
                            isCredit ? 'text-rose-600' : 'text-slate-900'
                          }`}
                        >
                          {formatXof(amount)}
                        </p>
                        {doc.status === 'CANCELLED' ? (
                          <span className="inline-block rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                            ANNULÉ
                          </span>
                        ) : doc.printCount >= 1 ? (
                          <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            Imprimé ({doc.printCount}×)
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveDoc(doc)}
                        className="sc-btn-primary py-2 text-xs"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Aperçu / Imprimer
                      </button>
                      <a
                        href={`${API_BASE_URL}/shops/${shopId}/documents/${doc.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sc-btn-ghost py-2 text-xs"
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="sc-card hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-porcelain-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3.5">Numéro</th>
                    <th className="px-4 py-3.5">Type</th>
                    <th className="px-4 py-3.5">Client / Opérateur</th>
                    <th className="px-4 py-3.5">Montant</th>
                    <th className="px-4 py-3.5">Statut & Impressions</th>
                    <th className="px-4 py-3.5">Date</th>
                    <th className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {docs.map((doc) => {
                    const isCredit = doc.documentType === 'CREDIT_NOTE';
                    const amount = isCredit
                      ? -(doc.snapshot?.amountXof || 0)
                      : doc.snapshot?.totalXof || 0;
                    return (
                      <tr key={doc.id} className="hover:bg-porcelain-50/70">
                        <td className="px-4 py-3 font-mono text-xs font-extrabold text-slate-900">
                          {doc.documentNumber}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              isCredit
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-brand-50 text-brand-800'
                            }`}
                          >
                            <FileText className="h-3 w-3" />
                            {isCredit ? 'Avoir' : 'Ticket vente'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <p className="font-semibold text-slate-800">
                            {doc.snapshot?.client?.fullName || 'Client comptoir'}
                          </p>
                          <p className="text-slate-400">
                            {doc.snapshot?.operatorName || 'Comptoir'}
                          </p>
                        </td>
                        <td
                          className={`px-4 py-3 font-extrabold tabular ${
                            isCredit ? 'text-rose-600' : 'text-slate-900'
                          }`}
                        >
                          {formatXof(amount)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {doc.status === 'CANCELLED' ? (
                            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 font-bold text-rose-800">
                              ANNULÉ
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-bold text-emerald-700">
                              Valide
                            </span>
                          )}
                          {doc.printCount > 0 ? (
                            <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                              {doc.printCount} imp.
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDateTimeInTimezone(doc.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setActiveDoc(doc)}
                              className="sc-btn-primary px-3 py-1.5 text-xs"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              {doc.printCount >= 1 ? 'Duplicata' : 'Imprimer'}
                            </button>
                            <a
                              href={`${API_BASE_URL}/shops/${shopId}/documents/${doc.id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="sc-btn-ghost px-2.5 py-1.5 text-xs"
                            >
                              <Download className="h-3.5 w-3.5" />
                              PDF
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {activeDoc && shopId ? (
        <ReceiptModal
          shopId={shopId}
          document={activeDoc}
          onClose={() => setActiveDoc(null)}
          onUpdated={handleDocUpdated}
        />
      ) : null}
    </AppShell>
  );
}
