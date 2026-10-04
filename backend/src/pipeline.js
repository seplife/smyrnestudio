// Chaîne d'analyse complète avec suivi d'avancement.
import { AudioError, prepare } from "./audio.js";
import { chords, chroma, key, onsetEnvelope, onsetFrames, tempoAndBeats } from "./analysis.js";
import { extract } from "./melody.js";

export class AnalysisError extends Error {}

export async function analyze(file, workPath = null, progress = () => {}) {
  progress(5, "Préparation de l'audio");
  let a;
  try { a = await prepare(file, workPath); }
  catch (e) { if (e instanceof AudioError) throw new AnalysisError(e.message); throw e; }
  const { y, sr } = a;

  progress(20, "Tempo et mesure");
  const env = onsetEnvelope(y);
  const tb = tempoAndBeats(env, sr);
  progress(40, "Tonalité");
  const ch = chroma(y, sr);
  const tonalite = key(ch);
  progress(55, "Accords");
  const accords = chords(ch, sr, tb.beats_s, y.length / sr);
  progress(65, "Mélodie");
  const melodie = extract(y, sr, onsetFrames(env, sr));
  progress(100, "Analyse terminée");

  const limites = [
    "Mélodie : suivi d'une seule voix (YIN). Sur un mixage complet ou un chœur, il faudra isoler la voix au préalable (phase 3).",
    "Accords : triades majeures/mineures uniquement.",
    "Mesure : hypothèse binaire/ternaire à confirmer.",
  ];
  if (!melodie.notes.length) limites.unshift("Aucune mélodie exploitable détectée : aucune note n'a été inventée.");
  else if (melodie.confiance < 0.5) limites.unshift("Mélodie peu fiable sur cet enregistrement : vérification manuelle recommandée.");
  const { bpm, confiance, hypotheses, mesure, beats_s } = tb;
  return { audio: a.report, tempo: { bpm, confiance, hypotheses }, mesure, tonalite, accords, melodie, beats_s, limites };
}
