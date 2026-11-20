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

/**
 * Composant de rendu vectoriel d'un code-barres EAN-13 GS1 pur SVG.
 * 95 modules (largeur de barre unitaire 1, hauteur 50).
 */
export function Ean13BarcodeSvg({
  code,
  className = 'w-full max-w-[220px] h-16',
}: {
  code: string;
  className?: string;
}) {
  const bits = encodeEan13Bits(code);
  if (!bits || bits.length !== 95) {
    return (
      <div className="flex flex-col items-center justify-center p-2 border border-dashed border-red-300 rounded text-red-600 text-xs">
        <span>Code-barres EAN-13 invalide</span>
        <span className="font-mono">{code}</span>
      </div>
    );
  }

  // Indices des modules "guard" prolongés vers le bas dans la norme GS1 (start: 0-2, center: 45-49, end: 92-94)
  const isGuardModule = (i: number): boolean => {
    return (i >= 0 && i <= 2) || (i >= 45 && i <= 49) || (i >= 92 && i <= 94);
  };

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 115 62"
        className={className}
        preserveAspectRatio="xMidYMid meet"
        shapeRendering="crispEdges"
      >
        {/* Marge silencieuse gauche de 10 unités */}
        {bits.split('').map((bit, i) => {
          if (bit !== '1') return null;
          const isGuard = isGuardModule(i);
          const barHeight = isGuard ? 52 : 46;
          return (
            <rect
              key={i}
              x={10 + i}
              y={0}
              width={1}
              height={barHeight}
              fill="currentColor"
            />
          );
        })}

        {/* Chiffres sous les barres au format GS1 */}
        {/* 1er chiffre dans la zone silencieuse gauche */}
        <text
          x={4}
          y={58}
          fontSize="9"
          fontFamily="monospace"
          fontWeight="bold"
          fill="currentColor"
        >
          {code[0]}
        </text>

        {/* 6 chiffres de gauche */}
        <text
          x={28}
          y={58}
          fontSize="8.5"
          fontFamily="monospace"
          fontWeight="bold"
          letterSpacing="1.2"
          textAnchor="middle"
          fill="currentColor"
        >
          {code.slice(1, 7)}
        </text>

        {/* 6 chiffres de droite */}
        <text
          x={75}
          y={58}
          fontSize="8.5"
          fontFamily="monospace"
          fontWeight="bold"
          letterSpacing="1.2"
          textAnchor="middle"
          fill="currentColor"
        >
          {code.slice(7, 13)}
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
                    className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                      isSelected
                        ? 'bg-white/5 border-[#a3e635]/40'
                        : 'bg-black/20 border-[#1b3d3b]/60 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleSelect(item.id)}
                        className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                          isSelected
                            ? 'bg-[#a3e635] border-[#a3e635] text-[#051413]'
                            : 'border-white/30 bg-black/40'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>
                      <div>
                        <div className="font-bold text-sm text-white flex items-center gap-2">
                          <span>{item.name}</span>
                          {item.variantName && (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-[#a3e635]/20 text-[#a3e635] font-semibold">
                              {item.variantName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/60 flex items-center gap-3 mt-0.5 font-mono">
                          <span>SKU: {item.sku}</span>
                          <span>EAN: {item.barcode}</span>
                          <span className="text-[#a3e635] font-sans font-bold">
                            {formatXof(item.salePriceXof)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/60">Exemplaires :</span>
                      <div className="flex items-center bg-black/40 border border-[#1b3d3b] rounded-lg">
                        <button
                          type="button"
                          onClick={() => updateCopies(item.id, -1)}
                          className="p-1 hover:text-[#a3e635] transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center text-xs font-bold text-white font-mono">
                          {count}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCopies(item.id, 1)}
                          className="p-1 hover:text-[#a3e635] transition-colors"
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
