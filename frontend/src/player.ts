import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "./api";

/** Lecture synchronisée : enregistrement d'origine (élément audio) et/ou mélodie
 *  transcrite, rendue par un oscillateur. Ce n'est pas une voix : c'est un son de contrôle. */
export function usePlayer(notes: Note[], url: string, duree: number) {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [original, setOriginal] = useState(true);
  const [synth, setSynth] = useState(true);
  const ac = useRef<AudioContext | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const live = useRef<OscillatorNode[]>([]);
  const raf = useRef(0);
  const notesRef = useRef(notes); notesRef.current = notes;
  const posRef = useRef(0); posRef.current = pos;

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    live.current.forEach((o) => { try { o.stop(); } catch { /* déjà arrêté */ } });
    live.current = [];
    audio.current?.pause();
    setPlaying(false);
  }, []);
  useEffect(() => () => { stop(); ac.current?.close().catch(() => {}); }, [stop]);

  const play = useCallback(async (from = posRef.current) => {
    stop();
    const fin = Math.max(duree, ...notesRef.current.map((n) => n.debut_s + n.duree_s));
    if (from >= fin - 0.05) from = 0;
    const c = (ac.current ??= new AudioContext());
    await c.resume();
    const t0 = c.currentTime + 0.06;
    if (synth) {
      for (const n of notesRef.current) {
        const end = n.debut_s + n.duree_s;
        if (end <= from) continue;
        const s = t0 + Math.max(0, n.debut_s - from), e = t0 + end - from;
        const o = c.createOscillator(), g = c.createGain();
        o.type = "triangle";
        o.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.16, s + 0.015);
        g.gain.setValueAtTime(0.16, Math.max(s + 0.015, e - 0.03));
        g.gain.linearRampToValueAtTime(0, e);
        o.connect(g).connect(c.destination);
        o.start(s); o.stop(e + 0.02);
        live.current.push(o);
      }
    }
    if (original) {
      const a = (audio.current ??= new Audio());
      if (!a.src.endsWith(url)) a.src = url;
      a.currentTime = from;
      a.play().catch(() => {});
    }
    setPlaying(true);
    const tick = () => {
      const p = from + c.currentTime - t0;
      if (p >= fin) { stop(); setPos(0); return; }
      setPos(Math.max(0, p));
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }, [duree, original, synth, stop, url]);

  const seek = useCallback((t: number) => { setPos(t); if (playing) play(t); }, [play, playing]);
  return { playing, pos, play, stop, seek, original, setOriginal, synth, setSynth };
}
