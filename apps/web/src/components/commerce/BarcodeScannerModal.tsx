'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ScanLine, Volume2, X } from 'lucide-react';

interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
  continuous?: boolean;
}

function playBeep() {
  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // Note A5 beep
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // audio not supported or blocked
  }
}

export function BarcodeScannerModal({
  open,
  onClose,
  onScan,
  title = 'Scanner un code-barres',
  continuous = false,
}: BarcodeScannerModalProps) {
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus pour lecteur physique (douchette USB / Bluetooth)
  useEffect(() => {
    if (open) {
      setLastScanned(null);
      setManualCode('');
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Initialisation caméra & BarcodeDetector si disponible
  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let active = true;
    let timer: number | null = null;

    const startCamera = async () => {
      setCameraError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError('Caméra non supportée par ce navigateur.');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
        setScanning(true);

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (BarcodeDetectorCtor) {
          const detector = new BarcodeDetectorCtor({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'qr_code'],
          });
          const detectLoop = async () => {
            if (!active || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes?.length > 0 && codes[0].rawValue) {
                const code = codes[0].rawValue.trim();
                if (code) {
                  playBeep();
                  setLastScanned(code);
                  onScan(code);
                  if (!continuous) {
                    onClose();
                    return;
                  }
                }
              }
            } catch {
              // Frame dropped or not decoded
            }
            if (active) {
              timer = window.setTimeout(detectLoop, 350);
            }
          };
          timer = window.setTimeout(detectLoop, 500);
        } else {
          setCameraError('Détecteur matériel natif indisponible (utilisez la douchette ou saisie rapide).');
        }
      } catch (err) {
        setCameraError('Accès à la caméra refusé ou indisponible.');
      }
    };

    void startCamera();

    return () => {
      active = false;
      setScanning(false);
      if (timer) window.clearTimeout(timer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [open, onScan, onClose, continuous]);

  if (!open) return null;

  const handleSubmitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualCode.trim();
    if (!clean) return;
    playBeep();
    setLastScanned(clean);
    onScan(clean);
    setManualCode('');
    if (!continuous) {
      onClose();
    } else {
      inputRef.current?.focus();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#091f1e] border border-[#1b3d3b] rounded-2xl p-5 shadow-2xl flex flex-col gap-4 text-white animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#1b3d3b]/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#a3e635]/15 border border-[#a3e635]/30 flex items-center justify-center text-[#a3e635]">
              <ScanLine className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">{title}</h3>
              <p className="text-xs text-white/60">Caméra, douchette code-barres USB ou saisie manuelle</p>
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

        {/* Cadre vidéo caméra */}
        <div className="relative aspect-video w-full bg-black/60 rounded-xl overflow-hidden border border-[#1b3d3b] flex items-center justify-center">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />

          {/* Viseur de scan animé */}
          {scanning && !cameraError && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-3/4 h-2/3 border-2 border-[#a3e635] rounded-xl relative shadow-[0_0_15px_rgba(163,230,53,0.3)]">
                <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-[#a3e635] shadow-[0_0_8px_#a3e635] animate-pulse" />
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-[#a3e635]" />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-[#a3e635]" />
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-[#a3e635]" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-[#a3e635]" />
              </div>
            </div>
          )}

          {cameraError && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-4 text-center">
              <Camera className="w-8 h-8 text-white/40 mb-2" />
              <p className="text-xs text-amber-300 font-medium">{cameraError}</p>
              <p className="text-[11px] text-white/60 mt-1">
                La douchette USB/Bluetooth et la saisie clavier ci-dessous restent 100% opérationnelles.
              </p>
            </div>
          )}
        </div>

        {/* Dernier code scanné */}
        {lastScanned && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#a3e635]/15 border border-[#a3e635]/40 text-xs text-[#a3e635]">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="font-semibold">Code scanné avec succès :</span>
            <span className="font-mono bg-black/40 px-2 py-0.5 rounded text-white">{lastScanned}</span>
          </div>
        )}

        {/* Formulaire saisie rapide / douchette */}
        <form onSubmit={handleSubmitManual} className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-white/80 flex items-center justify-between">
            <span>Saisie clavier ou douchette USB (prêt à flasher) :</span>
            <span className="text-[10px] text-[#a3e635] flex items-center gap-1 font-mono">
              <Volume2 className="w-3 h-3" /> bip sonore actif
            </span>
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Flashez avec la douchette ou tapez ici + Entrée..."
              className="flex-1 bg-black/40 border border-[#1b3d3b] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-white/35 focus:outline-none focus:border-[#a3e635] font-mono tracking-wider"
              autoFocus
            />
            <button
              type="submit"
              className="px-4 py-2.5 bg-[#a3e635] hover:bg-[#bef264] text-[#051413] rounded-xl font-bold text-xs uppercase tracking-wider transition-colors shadow"
            >
              Valider
            </button>
          </div>
        </form>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 text-xs font-semibold transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
