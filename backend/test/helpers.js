import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { wavBuffer } from "../src/audio.js";

const SR = 44100;
export const tmp = mkdtempSync(path.join(tmpdir(), "choir-"));

/** Son harmonique (5 partiels) avec enveloppe, proche d'une voix tenue. */
function tone(midis, dur) {
  const n = Math.round(dur * SR), y = new Float32Array(n);
  for (const m of [].concat(midis)) {
    const f = 440 * 2 ** ((m - 69) / 12);
    for (let i = 0; i < n; i++) {
      const t = i / SR, env = Math.min(1, t / 0.02, (dur - t) / 0.03);
      let s = 0;
      for (let k = 1; k <= 5; k++) s += Math.sin(2 * Math.PI * f * k * t) / k;
      y[i] += s * env;
    }
  }
  return y;
}
function write(name, parts, gain) {
  const y = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { for (let i = 0; i < p.length; i++) y[o + i] = p[i] * gain; o += p.length; }
  const file = path.join(tmp, name);
  writeFileSync(file, wavBuffer(y, SR));
  return file;
}

/** Gamme de Do majeur montante puis descendante, noires à 120 BPM. */
export const SCALE = [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60];
export const scaleWav = () => write("gamme.wav", SCALE.map((m) => tone(m, 0.5)), 0.3);
/** C – F – G – C deux fois, une mesure par accord à 100 BPM, accord plaqué sur chaque temps. */
export const chordsWav = () => {
  const prog = [[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]];
  return write("accords.wav", [...prog, ...prog].flatMap((c) => [0, 1, 2, 3].map(() => tone(c, 0.6))), 0.15);
};
export const silenceWav = () => write("silence.wav", [new Float32Array(SR * 2)], 1);
