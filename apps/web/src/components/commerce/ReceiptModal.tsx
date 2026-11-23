'use client';

import React, { useState } from 'react';
import { Download, Printer, Share2, X } from 'lucide-react';
import { formatDateTimeInTimezone, formatXof } from '@shopcontrol/shared';
import { apiFetch, API_BASE_URL } from '@/lib/api-client';
import { useAuth } from '@/components/providers/AuthProvider';

export interface SaleDocumentView {
  id: string;
  documentNumber: string;
  documentType: 'SALE_RECEIPT' | 'CREDIT_NOTE';
  saleId: string;
  refundId?: string | null;
  status: 'VALID' | 'CANCELLED';
  printCount: number;
  isDuplicate: boolean;
  lastPrintedAt: string | null;
  createdAt: string;
  snapshot: Record<string, any>;
}

export function ReceiptModal({
  shopId,
  document,
  onClose,
  onUpdated,
}: {
  shopId: string;
  document: SaleDocumentView;
  onClose: () => void;
  onUpdated?: (doc: SaleDocumentView) => void;
}) {
  const { shops } = useAuth();
  const currentShop = shops.find((s) => s.shopId === shopId);
  const snap = document.snapshot || {};
  const shop = snap.shop || {};
  const cfg = snap.receiptSettings || {};
  const effectiveLogoUrl = shop.logoUrl || currentShop?.logoUrl || null;
  const effectiveShopName = shop.name || currentShop?.shopName || 'BOUTIQUE';
  const effectiveAddress = shop.address || currentShop?.address || null;
  const effectivePhone = shop.phone || currentShop?.phone || null;
  const [paperWidth, setPaperWidth] = useState<58 | 80>(cfg.paperWidthMm === 58 ? 58 : 80);
  const [printing, setPrinting] = useState(false);
  const [currentDoc, setCurrentDoc] = useState<SaleDocumentView>(document);

  const isCredit = currentDoc.documentType === 'CREDIT_NOTE';
  const isCancelled = currentDoc.status === 'CANCELLED';
  const showDuplicateBanner = currentDoc.printCount >= 1;

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const res = await apiFetch<SaleDocumentView>(
        `/shops/${shopId}/documents/${currentDoc.id}/print`,
        { method: 'POST' },
      );
      setCurrentDoc(res);
      onUpdated?.(res);
      window.setTimeout(() => window.print(), 120);
    } catch {
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  const handleDownloadPdf = () => {
    window.open(`${API_BASE_URL}/shops/${shopId}/documents/${currentDoc.id}/pdf`, '_blank', 'noopener');
  };

  const handleWhatsAppShare = () => {
    const title = isCredit
      ? `AVOIR ${currentDoc.documentNumber}`
      : `TICKET ${currentDoc.documentNumber}`;
    const totalLine = isCredit
      ? `Montant remboursé : -${formatXof(snap.amountXof || 0)}`
      : `Total : ${formatXof(snap.totalXof || 0)} | Payé : ${formatXof(snap.paidAmountXof || 0)}`;
    const linesText = !isCredit && Array.isArray(snap.lines)
      ? snap.lines.map((l: any) => `• ${l.quantity}x ${l.productName} : ${formatXof(l.lineTotalXof)}`).join('\n')
      : `Motif : ${snap.reason || 'Remboursement'}`;
    const msg = `${shop.name || 'ShopControl'}\n${title}\n${linesText}\n${totalLine}\n${cfg.footerText || 'Merci pour votre confiance !'}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 p-3 backdrop-blur-xs sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Aperçu du justificatif"
    >
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-porcelain-100 shadow-2xl">
        {/* Barre d'actions */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3.5 py-2.5 sm:px-5 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-xs font-bold text-slate-900 sm:text-sm">
              {isCredit ? 'Avoir' : 'Ticket'} · {currentDoc.documentNumber}
            </span>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-[11px] font-semibold sm:text-xs">
              <button
                type="button"
                onClick={() => setPaperWidth(58)}
                className={`rounded-lg px-2 py-0.5 transition sm:px-2.5 sm:py-1 ${
                  paperWidth === 58 ? 'bg-forest-900 text-white' : 'text-slate-600'
                }`}
              >
                58 mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth(80)}
                className={`rounded-lg px-2 py-0.5 transition sm:px-2.5 sm:py-1 ${
                  paperWidth === 80 ? 'bg-forest-900 text-white' : 'text-slate-600'
                }`}
              >
                80 mm
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={handleWhatsAppShare} className="sc-btn-ghost px-2.5 py-1.5 text-xs">
              <Share2 className="h-3.5 w-3.5 text-emerald-600" />
              <span className="hidden sm:inline">WhatsApp</span>
            </button>
            <button type="button" onClick={handleDownloadPdf} className="sc-btn-ghost px-2.5 py-1.5 text-xs">
              <Download className="h-3.5 w-3.5 text-brand-700" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing}
              className="sc-btn-primary px-2.5 py-1.5 text-xs sm:px-3"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>{currentDoc.printCount >= 1 ? 'Duplicata' : 'Imprimer'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="rounded-xl p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Aperçu thermique centré & imprimable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div
            className={`sc-printable-area relative mx-auto rounded-2xl border border-slate-200 bg-white p-5 font-mono text-xs text-slate-900 shadow-card ${
              paperWidth === 58 ? 'max-w-[260px]' : 'max-w-[350px]'
            }`}
          >
            {isCancelled ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="-rotate-12 rounded-xl border-4 border-rose-600/80 px-4 py-1 text-2xl font-black tracking-widest text-rose-600/80">
                  ANNULÉ
                </span>
              </div>
            ) : null}

            {/* En-tête Boutique + Logo */}
            <div className="text-center">
              {cfg.showLogo !== false && effectiveLogoUrl ? (
                <div className="mb-2 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={effectiveLogoUrl}
                    alt={effectiveShopName}
                    className="h-14 max-w-[140px] object-contain"
                  />
                </div>
              ) : null}
              <p className="text-sm font-black uppercase tracking-tight text-slate-950">
                {effectiveShopName}
              </p>
              {cfg.slogan ? <p className="text-[10px] italic text-slate-600">{cfg.slogan}</p> : null}
              {cfg.headerText ? <p className="mt-0.5 text-[10px] text-slate-700">{cfg.headerText}</p> : null}
              {effectiveAddress ? <p className="text-[10px] text-slate-600">{effectiveAddress}</p> : null}
              {effectivePhone ? <p className="text-[10px] text-slate-600">Tél : {effectivePhone}</p> : null}
            </div>

            <div className="my-3 border-y border-dashed border-slate-300 py-2 text-center">
              <p className="font-bold uppercase tracking-wider">
                {isCredit ? 'AVOIR / REMBOURSEMENT' : 'TICKET DE CAISSE'}
              </p>
              <p className="text-sm font-black">{currentDoc.documentNumber}</p>
              {showDuplicateBanner ? (
                <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">
                  ★ DUPLICATA (Impression #{currentDoc.printCount}) ★
                </span>
              ) : null}
              {isCancelled ? (
                <span className="mt-1 block text-[10px] font-black text-rose-700">
                  DOCUMENT ANNULÉ — SANS VALEUR
                </span>
              ) : null}
            </div>

            {/* Métadonnées */}
            <div className="space-y-0.5 text-[11px] text-slate-700">
              <p>Date : {formatDateTimeInTimezone(currentDoc.createdAt)}</p>
              {snap.operatorName ? <p>Opérateur : {snap.operatorName}</p> : null}
              {snap.client?.fullName ? (
                <p>
                  Client : {snap.client.fullName}
                  {snap.client.phone ? ` (${snap.client.phone})` : ''}
                </p>
              ) : null}
            </div>

            <div className="my-3 border-t border-dashed border-slate-300" />

            {/* Corps : Avoir ou Lignes vente */}
            {isCredit ? (
              <div className="space-y-2">
                <p>
                  <span className="text-slate-500">Vente d’origine :</span>{' '}
                  <strong>{snap.originalSaleNumber || '—'}</strong>
                </p>
                <p>
                  <span className="text-slate-500">Motif :</span> {snap.reason || 'Remboursement'}
                </p>
                <p>
                  <span className="text-slate-500">Mode :</span> {snap.paymentMethodCode || 'CASH'}
                </p>
                <div className="mt-3 border-t border-dashed border-slate-400 pt-2 text-right text-sm font-black text-rose-700">
                  REMBOURSÉ : -{formatXof(snap.amountXof || 0)}
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {(Array.isArray(snap.lines) ? snap.lines : []).map((l: any, idx: number) => (
                    <div key={idx} className="space-y-0.5">
                      <p className="font-bold text-slate-900">{l.productName}</p>
                      <div className="flex justify-between text-[11px] text-slate-600">
                        <span>
                          {l.quantity} × {formatXof(l.unitPriceXof)}
                          {l.discountXof > 0 ? ` (-${formatXof(l.discountXof)})` : ''}
                        </span>
                        <span className="font-bold text-slate-900 tabular">
                          {formatXof(l.lineTotalXof)}
                        </span>
                      </div>
                      {(l.serialNumber || l.warrantyEndsAt) && (
                        <div className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700">
                          {l.serialNumber ? <p>N° Série / IMEI : <strong>{l.serialNumber}</strong></p> : null}
                          {l.warrantyEndsAt ? (
                            <p>
                              Garantie{l.warrantyMonths ? ` (${l.warrantyMonths}m)` : ''} jusqu’au{' '}
                              <strong>{new Date(l.warrantyEndsAt).toLocaleDateString('fr-FR')}</strong>
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="my-3 border-t border-dashed border-slate-300 pt-2 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span>Sous-total brut</span>
                    <span className="tabular">{formatXof(snap.grossSubtotalXof || 0)}</span>
                  </div>
                  {(snap.discountTotalXof || 0) > 0 ? (
                    <div className="flex justify-between text-emerald-700">
                      <span>Remise</span>
                      <span className="tabular">-{formatXof(snap.discountTotalXof)}</span>
                    </div>
                  ) : null}
                  {(snap.taxTotalXof || 0) > 0 ? (
                    <div className="flex justify-between">
                      <span>Taxes ({snap.taxMode})</span>
                      <span className="tabular">{formatXof(snap.taxTotalXof)}</span>
                    </div>
                  ) : null}
                  {(snap.roundingXof || 0) !== 0 ? (
                    <div className="flex justify-between">
                      <span>Arrondi espèces</span>
                      <span className="tabular">
                        {snap.roundingXof > 0 ? '+' : ''}
                        {formatXof(snap.roundingXof)}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex justify-between border-t border-slate-900 pt-1.5 text-sm font-black text-slate-950">
                    <span>TOTAL</span>
                    <span className="tabular">{formatXof(snap.totalXof || 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span>Payé</span>
                    <span className="tabular">{formatXof(snap.paidAmountXof || 0)}</span>
                  </div>
                  {(snap.dueAmountXof || 0) > 0 ? (
                    <div className="flex justify-between font-bold text-amber-700">
                      <span>Reste dû (Créance)</span>
                      <span className="tabular">{formatXof(snap.dueAmountXof)}</span>
                    </div>
                  ) : null}
                </div>

                {Array.isArray(snap.payments) && snap.payments.length > 0 ? (
                  <div className="mt-2 border-t border-dashed border-slate-200 pt-2 text-[10px] text-slate-600">
                    <p className="font-bold text-slate-700">Règlements :</p>
                    {snap.payments.map((p: any, i: number) => (
                      <p key={i}>
                        • {p.paymentMethodCode} : {formatXof(p.amountXof)}
                        {p.transactionRef ? ` (Réf: ${p.transactionRef})` : ''}
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            )}

            {/* Pied de ticket */}
            <div className="mt-4 border-t border-dashed border-slate-300 pt-3 text-center text-[10px] text-slate-600">
              {cfg.footerText ? <p className="font-semibold text-slate-800">{cfg.footerText}</p> : null}
              <p className="mt-1 text-[9px] text-slate-500">
                {cfg.legalNotice || 'Justificatif de vente commercial — ShopControl.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
