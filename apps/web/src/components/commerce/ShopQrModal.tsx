'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Loader2, Printer, QrCode, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

interface QrPayload {
  shopName: string;
  slug: string;
  logoUrl?: string | null;
  storefrontUrl: string;
  pngDataUrl: string;
  svg: string;
}

export function ShopQrModal({
  slug,
  shopName,
  logoUrl,
  onClose,
}: {
  slug: string;
  shopName: string;
  logoUrl?: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<QrPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    setLoading(true);
    apiFetch<QrPayload>(`/public/shops/${slug}/qr?origin=${encodeURIComponent(origin)}`, {
      requiresOnline: false,
    })
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [slug]);

  const handleCopy = async () => {
    if (!data?.storefrontUrl) return;
    await navigator.clipboard.writeText(data.storefrontUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPng = () => {
    if (!data?.pngDataUrl) return;
    const a = document.createElement('a');
    a.href = data.pngDataUrl;
    a.download = `qr-${slug}.png`;
    a.click();
  };

  const handleDownloadSvg = () => {
    if (!data?.svg) return;
    const blob = new Blob([data.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-${slug}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 p-3 backdrop-blur-xs sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="QR Code vitrine boutique"
    >
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-porcelain-100 shadow-2xl">
        <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-brand-600" />
            <h2 className="text-sm font-bold text-slate-900">QR Code Permanent & Affiche Vitrine</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-xl p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
              <p className="mt-2 text-xs">Génération du QR Code permanent…</p>
            </div>
          ) : data ? (
            <div className="space-y-4">
              {/* Affiche imprimable A4/A5 */}
              <div className="sc-printable-area mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-card">
                <div className="flex flex-col items-center">
                  {logoUrl || data.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl || data.logoUrl || ''}
                      alt={shopName}
                      className="mb-3 h-16 max-w-[160px] object-contain"
                    />
                  ) : (
                    <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-900 text-lg font-black text-limeglow-400">
                      {shopName.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <h3 className="text-xl font-black tracking-tight text-forest-950">{shopName}</h3>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-brand-700">
                    Scannez pour voir le catalogue & commander
                  </p>
                </div>

                <div className="my-5 inline-flex rounded-3xl border-4 border-forest-900 bg-white p-3 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.pngDataUrl}
                    alt={`QR Code ${shopName}`}
                    className="h-52 w-52 sm:h-60 sm:w-60"
                  />
                </div>

                <p className="break-all rounded-xl bg-porcelain-100 px-3 py-2 font-mono text-[11px] font-semibold text-forest-900">
                  {data.storefrontUrl}
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  Commande sans compte · Stock en temps réel · Retrait boutique ou livraison
                </p>
              </div>

              {/* Actions */}
              <div className="no-print grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button type="button" onClick={handleCopy} className="sc-btn-ghost text-xs">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copié !' : 'Copier lien'}
                </button>
                <button type="button" onClick={handleDownloadPng} className="sc-btn-ghost text-xs">
                  <Download className="h-4 w-4" />
                  PNG HD
                </button>
                <button type="button" onClick={handleDownloadSvg} className="sc-btn-ghost text-xs">
                  <Download className="h-4 w-4" />
                  SVG
                </button>
                <button type="button" onClick={() => window.print()} className="sc-btn-primary text-xs">
                  <Printer className="h-4 w-4" />
                  Imprimer affiche
                </button>
              </div>

              <div className="no-print text-center">
                <a
                  href={`/s/${slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Prévisualiser la vitrine publique /s/{slug}
                </a>
              </div>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-rose-600">
              Impossible de générer le QR Code pour cette boutique.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
