'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, Upload } from 'lucide-react';
import { formatDateTimeInTimezone, ImportEntityType } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/layout/AppShell';
import {
  ShopPickerInline,
  useActiveOperationalShop,
} from '@/components/commerce/ActiveShopHeader';
import { ErrorState } from '@/components/ui/StateViews';

const TEMPLATES: Record<ImportEntityType, string> = {
  PRODUCTS:
    'nom;sku;categorie;prix_vente;cout_achat;stock_initial;seuil_alerte;statut\nRiz Parfumé 25kg;RIZ-25KG;Alimentation;12500;10500;20;5;PUBLISHED\nHuile Végétale 1L;HUILE-1L;Alimentation;1400;1100;35;8;PUBLISHED',
  SUPPLIERS: 'nom;telephone;email;adresse\nGrossiste Mali;+22370001111;contact@grossiste.ml;Marché Rose, Bamako',
  CLIENTS: 'nom;telephone;adresse;plafond_credit\nAminata Sangaré;+22376002233;ACI 2000;50000',
};

interface PreviewResponse {
  totalRows: number;
  validCount: number;
  errorCount: number;
  errors: Array<{ lineNumber: number; message: string }>;
  preview: Array<{ lineNumber: number; raw: Record<string, string>; error?: string }>;
}

interface BatchRow {
  id: string;
  entityType: string;
  fileName: string | null;
  totalRows: number;
  importedCount: number;
  errorCount: number;
  status: string;
  createdAt: string;
}

export default function CsvImportPage() {
  const { shopId, selectShop } = useActiveOperationalShop();

  const [entityType, setEntityType] = useState<ImportEntityType>('PRODUCTS');
  const [csvContent, setCsvContent] = useState(TEMPLATES.PRODUCTS);
  const [fileName, setFileName] = useState('produits.csv');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBatches = useCallback(async () => {
    if (!shopId) return;
    try {
      const list = await apiFetch<BatchRow[]>(`/shops/${shopId}/imports`, { shopId });
      setBatches(list);
    } catch {
      // ignore
    }
  }, [shopId]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setCsvContent(text);
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!shopId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await apiFetch<PreviewResponse>(`/shops/${shopId}/imports/preview`, {
        method: 'POST',
        shopId,
        body: { entityType, csvContent, fileName },
      });
      setPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur d’analyse CSV.');
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!shopId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ batch: BatchRow }>(`/shops/${shopId}/imports/commit`, {
        method: 'POST',
        shopId,
        body: { entityType, csvContent, fileName },
      });
      setMsg(`${res.batch.importedCount} ligne(s) importée(s) avec succès dans la base de la boutique.`);
      setPreview(null);
      await loadBatches();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import échoué.');
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async (batchId: string) => {
    if (!shopId) return;
    setBusy(true);
    try {
      await apiFetch(`/shops/${shopId}/imports/${batchId}/rollback`, {
        method: 'POST',
        shopId,
      });
      setMsg('Lot d’import annulé proprement (mouvements inverses & archivage).');
      await loadBatches();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Annulation impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      allowedRoles={['OWNER']}
      title="Import de données CSV"
      subtitle="Reprise rapide de vos produits, stocks initiaux, fournisseurs et clients avec aperçu et annulation possible."
      headerActions={<ShopPickerInline shopId={shopId} onChange={selectShop} />}
    >
      <div className="space-y-5">

        {error ? <ErrorState message={error} /> : null}
        {msg ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>{msg}</span>
          </div>
        ) : null}

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {(['PRODUCTS', 'SUPPLIERS', 'CLIENTS'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setEntityType(t);
                    setCsvContent(TEMPLATES[t]);
                    setPreview(null);
                  }}
                  className={`rounded-xl px-3.5 py-2 text-xs font-semibold ${
                    entityType === t ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {t === 'PRODUCTS' ? 'Produits & Stocks' : t === 'SUPPLIERS' ? 'Fournisseurs' : 'Clients'}
                </button>
              ))}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Upload className="h-4 w-4" />
              Charger un fichier .csv
              <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <textarea
            rows={7}
            value={csvContent}
            onChange={(e) => {
              setCsvContent(e.target.value);
              setPreview(null);
            }}
            className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs"
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={busy || !shopId}
              onClick={handlePreview}
              className="w-full rounded-xl border border-brand-700 bg-white px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50 sm:w-auto"
            >
              1. Prévisualiser et valider
            </button>
            {preview && preview.validCount > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleCommit}
                className="w-full rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 sm:w-auto"
              >
                2. Importer les {preview.validCount} ligne(s) valide(s)
              </button>
            ) : null}
          </div>

          {preview ? (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap gap-3 text-xs font-semibold">
                <span className="rounded-lg bg-slate-100 px-2.5 py-1">
                  Total : {preview.totalRows} lignes
                </span>
                <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700">
                  Valides : {preview.validCount}
                </span>
                <span className="rounded-lg bg-red-50 px-2.5 py-1 text-red-700">
                  Erreurs : {preview.errorCount}
                </span>
              </div>

              {preview.errors.length > 0 ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  <p className="mb-1 flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="h-4 w-4" /> Rapport d’erreurs ligne par ligne :
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {preview.errors.map((e, idx) => (
                      <li key={idx}>
                        <strong>Ligne {e.lineNumber}</strong> : {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Historique des lots d'import */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-base font-bold text-slate-900">Historique des imports CSV</h2>
          {batches.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun import effectué sur cette boutique.</p>
          ) : (
            <div className="divide-y divide-slate-100 text-sm">
              {batches.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {b.entityType} · {b.fileName || 'import.csv'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {b.importedCount}/{b.totalRows} importé(s) · {formatDateTimeInTimezone(b.createdAt)}
                    </p>
                  </div>
                  {b.status === 'COMMITTED' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRollback(b.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Annuler l’import
                    </button>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                      Annulé (rollback)
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
