import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, Timer } from 'lucide-react';

interface FallCountdownModalProps {
  seconds: number;
  severity: string;
  impact: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export const FallCountdownModal: React.FC<FallCountdownModalProps> = ({
  seconds,
  severity,
  impact,
  onCancel,
  onConfirm,
}) => {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    if (remaining <= 0) {
      onConfirm();
      return;
    }

    const timer = setTimeout(() => setRemaining((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onConfirm]);

  const impactRounded = impact.toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md">
      <div className="w-full max-w-sm mx-4 rounded-3xl bg-slate-900 border border-red-500/40 shadow-2xl shadow-red-900/40 p-6 relative overflow-hidden">
        <div className="absolute inset-x-0 -top-32 h-40 bg-red-500/20 blur-3xl" />

        <button
          type="button"
          onClick={onCancel}
          className="absolute right-4 top-4 p-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative flex flex-col items-center gap-4">
          <div className="p-3 rounded-2xl bg-red-500/20 text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-xs font-semibold tracking-widest uppercase">
              Fall Detected
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 rounded-full border-4 border-red-500/40 flex items-center justify-center">
              <span className="text-2xl font-black tabular-nums">{remaining}</span>
            </div>
            <div className="space-y-1 text-left">
              <p className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
                <Timer className="w-4 h-4 text-red-400" />
                Sending alert in {remaining} second{remaining === 1 ? '' : 's'}...
              </p>
              <p className="text-xs text-slate-400">
                Impact: <span className="font-semibold text-slate-100">{impactRounded} m/s²</span>{' '}
                · Severity:{' '}
                <span className="font-semibold capitalize text-red-300">
                  {severity}
                </span>
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-400 text-center max-w-xs">
            If this was a false alarm and you are safe, you can cancel the automatic SOS before it
            is broadcast to your mesh.
          </p>

          <button
            type="button"
            onClick={onCancel}
            className="mt-2 w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-50 text-xs font-black tracking-[0.25em] uppercase transition-all active:scale-95 border border-slate-600 shadow-lg shadow-slate-950/50"
          >
            I AM OKAY · CANCEL
          </button>
        </div>
      </div>
    </div>
  );
};

