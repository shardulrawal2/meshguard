// Simple haptic + audio feedback helper used for fall detection and panic button.

const SOUND_DURATION_MS = 220;

let audioContext: AudioContext | null = null;

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContext;
  } catch {
    return null;
  }
}

export function triggerAlertFeedback() {
  // Haptics (best-effort)
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([40, 40, 60]);
    }
  } catch {
    // ignore
  }

  // Audio beep (best-effort)
  const ctx = ensureAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = 880;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + SOUND_DURATION_MS / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + SOUND_DURATION_MS / 1000 + 0.05);
  } catch {
    // ignore audio errors
  }
}

