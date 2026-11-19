'use client';

import React, { useState } from 'react';
import { formatXof } from '@shopcontrol/shared';

export function HealthBarPill({
  level,
  label,
  subText,
}: {
  level: 'OK' | 'LOW' | 'CRITICAL';
  label: string;
  subText?: string;
}) {
  const palette =
    level === 'OK'
      ? {
          wrap: 'bg-emerald-50/90 text-emerald-800 border-emerald-200/70',
          filled: 'bg-emerald-500',
          empty: 'bg-emerald-200/70',
          bars: 3,
        }
      : level === 'LOW'
        ? {
            wrap: 'bg-amber-50/90 text-amber-800 border-amber-200/70',
            filled: 'bg-amber-400',
            empty: 'bg-amber-200/70',
            bars: 3,
          }
        : {
            wrap: 'bg-rose-50/90 text-rose-800 border-rose-200/70',
            filled: 'bg-rose-500',
            empty: 'bg-rose-200/70',
            bars: 4,
          };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${palette.wrap}`}
    >
      {subText ? <span className="opacity-80">{subText}</span> : null}
      <span>{label}</span>
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-3 w-1.5 rounded-[2px] ${i < palette.bars ? palette.filled : palette.empty}`}
          />
        ))}
      </span>
    </span>
  );
}

export interface ChartPoint {
  date: string;
  label: string;
  currentXof: number;
  previousXof: number;
  salesCount: number;
}

/**
 * Graphique comparatif double courbe (période actuelle vs période précédente)
 * 100 % SVG natif, tactile sur mobile et tooltip adaptatif sans débordement.
 */
export function DualLineAnalyticsChart({
  points,
  metricMode = 'sales',
}: {
  points: ChartPoint[];
  metricMode?: 'sales' | 'count';
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(
    points.length > 0 ? Math.floor(points.length / 2) : null,
  );

  if (!points || points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl bg-slate-50 text-xs text-slate-400">
        Aucune donnée sur cette période
      </div>
    );
  }

  const width = 560;
  const height = 210;
  const padLeft = 40;
  const padRight = 14;
  const padTop = 18;
  const padBottom = 30;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const currValues = points.map((p) => (metricMode === 'count' ? p.salesCount : p.currentXof));
  const prevValues = points.map((p) => (metricMode === 'count' ? 0 : p.previousXof));
  const maxVal = Math.max(1, ...currValues, ...prevValues);
  const niceMax = Math.ceil(maxVal / 10) * 10;

  const xAt = (idx: number) =>
    points.length === 1 ? padLeft + innerW / 2 : padLeft + (idx / (points.length - 1)) * innerW;
  const yAt = (val: number) => padTop + innerH - (val / niceMax) * innerH;

  const buildSmoothPath = (vals: number[]) => {
    if (vals.length === 0) return '';
    return vals
      .map((v, i) => {
        const x = xAt(i);
        const y = yAt(v);
        if (i === 0) return `M ${x} ${y}`;
        const prevX = xAt(i - 1);
        const prevY = yAt(vals[i - 1]);
        const cx = (prevX + x) / 2;
        return `C ${cx} ${prevY}, ${cx} ${y}, ${x} ${y}`;
      })
      .join(' ');
  };

  const currLinePath = buildSmoothPath(currValues);
  const prevLinePath = metricMode === 'sales' ? buildSmoothPath(prevValues) : '';
  const areaPath =
    currValues.length > 0
      ? `${currLinePath} L ${xAt(currValues.length - 1)} ${padTop + innerH} L ${xAt(0)} ${padTop + innerH} Z`
      : '';

  const activeIdx =
    hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < points.length ? hoveredIdx : 0;
  const activePoint = points[activeIdx];

  const formatAxisVal = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${Math.round(val / 1_000)}k`;
    return String(val);
  };

  return (
    <div className="relative w-full select-none">
      {/* Bandeau de lecture mobile (évite tout chevauchement sur petits écrans) */}
      {activePoint ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-forest-900 px-3 py-2 text-xs text-white sm:hidden">
          <div>
            <span className="text-[10px] text-emerald-200/80">{activePoint.label} · </span>
            <strong className="text-sm">
              {metricMode === 'count'
                ? `${activePoint.salesCount} vente(s)`
                : formatXof(activePoint.currentXof)}
            </strong>
          </div>
          {metricMode === 'sales' ? (
            <span className="text-[11px] text-amber-300">
              Préc. : {formatXof(activePoint.previousXof)}
            </span>
          ) : null}
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full overflow-visible sm:h-52"
        role="img"
        aria-label="Évolution comparative des ventes"
      >
        <defs>
          <linearGradient id="scAreaMint" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a388" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#16a388" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((ratio) => {
          const y = padTop + innerH * (1 - ratio);
          const v = Math.round(niceMax * ratio);
          return (
            <g key={ratio}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="3 4"
                strokeWidth="1"
              />
              <text
                x={padLeft - 6}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 text-[10px]"
              >
                {formatAxisVal(v)}
              </text>
            </g>
          );
        })}

        {areaPath ? <path d={areaPath} fill="url(#scAreaMint)" /> : null}
        {prevLinePath ? (
          <path
            d={prevLinePath}
            fill="none"
            stroke="#d97706"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.75"
          />
        ) : null}
        {currLinePath ? (
          <path
            d={currLinePath}
            fill="none"
            stroke="#0c2221"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        ) : null}

        <line
          x1={xAt(activeIdx)}
          y1={padTop}
          x2={xAt(activeIdx)}
          y2={padTop + innerH}
          stroke="#0c2221"
          strokeDasharray="3 3"
          strokeWidth="1"
          opacity="0.35"
        />
        {metricMode === 'sales' ? (
          <circle
            cx={xAt(activeIdx)}
            cy={yAt(prevValues[activeIdx])}
            r="4"
            fill="#ffffff"
            stroke="#d97706"
            strokeWidth="2"
          />
        ) : null}
        <circle
          cx={xAt(activeIdx)}
          cy={yAt(currValues[activeIdx])}
          r="5"
          fill="#ffffff"
          stroke="#0c2221"
          strokeWidth="2.5"
        />

        {points.map((pt, i) => {
          const x = xAt(i);
          const showLabel =
            points.length <= 6 || i === 0 || i === points.length - 1 || i % 2 === 0;
          return (
            <g key={pt.date}>
              {showLabel ? (
                <text
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  className={`text-[10px] ${
                    activeIdx === i ? 'fill-forest-900 font-bold' : 'fill-slate-400'
                  }`}
                >
                  {pt.label}
                </text>
              ) : null}
              <rect
                x={x - innerW / Math.max(points.length * 2, 1)}
                y={padTop}
                width={innerW / Math.max(points.length, 1)}
                height={innerH + padBottom}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(i)}
                onClick={() => setHoveredIdx(i)}
                onTouchStart={() => setHoveredIdx(i)}
              />
            </g>
          );
        })}
      </svg>

      {/* Tooltip flottant sombre sur tablette/desktop */}
      {activePoint ? (
        <div
          className="pointer-events-none absolute top-2 z-10 hidden rounded-xl bg-forest-900 px-3.5 py-2.5 text-xs text-white shadow-lg transition-all sm:block"
          style={{
            left: `clamp(8px, calc(${(activeIdx / Math.max(1, points.length - 1)) * 72}% + 24px), calc(100% - 180px))`,
          }}
        >
          <p className="text-[10px] font-medium text-emerald-200/80">{activePoint.label}</p>
          <p className="mt-0.5 text-sm font-bold text-white">
            {metricMode === 'count'
              ? `${activePoint.salesCount} vente(s)`
              : formatXof(activePoint.currentXof)}
          </p>
          {metricMode === 'sales' ? (
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Période préc. : {formatXof(activePoint.previousXof)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
