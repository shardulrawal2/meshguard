import React, { useEffect, useRef, useState } from 'react';
import { AlertOctagon } from 'lucide-react';
import { triggerAlertFeedback } from '../utils/alertFeedback';

interface PanicButtonProps {
  onConfirm: () => void;
}

const HOLD_DURATION_MS = 2000;

export const PanicButton: React.FC<PanicButtonProps> = ({ onConfirm }) => {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const confirmedRef = useRef(false);

  const reset = () => {
    setHolding(false);
    setProgress(0);
    holdStartRef.current = null;
    confirmedRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const handleStart = () => {
    if (holding) return;
    setHolding(true);
    holdStartRef.current = performance.now();
    confirmedRef.current = false;

    const step = (now: number) => {
      if (!holdStartRef.current) return;
      const elapsed = now - holdStartRef.current;
      const ratio = Math.min(1, elapsed / HOLD_DURATION_MS);
      setProgress(ratio);

      if (ratio >= 1 && !confirmedRef.current) {
        confirmedRef.current = true;
        triggerAlertFeedback();
        onConfirm();
        reset();
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
  };

  const handleEnd = () => {
    if (!confirmedRef.current) {
      reset();
    }
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const borderDash = 100;
  const dashOffset = borderDash * (1 - progress);

  return (
    <button
      type="button"
      onMouseDown={handleStart}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={(e) => {
        e.preventDefault();
        handleStart();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        handleEnd();
      }}
      className="relative w-20 h-20 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 shadow-xl shadow-red-900/60 flex items-center justify-center transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-400 focus-visible:ring-offset-slate-950"
    >
      <span className="absolute inset-0 rounded-full bg-red-500/40 opacity-0 group-hover:opacity-100 blur-xl transition-opacity" />

      <AlertOctagon className="relative z-10 w-8 h-8 text-white drop-shadow-[0_0_10px_rgba(248,250,252,0.6)]" />

      <svg
        className="absolute inset-1 z-0 w-[calc(100%-0.25rem)] h-[calc(100%-0.25rem)]"
        viewBox="0 0 36 36"
      >
        <circle
          className="text-red-900/60"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          cx="18"
          cy="18"
          r="16"
        />
        <circle
          className="text-orange-300 transition-[stroke-dashoffset]"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          cx="18"
          cy="18"
          r="16"
          strokeDasharray={borderDash}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>

      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-black tracking-[0.3em] uppercase text-orange-300/90">
        Hold · Panic
      </span>
    </button>
  );
};

