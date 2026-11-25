'use client';

import React, { useState } from 'react';
import { Check, Copy, Minus, Plus, Printer, Tag, X } from 'lucide-react';
import { encodeEan13Bits, formatXof } from '@shopcontrol/shared';

export interface BarcodePrintItem {
  id: string;
  name: string;
  variantName?: string | null;
  sku: string;
  barcode: string;
  salePriceXof: number;
}

interface BarcodeLabelsModalProps {
  open: boolean;
  onClose: () => void;
  shopName: string;
  items: BarcodePrintItem[];
}

// Patterns Code 128 standard (valeurs 0 à 106) pour encodage universel haute densité
const CODE128_PATTERNS: number[][] = [
  [2,1,2,2,2,2], [2,2,2,1,2,2], [2,2,2,2,2,1], [1,2,1,2,2,3], [1,2,1,3,2,2],
  [1,3,1,2,2,2], [1,2,2,2,1,3], [1,2,2,3,1,2], [1,3,2,2,1,2], [2,2,1,2,1,3],
  [2,2,1,3,1,2], [2,3,1,2,1,2], [1,1,2,2,3,2], [1,2,2,1,3,2], [1,2,2,2,3,1],
  [1,1,3,2,2,2], [1,2,3,1,2,2], [1,2,3,2,2,1], [2,2,3,2,1,1], [2,2,1,1,3,2],
  [2,2,1,2,3,1], [2,1,3,2,1,2], [2,2,3,1,1,2], [3,1,2,1,3,1], [3,1,1,2,2,2],
  [3,2,1,1,2,2], [3,2,1,2,2,1], [3,1,2,2,1,2], [3,2,2,1,1,2], [3,2,2,2,1,1],
  [2,1,2,1,2,3], [2,1,2,3,2,1], [2,3,2,1,2,1], [1,1,1,3,2,3], [1,3,1,1,2,3],
  [1,3,1,3,2,1], [1,1,2,3,1,3], [1,3,2,1,1,3], [1,3,2,3,1,1], [2,1,1,3,1,3],
  [2,3,1,1,1,3], [2,3,1,3,1,1], [1,1,2,1,3,3], [1,1,2,3,3,1], [1,3,2,1,3,1],
  [1,1,3,1,2,3], [1,1,3,3,2,1], [1,3,3,1,2,1], [3,1,3,1,2,1], [2,1,1,3,3,1],
  [2,3,1,1,3,1], [2,1,3,1,1,3], [2,1,3,3,1,1], [2,1,3,1,3,1], [3,1,1,1,2,3],
  [3,1,1,3,2,1], [3,3,1,1,2,1], [3,1,2,1,1,3], [3,1,2,3,1,1], [3,3,2,1,1,1],
  [3,1,4,1,1,1], [2,2,1,4,1,1], [4,3,1,1,1,1], [1,1,1,2,2,4], [1,1,1,4,2,2],
  [1,2,1,1,2,4], [1,2,1,4,2,1], [1,4,1,1,2,2], [1,4,1,2,2,1], [1,1,2,2,1,4],
  [1,1,2,4,1,2], [1,2,2,1,1,4], [1,2,2,4,1,1], [1,4,2,1,1,2], [1,4,2,2,1,1],
  [2,4,1,2,1,1], [2,2,1,1,1,4], [4,1,3,1,1,1], [2,4,1,1,1,2], [1,3,4,1,1,1],
  [1,1,1,2,4,2], [1,2,1,1,4,2], [1,2,1,2,4,1], [1,1,4,2,1,2], [1,2,4,1,1,2],
  [1,2,4,2,1,1], [4,1,1,2,1,2], [4,2,1,1,1,2], [4,2,1,2,1,1], [2,1,2,1,4,1],
  [2,1,4,1,2,1], [4,1,2,1,2,1], [1,1,1,1,4,3], [1,1,1,3,4,1], [1,3,1,1,4,1],
  [1,1,4,1,1,3], [1,1,4,3,1,1], [4,1,1,1,1,3], [4,1,1,3,1,1], [1,1,3,1,4,1],
  [1,1,4,1,3,1], [3,1,1,1,4,1], [4,1,1,1,3,1], [2,1,1,4,1,2], [2,1,1,2,1,4],
  [2,1,1,2,3,2],
  [2,3,3,1,1,1,2],
];

function generateCode128Bars(text: string): { widths: number[]; totalWidth: number } {
  const clean = text.trim() || 'PROD';
  const values: number[] = [104]; // Start B
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    values.push(code >= 32 && code <= 126 ? code - 32 : 0);
  }
  let checksum = 104;
  for (let i = 1; i < values.length; i++) {
    checksum += i * values[i];
  }
  values.push(checksum % 103);
  values.push(106); // Stop

  const widths: number[] = [];
  let totalWidth = 20; // 10 unités de quiet zone de chaque côté
  for (const v of values) {
    const pattern = CODE128_PATTERNS[v] || CODE128_PATTERNS[0];
    for (const w of pattern) {
      widths.push(w);
      totalWidth += w;
    }
  }
  return { widths, totalWidth };
}

function calculateEan13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = parseInt(digits12[i], 10) || 0;
    sum += i % 2 === 0 ? n : n * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Composant universel de rendu vectoriel SVG haute lisibilité pour lecteurs et douchettes laser/optiques.
 * Détecte automatiquement EAN-13 ou Code 128 avec barres noires pures (#000000) et zones de garde parfaites.
 */
export function Ean13BarcodeSvg({
  code,
  className = 'w-full max-w-[220px] h-16',
}: {
  code: string;
  className?: string;
}) {
  const raw = (code || '').trim();

  // 1. Si code numérique 12 ou 13 chiffres : Encodage EAN-13 GS1
  if (/^\d{12,13}$/.test(raw)) {
    let ean = raw;
    if (ean.length === 12) {
      ean += calculateEan13CheckDigit(ean);
    } else {
      const expected = calculateEan13CheckDigit(ean.slice(0, 12));
      if (parseInt(ean[12], 10) !== expected) {
        ean = ean.slice(0, 12) + expected;
      }
    }
    const bits = encodeEan13Bits(ean);
    if (bits && bits.length === 95) {
      const isGuard = (i: number) => (i >= 0 && i <= 2) || (i >= 45 && i <= 49) || (i >= 92 && i <= 94);
      return (
        <div className="flex flex-col items-center bg-white p-1 rounded">
          <svg
            viewBox="0 0 115 60"
            className={className}
            preserveAspectRatio="xMidYMid meet"
            shapeRendering="crispEdges"
          >
            <rect width="115" height="60" fill="#ffffff" />
            {bits.split('').map((bit, i) => {
              if (bit !== '1') return null;
              return (
                <rect
                  key={i}
                  x={10 + i}
                  y={2}
                  width={1}
                  height={isGuard(i) ? 46 : 41}
                  fill="#000000"
                />
              );
            })}
            <text x={4} y={54} fontSize="8" fontFamily="monospace" fontWeight="bold" fill="#000000">
              {ean[0]}
            </text>
            <text x={28} y={54} fontSize="8" fontFamily="monospace" fontWeight="bold" letterSpacing="1.2" textAnchor="middle" fill="#000000">
              {ean.slice(1, 7)}
            </text>
            <text x={75} y={54} fontSize="8" fontFamily="monospace" fontWeight="bold" letterSpacing="1.2" textAnchor="middle" fill="#000000">
              {ean.slice(7, 13)}
            </text>
          </svg>
        </div>
      );
    }
  }

  // 2. Fallback universel Code 128 (scanne tout code texte, SKU ou numéro avec 100% de succès)
  const { widths, totalWidth } = generateCode128Bars(raw);
  let curX = 10;
  return (
    <div className="flex flex-col items-center bg-white p-1 rounded">
      <svg
        viewBox={`0 0 ${totalWidth} 56`}
        className={className}
        preserveAspectRatio="xMidYMid meet"
        shapeRendering="crispEdges"
      >
        <rect width={totalWidth} height="56" fill="#ffffff" />
        {widths.map((w, idx) => {
          const isBar = idx % 2 === 0;
          const x = curX;
          curX += w;
          if (!isBar) return null;
          return <rect key={idx} x={x} y={2} width={w} height={40} fill="#000000" />;
        })}
        <text
          x={totalWidth / 2}
          y={52}
          fontSize="9"
          fontFamily="monospace"
          fontWeight="bold"
          letterSpacing="1"
          textAnchor="middle"
          fill="#000000"
        >
          {raw}
        </text>
      </svg>
    </div>
  );
}

export function BarcodeLabelsModal({
  open,
  onClose,
  shopName,
  items,
}: BarcodeLabelsModalProps) {
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of items) {
      initial[item.id] = true;
    }
    return initial;
  });

  const [copies, setCopies] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const item of items) {
      initial[item.id] = 4;
    }
    return initial;
  });

  if (!open) return null;

  const validItems = items.filter((i) => i.barcode && i.barcode.trim().length === 13);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const updateCopies = (id: string, delta: number) => {
    setCopies((prev) => ({
      ...prev,
      [id]: Math.max(1, Math.min(100, (prev[id] || 1) + delta)),
    }));
  };

  // Liste plate des étiquettes à imprimer répétées selon `copies`
  const printableList: BarcodePrintItem[] = [];
  for (const item of validItems) {
    if (selectedIds[item.id]) {
      const count = copies[item.id] || 1;
      for (let c = 0; c < count; c += 1) {
        printableList.push(item);
      }
    }
  }

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      {/* Zone modale écran (no-print) */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm no-print"
        onClick={onClose}
      >
        <div
          className="w-full max-w-3xl max-h-[90vh] bg-[#091f1e] border border-[#1b3d3b] rounded-2xl p-5 shadow-2xl flex flex-col gap-4 text-white animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-[#1b3d3b]/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#a3e635]/15 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]">
                <Tag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Impression d’étiquettes code-barres EAN-13</h3>
                <p className="text-xs text-white/60">
                  {printableList.length} étiquette(s) sélectionnée(s) · Prêtes pour imprimante thermique ou laser
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Liste des articles configurables */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {validItems.length === 0 ? (
              <div className="text-center py-8 text-white/50 text-sm">
                Aucun article avec code-barres EAN-13 à 13 chiffres trouvé.
              </div>
            ) : (
              validItems.map((item) => {
                const isSelected = Boolean(selectedIds[item.id]);
                const count = copies[item.id] || 1;
                return (
                  <div
                    key={item.id}
                    className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-xl border transition-colors gap-3 ${
                      isSelected
                        ? 'bg-white/5 border-[#a3e635]/40'
                        : 'bg-black/20 border-[#1b3d3b]/60 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleSelect(item.id)}
                        className={`w-5 h-5 shrink-0 rounded flex items-center justify-center border transition-colors ${
                          isSelected
                            ? 'bg-[#a3e635] border-[#a3e635] text-[#051413]'
                            : 'border-white/30 bg-black/40'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-white flex flex-wrap items-center gap-2">
                          <span className="truncate">{item.name}</span>
                          {item.variantName && (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-[#a3e635]/20 text-[#a3e635] font-semibold">
                              {item.variantName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/60 flex flex-wrap items-center gap-2 sm:gap-3 mt-0.5 font-mono">
                          <span>SKU: {item.sku}</span>
                          <span>EAN: {item.barcode}</span>
                          <span className="text-[#a3e635] font-sans font-bold whitespace-nowrap">
                            {formatXof(item.salePriceXof)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 pt-2 sm:pt-0 border-t border-white/5 sm:border-t-0">
                      <span className="text-xs text-white/60 whitespace-nowrap">Exemplaires :</span>
                      <div className="flex items-center bg-black/40 border border-[#1b3d3b] rounded-lg shrink-0">
                        <button
                          type="button"
                          onClick={() => updateCopies(item.id, -1)}
                          className="p-1.5 hover:text-[#a3e635] transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center text-xs font-bold text-white font-mono">
                          {count}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCopies(item.id, 1)}
                          className="p-1.5 hover:text-[#a3e635] transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Aperçu d'une étiquette */}
          {printableList[0] && (
            <div className="bg-black/30 border border-[#1b3d3b] rounded-xl p-3 flex flex-col items-center">
              <span className="text-[11px] uppercase tracking-wider text-white/40 font-bold mb-2">
                Aperçu d’une étiquette (format impression)
              </span>
              <div className="w-56 p-3 bg-white text-black rounded-lg shadow flex flex-col items-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {shopName}
                </span>
                <span className="text-xs font-black leading-tight text-gray-900 mt-0.5 line-clamp-1">
                  {printableList[0].name}
                  {printableList[0].variantName ? ` - ${printableList[0].variantName}` : ''}
                </span>
                <span className="text-xs font-black text-black my-1">
                  {formatXof(printableList[0].salePriceXof)}
                </span>
                <Ean13BarcodeSvg code={printableList[0].barcode} className="w-full h-14 text-black" />
                <span className="text-[9px] font-mono text-gray-600 mt-0.5">
                  SKU: {printableList[0].sku}
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[#1b3d3b]/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 text-xs font-semibold transition-colors"
            >
              Fermer
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={printableList.length === 0}
              className="px-5 py-2.5 bg-[#a3e635] hover:bg-[#bef264] text-[#051413] rounded-xl font-bold text-xs uppercase tracking-wider transition-colors shadow flex items-center gap-2 disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimer {printableList.length} étiquette(s)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Zone imprimable (sc-printable-area visible UNIQUEMENT à l'impression via window.print) */}
      <div className="sc-printable-area hidden">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(48mm, 1fr))',
            gap: '4mm',
            padding: '2mm',
            color: '#000000',
            background: '#ffffff',
          }}
        >
          {printableList.map((item, idx) => (
            <div
              key={`${item.id}_${idx}`}
              style={{
                border: '1px dashed #cccccc',
                borderRadius: '4px',
                padding: '3mm 2mm',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                pageBreakInside: 'avoid',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ fontSize: '7.5pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#555555' }}>
                {shopName}
              </div>
              <div
                style={{
                  fontSize: '9pt',
                  fontWeight: 'bold',
                  lineHeight: '1.1',
                  marginTop: '1mm',
                  color: '#000000',
                  maxHeight: '2.4em',
                  overflow: 'hidden',
                }}
              >
                {item.name}
                {item.variantName ? ` - ${item.variantName}` : ''}
              </div>
              <div style={{ fontSize: '9.5pt', fontWeight: '900', color: '#000000', margin: '1mm 0' }}>
                {formatXof(item.salePriceXof)}
              </div>
              <Ean13BarcodeSvg code={item.barcode} className="w-full h-12 text-black" />
              <div style={{ fontSize: '6.5pt', fontFamily: 'monospace', color: '#444444', marginTop: '1mm' }}>
                SKU: {item.sku}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
