// Décodage (ffmpeg) et préparation de l'audio (§3.C). Le fichier original
// n'est jamais modifié : on le décode en mémoire et on écrit une copie de travail.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export const WORK_SR = 22050;
export const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".webm"]);
export const VIDEO_EXT = new Set([".mp4", ".mov"]);
export const extOk = (e) => AUDIO_EXT.has(e) || VIDEO_EXT.has(e);

export class AudioError extends Error {}

// ffmpeg embarqué (paquet ffmpeg-static) : rien à installer sur la machine.
// FFMPEG_PATH permet d'imposer un autre binaire ; à défaut, celui du système.
let ffmpegPath;
async function ffmpegBin() {
  if (ffmpegPath) return ffmpegPath;
  let bundled = null;
  try { bundled = (await import("ffmpeg-static")).default; } catch { /* paquet absent */ }
  return (ffmpegPath = process.env.FFMPEG_PATH || (bundled && existsSync(bundled) ? bundled : "ffmpeg"));
}

async function run(args) {
  const bin = await ffmpegBin();
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args), out = [], err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", () => reject(new AudioError("Le décodeur audio (ffmpeg) est introuvable. Relancez « npm install » dans backend/, ou indiquez son chemin dans la variable FFMPEG_PATH.")));
    p.on("close", (code) => resolve({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString() }));
  });
}

/** Décode en mono float32. Renvoie aussi la fréquence d'échantillonnage du fichier d'origine. */
async function decode(file, sr) {
  const r = await run(["-hide_banner", "-nostats", "-i", file, "-vn", "-ac", "1", ...(sr ? ["-ar", String(sr)] : []), "-f", "f32le", "pipe:1"]);
  const m = r.err.match(/Stream #0[^\n]*Audio:[^\n]*?(\d+) Hz/);
  if (r.code !== 0 || r.out.length < 4 || !m) throw new AudioError("Fichier illisible ou sans piste audio.");
  const b = r.out.subarray(0, r.out.length - (r.out.length % 4));
  return { y: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), sr: parseInt(m[1], 10) };
}

export function wavBuffer(y, sr) {
  const b = Buffer.alloc(44 + y.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + y.length * 2, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(y.length * 2, 40);
  for (let i = 0; i < y.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, y[i])) * 32767), 44 + i * 2);
  return b;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

export async function prepare(file, workPath) {
  const ext = path.extname(file).toLowerCase();
  if (!extOk(ext)) throw new AudioError(`Format non pris en charge : ${ext || "inconnu"}`);
  const { y: y0, sr } = await decode(file);
  if (y0.length < sr / 2) throw new AudioError("Enregistrement trop court (moins de 0,5 s).");

  let peak = 0, clipped = 0, dropouts = 0, zeros = 0;
  const minRun = Math.floor(0.05 * sr);
  for (let i = 0; i < y0.length; i++) {
    const a = Math.abs(y0[i]);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    if (y0[i] === 0) zeros++;
    else { if (zeros >= minRun) dropouts++; zeros = 0; }
  }
  if (zeros >= minRun) dropouts++;
  if (peak < 1e-4) throw new AudioError("L'enregistrement est silencieux : aucun signal exploitable.");
  const clipRatio = clipped / y0.length;

  const y = sr === WORK_SR ? y0 : (await decode(file, WORK_SR)).y;
  let pk = 0;
  for (let i = 0; i < y.length; i++) pk = Math.max(pk, Math.abs(y[i]));
  for (let i = 0; i < y.length; i++) y[i] = (y[i] / pk) * 0.95; // normalisation crête

  // Énergie par trame : part de silence (< -40 dB sous le maximum) et dynamique
  const db = [];
  for (let s = 0; s + 2048 <= y.length; s += 512) {
    let e = 0;
    for (let i = s; i < s + 2048; i++) e += y[i] * y[i];
    db.push(20 * Math.log10(Math.max(Math.sqrt(e / 2048), 1e-6)));
  }
  const maxDb = Math.max(...db);
  const silence = db.filter((d) => d < maxDb - 40).length / db.length;
  const sorted = [...db].sort((a, b) => a - b);
  const snr = percentile(sorted, 95) - percentile(sorted, 5);

  const avertissements = [];
  if (clipRatio > 0.001) avertissements.push(`Saturation détectée sur ${(clipRatio * 100).toFixed(2)} % des échantillons.`);
  if (dropouts) avertissements.push(`${dropouts} coupure(s) du signal détectée(s).`);
  if (snr < 15) avertissements.push("Faible dynamique signal/bruit : résultats moins fiables.");
  if (sr < 16000) avertissements.push(`Fréquence d'échantillonnage basse (${sr} Hz).`);

  if (workPath) await writeFile(workPath, wavBuffer(y, WORK_SR));
  return {
    y, sr: WORK_SR,
    report: {
      duree_s: +(y0.length / sr).toFixed(2), frequence_origine_hz: sr, frequence_travail_hz: WORK_SR,
      part_silence: +silence.toFixed(3), dynamique_db: +snr.toFixed(1), saturation: +clipRatio.toFixed(5),
      coupures: dropouts, qualite: ["bonne", "moyenne"][avertissements.length] ?? "faible", avertissements,
    },
  };
}
