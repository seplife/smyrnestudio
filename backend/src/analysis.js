// Tempo, mesure, tonalité, accords (§4.A). Chaque résultat porte une confiance
// et, quand c'est ambigu, plusieurs hypothèses.
import { stft } from "./fft.js";

export const NOTES_FR = ["Do", "Do#", "Ré", "Mib", "Mi", "Fa", "Fa#", "Sol", "Lab", "La", "Sib", "Si"];
export const NOTES_EN = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export const HOP = 256; // trame commune à l'enveloppe d'attaques et au suivi de hauteur
const r2 = (x) => +x.toFixed(2), r3 = (x) => +x.toFixed(3);
const clip = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

/** Enveloppe d'attaques : flux spectral (hausse de log-amplitude, redressée). Normalisée à 1. */
export function onsetEnvelope(y) {
  const S = stft(y, 1024, HOP), env = new Float32Array(S.length);
  let prev = null, max = 0;
  for (let f = 0; f < S.length; f++) {
    const cur = S[f].map((m) => Math.log1p(20 * m));
    if (prev) { let s = 0; for (let i = 0; i < cur.length; i++) { const d = cur[i] - prev[i]; if (d > 0) s += d; } env[f] = s / cur.length; }
    prev = cur;
    if (env[f] > max) max = env[f];
  }
  if (max > 0) for (let f = 0; f < env.length; f++) env[f] /= max;
  return env;
}

/** Pics de l'enveloppe = attaques (mêmes règles que les détecteurs usuels). */
export function onsetFrames(env, sr) {
  const fr = sr / HOP, preMax = Math.round(0.03 * fr), avg = Math.round(0.1 * fr), wait = Math.round(0.03 * fr);
  const out = []; let last = -Infinity;
  for (let i = 1; i < env.length; i++) {
    let isMax = true;
    for (let j = Math.max(0, i - preMax); j <= Math.min(env.length - 1, i + 1); j++) if (env[j] > env[i]) { isMax = false; break; }
    if (!isMax) continue;
    let s = 0, n = 0;
    for (let j = Math.max(0, i - avg); j <= Math.min(env.length - 1, i + avg); j++) { s += env[j]; n++; }
    if (env[i] >= s / n + 0.07 && i - last > wait) { out.push(i); last = i; }
  }
  return out;
}

function autocorr(x, maxLag) {
  let mean = 0; for (const v of x) mean += v; mean /= x.length;
  const ac = new Float64Array(maxLag + 1);
  for (let l = 0; l <= maxLag; l++) { let s = 0; for (let i = 0; i + l < x.length; i++) s += (x[i] - mean) * (x[i + l] - mean); ac[l] = s; }
  return ac;
}

/** Suivi de battements par programmation dynamique (Ellis, 2007). */
function trackBeats(env, period) {
  const n = env.length, score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  let sd = 0; for (const v of env) sd += v * v; sd = Math.sqrt(sd / n) || 1;
  const lo = Math.round(period / 2), hi = Math.round(period * 2), tight = 100;
  let first = true;
  for (let i = 0; i < n; i++) {
    let best = -Infinity, arg = -1;
    for (let d = lo; d <= hi && i - d >= 0; d++) {
      const s = score[i - d] - tight * Math.log(d / period) ** 2;
      if (s > best) { best = s; arg = i - d; }
    }
    const local = env[i] / sd;
    if (arg >= 0 && best > 0) { score[i] = local + best; back[i] = arg; }
    else score[i] = local;
    if (first && local < 0.01) score[i] = 0; else first = false;
  }
  let end = n - 1, top = -Infinity;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > top) { top = score[i]; end = i; }
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) { beats.push(i); if (back[i] < 0) break; }
  return beats.reverse();
}

export function tempoAndBeats(env, sr) {
  const fr = sr / HOP;
  const none = { bpm: null, confiance: 0, hypotheses: [], beats_s: [], mesure: null };
  if (env.length < fr * 2 || !env.some((v) => v > 0)) return none;
  const maxLag = Math.min(env.length - 1, Math.round((60 / 30) * fr)), minLag = Math.round((60 / 240) * fr);
  const ac = autocorr(env, maxLag);
  if (ac[0] <= 0) return none;
  // Préférence douce pour les tempos proches de 120 BPM (lève l'ambiguïté d'octave)
  let bestLag = -1, bestScore = -Infinity;
  for (let l = minLag; l <= maxLag; l++) {
    const bpm = (60 * fr) / l, w = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    if (ac[l] * w > bestScore) { bestScore = ac[l] * w; bestLag = l; }
  }
  const beats = trackBeats(env, bestLag);
  const bt = beats.map((b) => (b * HOP) / sr);
  let bpm = (60 * fr) / bestLag, reg = 0;
  if (bt.length > 3) {
    const ibi = bt.slice(1).map((t, i) => t - bt[i]);
    const mean = (bt[bt.length - 1] - bt[0]) / (bt.length - 1);
    const sd = Math.sqrt(ibi.reduce((a, v) => a + (v - mean) ** 2, 0) / ibi.length);
    reg = clip(1 - (sd / mean) * 4);
    if (reg > 0.5) bpm = 60 / mean; // intervalle moyen : plus précis que le pas d'une trame
  }
  const strength = (b) => (b < 30 || b > 240 ? 0 : Math.max(0, ac[Math.min(maxLag, Math.round((60 * fr) / b))] / ac[0]));
  const cands = [bpm, bpm / 2, bpm * 2].filter((b) => b >= 30 && b <= 240).map((b) => ({ bpm: +b.toFixed(1), s: strength(b) }));
  const tot = cands.reduce((a, c) => a + c.s, 0) || 1;
  const hypotheses = cands.map((c) => ({ bpm: c.bpm, confiance: r2(c.s / tot) })).sort((a, b) => b.confiance - a.confiance);
  const own = hypotheses.find((h) => h.bpm === +bpm.toFixed(1))?.confiance ?? 0;
  return { bpm: +bpm.toFixed(1), confiance: r2(reg * Math.sqrt(own)), hypotheses, beats_s: bt.map(r3), mesure: meter(env, beats) };
}

/** Hypothèse binaire/ternaire par autocorrélation des accents sur les temps. Fragile : renvoyée avec les deux lectures. */
function meter(env, beats) {
  if (beats.length < 16) return null;
  const acc = beats.map((b) => env[b]), ac = autocorr(acc, 4);
  const s = { "4/4": Math.max(ac[4], ac[2]) / ac[0], "3/4": ac[3] / ac[0] };
  const e = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.exp(4 * v)]));
  const tot = e["4/4"] + e["3/4"];
  const hypotheses = Object.entries(e).map(([mesure, v]) => ({ mesure, confiance: r2(v / tot) })).sort((a, b) => b.confiance - a.confiance);
  return { valeur: hypotheses[0].mesure, confiance: hypotheses[0].confiance, hypotheses,
    note: "6/8 et 12/8 ne sont pas distingués à ce stade ; à confirmer par l'utilisateur." };
}

export const CHROMA_FFT = 8192, CHROMA_HOP = 2048;
/** Chromagramme : énergie des pics spectraux (65–2100 Hz) repliée sur les 12 demi-tons. */
export function chroma(y, sr) {
  const S = stft(y, CHROMA_FFT, CHROMA_HOP), binHz = sr / CHROMA_FFT;
  const lo = Math.ceil(65 / binHz), hi = Math.floor(2100 / binHz);
  return S.map((mag) => {
    const c = new Float64Array(12);
    for (let k = lo; k <= hi; k++) {
      if (mag[k] <= mag[k - 1] || mag[k] < mag[k + 1]) continue;
      const a = mag[k - 1], b = mag[k], d = mag[k + 1], den = a - 2 * b + d;
      const f = (k + (den ? (0.5 * (a - d)) / den : 0)) * binHz;
      const midi = 69 + 12 * Math.log2(f / 440), near = Math.round(midi);
      c[((near % 12) + 12) % 12] += b * Math.exp(-0.5 * ((midi - near) / 0.25) ** 2);
    }
    return c;
  });
}

function corr(a, b) {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Krumhansl-Schmuckler : corrélation du chroma moyen avec les 24 profils de tonalité. */
export function key(ch) {
  const v = new Array(12).fill(0);
  for (const c of ch) { const m = Math.max(...c); if (m > 0) for (let i = 0; i < 12; i++) v[i] += c[i] / m; }
  const scores = [];
  for (let i = 0; i < 12; i++)
    for (const [mode, prof] of [["majeur", MAJ], ["mineur", MIN]])
      scores.push({ r: corr(v, prof.map((_, k) => prof[(k - i + 12) % 12])), i, mode });
  scores.sort((a, b) => b.r - a.r);
  const e = scores.map((s) => Math.exp(s.r * 10)), tot = e.reduce((a, b) => a + b, 0);
  const hypotheses = scores.slice(0, 3).map((s, k) => ({ tonalite: `${NOTES_FR[s.i]} ${s.mode}`, tonique: NOTES_EN[s.i], mode: s.mode, confiance: r2(e[k] / tot) }));
  return { ...hypotheses[0], hypotheses };
}

const TEMPLATES = [];
for (let i = 0; i < 12; i++)
  for (const [suf, iv] of [["", [0, 4, 7]], ["m", [0, 3, 7]]]) {
    const t = new Array(12).fill(0);
    for (const k of iv) t[(i + k) % 12] = 1 / Math.sqrt(3);
    TEMPLATES.push({ name: NOTES_EN[i] + suf, t });
  }

/** Accords majeurs/mineurs par gabarits sur le chroma moyenné entre deux temps. Pas de 7e, sus, ni renversements. */
export function chords(ch, sr, beats, duration) {
  let bounds = beats.length >= 4 ? [...beats] : Array.from({ length: Math.ceil(duration / 0.5) }, (_, i) => i * 0.5);
  bounds = [...new Set([0, ...bounds, duration])].sort((a, b) => a - b);
  const out = [];
  for (let b = 0; b + 1 < bounds.length; b++) {
    const t0 = bounds[b], t1 = bounds[b + 1], v = new Array(12).fill(0);
    // trames dont le centre tombe dans l'intervalle (au moins la plus proche du milieu)
    let f0 = Math.ceil((t0 * sr) / CHROMA_HOP), f1 = Math.floor((t1 * sr) / CHROMA_HOP);
    if (f1 < f0) f0 = f1 = Math.round((((t0 + t1) / 2) * sr) / CHROMA_HOP);
    for (let f = f0; f <= Math.min(f1, ch.length - 1); f++) for (let i = 0; i < 12; i++) v[i] += ch[f][i];
    const norm = Math.hypot(...v);
    if (norm < 1e-9) continue;
    const sims = TEMPLATES.map(({ name, t }) => ({ name, s: t.reduce((a, x, i) => a + (x * v[i]) / norm, 0) })).sort((a, b) => b.s - a.s);
    const conf = clip((sims[0].s - 0.5) * 2) * clip((sims[0].s - sims[1].s) * 8 + 0.5);
    const last = out[out.length - 1];
    if (last && last.accord === sims[0].name) {
      const w0 = last.fin_s - last.debut_s, w1 = t1 - t0;
      last.confiance = r2((last.confiance * w0 + conf * w1) / (w0 + w1));
      last.fin_s = r3(t1);
    } else out.push({ accord: sims[0].name, alternative: sims[1].name, debut_s: r3(t0), fin_s: r3(t1), confiance: r2(conf) });
  }
  return out;
}
