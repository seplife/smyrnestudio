// Extraction de la mélodie (§4.B) par l'algorithme YIN (de Cheveigné & Kawahara, 2002).
//
// Limite assumée : YIN suit UNE voix. Il est fiable sur une voix seule, un
// fredonnement ou un instrument mélodique ; sur un mixage complet il faudra
// d'abord isoler la voix (phase 3). Il ne transcrit pas un chœur polyphonique.
import { HOP } from "./analysis.js";

const W = 1024, MIN_NOTE_S = 0.09;
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (midi) => `${SHARP[midi % 12]}${Math.floor(midi / 12) - 1}`;
const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

/** Hauteur fondamentale par trame : { midi (NaN si non voisé), prob }. */
export function yin(y, sr, fmin = 80, fmax = 1050) {
  const tauMax = Math.ceil(sr / fmin), tauMin = Math.floor(sr / fmax);
  const n = Math.floor(y.length / HOP) + 1, half = (W + tauMax) >> 1;
  const midi = new Float32Array(n).fill(NaN), prob = new Float32Array(n);
  const x = new Float32Array(W + tauMax), d = new Float32Array(tauMax + 1);
  for (let f = 0; f < n; f++) {
    const start = f * HOP - half;
    let energy = 0;
    for (let i = 0; i < x.length; i++) { const k = start + i; x[i] = k >= 0 && k < y.length ? y[k] : 0; }
    for (let i = 0; i < W; i++) energy += x[i] * x[i];
    if (Math.sqrt(energy / W) < 0.005) continue; // ≈ -45 dB sous la crête : silence
    let run = 0, best = -1, bestV = Infinity;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const e = x[j] - x[j + tau]; s += e * e; }
      run += s;
      d[tau] = run ? (s * tau) / run : 1; // différence normalisée par la moyenne cumulée
    }
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (d[tau] < 0.15 && d[tau] <= d[tau + 1]) { best = tau; bestV = d[tau]; break; } // 1er creux sous le seuil
      if (d[tau] < bestV) { bestV = d[tau]; best = tau; }
    }
    prob[f] = Math.max(0, Math.min(1, 1 - bestV));
    if (bestV > 0.3 || best <= tauMin || best >= tauMax - 1) continue;
    const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c;
    midi[f] = hzToMidi(sr / (best + (den ? (0.5 * (a - c)) / den : 0)));
  }
  return { midi, prob };
}

function median7(q) {
  const out = new Int16Array(q.length), w = [];
  for (let i = 0; i < q.length; i++) {
    w.length = 0;
    for (let j = i - 3; j <= i + 3; j++) w.push(q[Math.min(q.length - 1, Math.max(0, j))]);
    w.sort((a, b) => a - b);
    out[i] = w[3];
  }
  return out;
}

export function extract(y, sr, onsets) {
  const { midi, prob } = yin(y, sr);
  const n = midi.length, dt = HOP / sr, guard = Math.floor(MIN_NOTE_S / dt);
  const q = median7(Int16Array.from(midi, (m) => (Number.isNaN(m) ? -1 : Math.round(m))));
  const cut = new Uint8Array(n + 1);
  for (const o of onsets) if (o < n) cut[o] = 1; // attaques : séparent deux notes répétées de même hauteur
  const same = (from, v) => { for (let k = from; k < Math.min(n, from + guard); k++) if (q[k] !== v) return false; return true; };

  const notes = [];
  for (let i = 0; i < n; ) {
    let j = i + 1;
    while (j < n && q[j] === q[i] && !(cut[j] && j - i >= guard && same(j, q[i]))) j++;
    if (q[i] >= 0 && (j - i) * dt >= MIN_NOTE_S) {
      let sp = 0, sm = 0, sm2 = 0, k = 0;
      for (let f = i; f < j; f++) { sp += prob[f]; if (!Number.isNaN(midi[f])) { sm += midi[f]; sm2 += midi[f] ** 2; k++; } }
      const dev = k ? Math.sqrt(Math.max(0, sm2 / k - (sm / k) ** 2)) : 0;
      notes.push({ midi: q[i], nom: noteName(q[i]), debut_s: +(i * dt).toFixed(3), duree_s: +((j - i) * dt).toFixed(3),
        confiance: +(sp / (j - i)).toFixed(2), vibrato_probable: dev > 0.25 && (j - i) * dt > 0.4 });
    }
    i = j;
  }
  // Fusion d'un fragment très court avec la note identique qui le précède (trou < 60 ms)
  const merged = [];
  for (const nt of notes) {
    const m = merged[merged.length - 1];
    if (m && m.midi === nt.midi && nt.duree_s < 2 * MIN_NOTE_S && nt.debut_s - (m.debut_s + m.duree_s) < 0.06) {
      m.duree_s = +(nt.debut_s + nt.duree_s - m.debut_s).toFixed(3);
      m.confiance = +((m.confiance + nt.confiance) / 2).toFixed(2);
    } else merged.push(nt);
  }
  merged.forEach((nt, k) => (nt.id = k));
  let voiced = 0; for (const m of midi) if (!Number.isNaN(m)) voiced++;
  const out = {
    notes: merged, methode: "YIN (monophonique)", part_voisee: +(voiced / n).toFixed(2),
    confiance: merged.length ? +(merged.reduce((a, x) => a + x.confiance, 0) / merged.length).toFixed(2) : 0,
  };
  if (merged.length) {
    const ms = merged.map((x) => x.midi);
    out.ambitus = { min: noteName(Math.min(...ms)), max: noteName(Math.max(...ms)) };
  }
  return out;
}
