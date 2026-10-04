#!/usr/bin/env node
// Usage : node src/cli.js morceau.mp3 [dossier_sortie]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ExportError, toMidi, toMusicXml } from "./export.js";
import { AnalysisError, analyze } from "./pipeline.js";

const [src, outArg] = process.argv.slice(2);
if (!src) { console.error("Usage : node src/cli.js morceau.mp3 [dossier_sortie]"); process.exit(2); }
const out = outArg || src.replace(/\.[^.]+$/, "") + "_analyse";
await mkdir(out, { recursive: true });
let r;
try {
  r = await analyze(src, path.join(out, "travail.wav"), (p, m) => console.error(`[${String(p).padStart(3)}%] ${m}`));
} catch (e) {
  if (!(e instanceof AnalysisError)) throw e;
  console.error(`Échec de l'analyse : ${e.message}`); process.exit(1);
}
await writeFile(path.join(out, "analyse.json"), JSON.stringify(r, null, 2));
const { tempo: t, tonalite: k, melodie: m } = r, mesure = r.mesure?.valeur || "4/4";
console.log(`Tonalité : ${k.tonalite} (confiance ${k.confiance})`);
console.log(`Tempo    : ${t.bpm ?? "non détecté"} BPM (confiance ${t.confiance})`);
console.log(`Accords  : ${r.accords.slice(0, 16).map((c) => c.accord).join(" | ")}`);
console.log(`Mélodie  : ${m.notes.length} notes (confiance ${m.confiance})`);
try {
  await writeFile(path.join(out, "melodie.mid"), toMidi(m.notes, t.bpm, mesure));
  await writeFile(path.join(out, "melodie.musicxml"), toMusicXml(m.notes, t.bpm, { title: path.basename(src), tonic: k.tonique, mode: k.mode, timeSig: mesure }));
} catch (e) {
  if (!(e instanceof ExportError)) throw e;
  console.log(`Export non généré : ${e.message}`);
}
console.log(`Fichiers dans : ${out}`);
