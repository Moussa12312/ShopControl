'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  X,
} from 'lucide-react';
import { formatXof } from '@shopcontrol/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateViews';

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  suppliedProducts: string | null;
}

interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  unit: string;
  costPriceXof?: number | null;
  salePriceXof: number;
  stockPhysical?: number;
  stockAvailable?: number;
  alertThreshold?: number;
  variants?: Array<{
    id: string;
    name: string;
    sku?: string | null;
    barcode?: string | null;
    costPriceXof?: number | null;
    salePriceXof: number;
    stockPhysical?: number;
    stockAvailable?: number;
    alertThreshold?: number;
  }>;
}

export default function OwnerRestockPage() {
  const { user, shops, selectedShopId, setSelectedShopId, activeOperator } = useAuth();
  const shopId = selectedShopId || shops[0]?.shopId || '';

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');

  // Modale création PO en 1 clic
  const [showPoModal, setShowPoModal] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poProductId, setPoProductId] = useState('');
  const [poQty, setPoQty] = useState(10);
  const [poUnitCost, setPoUnitCost] = useState(1000);

  const load = useCallback(async () => {
    if (!shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [supRes, prodRes] = await Promise.all([
        apiFetch<SupplierRow[]>(`/shops/${shopId}/suppliers`, { shopId }),
        apiFetch<{ items: ProductOpt[] }>(`/shops/${shopId}/products?limit=250`, { shopId }),
      ]);
      setSuppliers(supRes);
      setProducts(prodRes.items || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des données.');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Suggestions de réapprovisionnement intelligentes basées sur les alertes et les ventes
  const restockSuggestions = useMemo(() => {
    const list: Array<{
      productId: string;
      variantId?: string;
      productName: string;
      variantName?: string;
      sku: string;
      unit: string;
      currentStock: number;
      alertThreshold: number;
      suggestedQty: number;
      unitCostXof: number;
      supplierId?: string;
      supplierName?: string;
    }> = [];

    for (const p of products) {
      if (p.variants && p.variants.length > 0) {
        for (const v of p.variants) {
          const stock = v.stockAvailable ?? v.stockPhysical ?? 0;
          const threshold = v.alertThreshold ?? 5;
          if (stock <= threshold) {
            const matchedSup = suppliers.find(
              (s) =>
                s.suppliedProducts?.toLowerCase().includes(p.name.toLowerCase()) ||
                s.suppliedProducts?.toLowerCase().includes(v.name.toLowerCase()),
            );
            const suggested = Math.max(10, threshold * 2 - stock);
            list.push({
              productId: p.id,
              variantId: v.id,
              productName: p.name,
              variantName: v.name,
              sku: v.sku || p.sku,
              unit: p.unit || 'unité',
              currentStock: stock,
              alertThreshold: threshold,
              suggestedQty: suggested,
              unitCostXof: v.costPriceXof ?? p.costPriceXof ?? 0,
              supplierId: matchedSup?.id,
              supplierName: matchedSup?.name,
            });
          }
        }
      } else {
        const stock = p.stockAvailable ?? p.stockPhysical ?? 0;
        const threshold = p.alertThreshold ?? 5;
        if (stock <= threshold) {
          const matchedSup = suppliers.find((s) =>
            s.suppliedProducts?.toLowerCase().includes(p.name.toLowerCase()),
          );
          const suggested = Math.max(10, threshold * 2 - stock);
          list.push({
            productId: p.id,
            productName: p.name,
            sku: p.sku,
            unit: p.unit || 'unité',
            currentStock: stock,
            alertThreshold: threshold,
            suggestedQty: suggested,
            unitCostXof: p.costPriceXof ?? 0,
            supplierId: matchedSup?.id,
            supplierName: matchedSup?.name,
          });
        }
      }
    }
    return list;
  }, [products, suppliers]);

  // Filtrage
  const filteredSuggestions = useMemo(() => {
    return restockSuggestions.filter((item) => {
      const matchSearch =
        !searchFilter.trim() ||
        item.productName.toLowerCase().includes(searchFilter.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (item.variantName && item.variantName.toLowerCase().includes(searchFilter.toLowerCase()));
      const matchSupplier =
        !supplierFilter ||
        (supplierFilter === 'none' ? !item.supplierId : item.supplierId === supplierFilter);
      return matchSearch && matchSupplier;
    });
  }, [restockSuggestions, searchFilter, supplierFilter]);

  const handleQuickOrder = (item: typeof restockSuggestions[0]) => {
    if (item.supplierId) {
      setPoSupplierId(item.supplierId);
    } else if (suppliers[0]) {
      setPoSupplierId(suppliers[0].id);
    }
    setPoProductId(item.variantId ? `${item.productId}::${item.variantId}` : item.productId);
    setPoQty(item.suggestedQty);
    setPoUnitCost(item.unitCostXof || 1000);
    setShowPoModal(true);
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !poSupplierId) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const parts = poProductId.split('::');
      const productId = parts[0];
      const variantId = parts[1] || undefined;
      await apiFetch(`/shops/${shopId}/purchases`, {
        method: 'POST',
        shopId,
        operatorId: activeOperator?.id,
        body: {
          supplierId: poSupplierId,
          lines: [
            {
              productId,
              variantId,
              orderedQty: poQty,
              unitCostXof: poUnitCost,
            },
          ],
        },
      });
      setShowPoModal(false);
      setMsg('Bon de commande fournisseur (ACH) créé avec succès !');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de création de la commande fournisseur.');
    } finally {
      setBusy(false);
    }
  };

  const heroSection = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight text-white sm:text-xl">
            Réapprovisionnement
          </h1>
          <p className="text-[11px] text-emerald-200/70">
            Déficits de stock & commandes grossistes
          </p>
        </div>

        <button
          type="button"
          onClick={() => load()}
          disabled={loading || busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {/* 3 Cartes KPI compactes adaptées smartphone */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
        <div className="sc-dark-glass p-2.5 sm:p-3.5 rounded-xl text-center sm:text-left">
          <p className="text-[10px] sm:text-[11px] font-medium text-[#98b3ae]">À réappro</p>
          <p className="mt-0.5 text-base sm:text-xl font-extrabold text-amber-400 tabular">
            {restockSuggestions.length}
          </p>
        </div>

        <div className="sc-dark-glass p-2.5 sm:p-3.5 rounded-xl text-center sm:text-left">
          <p className="text-[10px] sm:text-[11px] font-medium text-[#98b3ae]">Volume</p>
          <p className="mt-0.5 text-base sm:text-xl font-extrabold text-white tabular">
            {restockSuggestions.reduce((sum, item) => sum + item.suggestedQty, 0)}
          </p>
        </div>

        <div className="lime-glow-card p-2.5 sm:p-3.5 rounded-xl border border-limeglow-400/30 text-center sm:text-left">
          <p className="text-[10px] sm:text-[11px] font-medium text-emerald-100/90">Budget est.</p>
          <p className="mt-0.5 text-xs sm:text-lg font-extrabold text-limeglow-300 tabular truncate">
            {formatXof(
              restockSuggestions.reduce(
                (sum, item) => sum + item.suggestedQty * item.unitCostXof,
                0,
              ),
            )}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <AppShell allowedRoles={['OWNER']} hero={heroSection}>
      <div className="space-y-4">
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {msg ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <span>{msg}</span>
          </div>
        ) : null}

        {/* Barre de filtres de supervision */}
        <div className="sc-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filtrer par article, taille, déclinaison ou SKU..."
              className="sc-input pl-9 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              aria-label="Filtrer par grossiste"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
            >
              <option value="">Tous les grossistes</option>
              <option value="none">Sans grossiste attitré</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : filteredSuggestions.length === 0 ? (
          <EmptyState
            title="Aucun besoin de réapprovisionnement détecté !"
            description={
              searchFilter || supplierFilter
                ? 'Aucun article ne correspond à vos filtres actuels.'
                : 'Tous vos articles sont au-dessus de leur seuil d’alerte de stock. Vos approvisionnements sont parfaits.'
            }
          />
        ) : (
          <div className="sc-card overflow-hidden">
            <div className="border-b border-slate-100 bg-porcelain-50 px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wide text-slate-800">
                Articles à réapprovisionner ({filteredSuggestions.length})
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Tri automatique par priorité de rupture
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-porcelain-50/60 text-left font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Article & Variante</th>
                    <th className="py-3 px-4">Grossiste attitré</th>
                    <th className="py-3 px-4 text-center">Stock actuel</th>
                    <th className="py-3 px-4 text-center">Seuil alerte</th>
                    <th className="py-3 px-4 text-center">Qté conseillée</th>
                    <th className="py-3 px-4 text-right">Coût estimé</th>
                    <th className="py-3 px-4 text-right">Action rapide</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredSuggestions.map((item, idx) => (
                    <tr key={`restock-${idx}`} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900">{item.productName}</p>
                        {item.variantName ? (
                          <p className="text-[11px] font-semibold text-brand-800">
                            {item.variantName}
                          </p>
                        ) : null}
                        <code className="text-[10px] text-slate-400 font-mono">{item.sku}</code>
                      </td>

                      <td className="py-3 px-4">
                        {item.supplierName ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 px-2.5 py-0.5 text-[11px] font-bold text-brand-800">
                            <Truck className="h-3 w-3" />
                            {item.supplierName}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">
                            Non rattaché
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <span
                          className={`font-extrabold tabular px-2.5 py-1 rounded-full ${
                            item.currentStock <= 0
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.currentStock} {item.unit}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-center text-slate-500 tabular font-semibold">
                        {item.alertThreshold}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <span className="font-extrabold text-emerald-700 tabular text-sm">
                          +{item.suggestedQty}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right font-bold text-slate-800 tabular">
                        {item.unitCostXof > 0
                          ? formatXof(item.suggestedQty * item.unitCostXof)
                          : 'À négocier'}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleQuickOrder(item)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-forest-900 px-3.5 py-1.5 text-xs font-bold text-limeglow-400 hover:bg-forest-800 shadow-2xs transition"
                        >
                          <ShoppingCart className="h-3.5 w-3.5" />
                          <span>Commander</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal création directe de commande fournisseur ACH */}
        {showPoModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 p-4 backdrop-blur-xs">
            <form
              onSubmit={handleCreatePo}
              className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-extrabold text-slate-900">
                  Créer un bon de commande fournisseur
                </h3>
                <button
                  type="button"
                  onClick={() => setShowPoModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Grossiste / Fournisseur *</label>
                <select
                  required
                  value={poSupplierId}
                  onChange={(e) => setPoSupplierId(e.target.value)}
                  className="sc-input mt-1"
                >
                  <option value="">Sélectionner un grossiste...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.phone ? `(${s.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Quantité à commander</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={poQty}
                    onChange={(e) => setPoQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="sc-input mt-1 font-bold text-emerald-800 text-center"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Prix unitaire achat (XOF)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={poUnitCost}
                    onChange={(e) => setPoUnitCost(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="sc-input mt-1 font-semibold tabular"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-porcelain-100 p-3 text-xs flex justify-between items-center">
                <span className="text-slate-500 font-medium">Montant estimé :</span>
                <strong className="text-slate-900 font-extrabold text-sm tabular">
                  {formatXof(poQty * poUnitCost)}
                </strong>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPoModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busy || !poSupplierId}
                  className="sc-btn-primary"
                >
                  {busy ? 'Génération...' : 'Valider la commande (ACH)'}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
