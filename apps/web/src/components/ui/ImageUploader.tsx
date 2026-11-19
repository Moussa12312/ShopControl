'use client';

import React, { useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';

interface ImageUploaderProps {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  purpose: 'product' | 'logo' | 'message';
  label?: string;
  hint?: string;
  compact?: boolean;
  aspect?: 'square' | 'wide';
}

async function compressImageToDataUrl(file: File, maxDim = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Fichier image invalide ou corrompu.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Impossible de traiter l’image.'));
          return;
        }
        // Conserve la transparence pour PNG logos, sinon JPEG/WebP propre
        const isPng = file.type === 'image/png';
        if (!isPng) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outMime = isPng ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(outMime, isPng ? undefined : 0.84);
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function ImageUploader({
  value,
  onChange,
  purpose,
  label,
  hint,
  compact = false,
  aspect = 'square',
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Format non supporté. Choisissez une image JPG, PNG ou WebP.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Image trop volumineuse (max 15 Mo avant compression).');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await compressImageToDataUrl(file, purpose === 'logo' ? 800 : 1200);
      const res = await apiFetch<{ url: string }>('/uploads/image', {
        method: 'POST',
        body: { dataUrl, purpose },
      });
      onChange(res.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message || 'Échec du téléversement.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="sc-btn-ghost px-3 py-2 text-xs"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
          ) : (
            <ImagePlus className="h-4 w-4 text-brand-600" />
          )}
          <span>{label || 'Joindre une photo'}</span>
        </button>
        {value ? (
          <div className="relative flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1 pr-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="Aperçu" className="h-7 w-7 rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Retirer l’image"
              className="text-rose-600 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {label ? <label className="block text-xs font-semibold text-slate-700">{label}</label> : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-4 transition ${
          dragOver
            ? 'border-brand-500 bg-brand-50/70'
            : value
              ? 'border-slate-200 bg-slate-50/60'
              : 'border-slate-300/80 bg-porcelain-50 hover:border-brand-400 hover:bg-brand-50/30'
        }`}
      >
        {value ? (
          <div className="flex w-full flex-col items-center gap-3 sm:flex-row">
            <div
              className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs ${
                aspect === 'wide' ? 'h-24 w-36' : 'h-24 w-24'
              } shrink-0`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={value} alt={label || 'Aperçu'} className="h-full w-full object-contain p-1" />
              {uploading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                  <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
                </div>
              ) : null}
            </div>
            <div className="flex flex-1 flex-col gap-2 text-center sm:text-left">
              <p className="text-xs font-semibold text-slate-800">Image téléversée et optimisée</p>
              <p className="text-[11px] text-slate-500">
                {hint || 'Affichée immédiatement sur le POS, les tickets et la vitrine QR.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="sc-btn-ghost px-3 py-1.5 text-xs"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Remplacer
                </button>
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Retirer
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center justify-center gap-2 py-3 text-center"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Camera className="h-5 w-5" />
              )}
            </span>
            <div>
              <p className="text-xs font-bold text-slate-800">
                {uploading ? 'Compression et envoi en cours…' : 'Cliquer ou glisser une photo ici'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {hint || 'PNG, JPG ou WebP — appareil photo mobile accepté (optimisé auto)'}
              </p>
            </div>
          </button>
        )}
      </div>

      {error ? (
        <p className="text-xs font-semibold text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
