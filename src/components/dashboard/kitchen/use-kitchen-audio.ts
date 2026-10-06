'use client';

// FIX-C-002: Kitchen audio engine — extracted from kitchen-client.tsx.
// Singleton AudioContext + WAV preload → oscillator fallback → queue;
// attachAudioResumeOnInteraction unlocks iOS audio after first gesture.
import { useCallback, useEffect, useRef } from 'react';

export function useKitchenAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chimeBufRef = useRef<AudioBuffer | null>(null);
  const loadingChimeRef = useRef(false);
  const chimeQueueRef = useRef<(() => void)[]>([]);
  // Holds the latest playChime — lets the chime queue call it without the
  // callback self-referencing its own const (TDZ lint).
  const playChimeRef = useRef<() => void>(() => {});

  const getAudioCtx = useCallback((): AudioContext | null => {
    // FIX-A-001: typed cast بدل as any
    const AudioCtx =
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext ?? AudioContext;
    if (!AudioCtx) return null;
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioCtx();
    }
    return audioCtxRef.current;
  }, []);

  const ensureAudioReady = useCallback((): boolean => {
    const ctx = getAudioCtx();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      return false;
    }
    return ctx.state === 'running';
  }, [getAudioCtx]);

  const playFallbackChime = useCallback((ctx: AudioContext) => {
    const master = ctx.createGain();
    // Light chime, matching public/sounds/notification.wav: two soft bell notes
    // (A5 → D6) instead of the old three-tone 660/880/1100 alarm. Lower master
    // gain so a busy kitchen is not startled on every ticket.
    master.gain.value = 0.09;
    master.connect(ctx.destination);

    const notes = [880, 1174.66];
    const startTime = ctx.currentTime + 0.02;

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = startTime + i * 0.13;
      noteGain.gain.setValueAtTime(0, at);
      noteGain.gain.linearRampToValueAtTime(1, at + 0.008);
      noteGain.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
      osc.connect(noteGain);
      noteGain.connect(master);
      osc.start(at);
      osc.stop(at + 0.45);
    });
  }, []);

  const preloadChime = useCallback(() => {
    if (chimeBufRef.current || loadingChimeRef.current) return;
    loadingChimeRef.current = true;
    const ctx = getAudioCtx();
    if (!ctx) {
      loadingChimeRef.current = false;
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/sounds/notification.wav', true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      ctx
        .decodeAudioData(xhr.response)
        .then((buf) => {
          chimeBufRef.current = buf;
          loadingChimeRef.current = false;
          // Flush queue
          const q = chimeQueueRef.current.slice();
          chimeQueueRef.current = [];
          q.forEach((fn) => fn());
        })
        .catch(() => {
          loadingChimeRef.current = false;
          chimeQueueRef.current = [];
        });
    };
    xhr.onerror = () => {
      loadingChimeRef.current = false;
      chimeQueueRef.current = [];
    };
    xhr.send();
  }, [getAudioCtx]);

  const playChime = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      // If we have the decoded buffer, play it
      if (chimeBufRef.current) {
        const source = ctx.createBufferSource();
        source.buffer = chimeBufRef.current;
        const gain = ctx.createGain();
        gain.gain.value = 0.6;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start();
        return;
      }

      // If still loading, queue for retry — via playChimeRef to avoid
      // self-referencing the const inside its own initializer (TDZ lint).
      if (loadingChimeRef.current) {
        chimeQueueRef.current.push(() => playChimeRef.current());
        return;
      }

      // Start preloading for next time
      preloadChime();

      // Fallback: 3-tone restaurant chime
      playFallbackChime(ctx);
    } catch {
      // ignore
    }
  }, [getAudioCtx, preloadChime, playFallbackChime]);

  // Keep the ref pointing at the latest playChime so queued retries (pushed
  // while the .wav was still loading) always invoke the current closure.
  useEffect(() => {
    playChimeRef.current = playChime;
  });

  const attachAudioResumeOnInteraction = useCallback(() => {
    const handler = () => {
      const ctx = getAudioCtx();
      if (ctx?.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };
    document.addEventListener('click', handler);
    document.addEventListener('touchstart', handler);
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('keydown', handler);
    };
  }, [getAudioCtx]);

  return { playChime, ensureAudioReady, preloadChime, attachAudioResumeOnInteraction };
}
