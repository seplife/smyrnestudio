"""Chaîne d'analyse complète avec suivi d'avancement."""
from __future__ import annotations
from typing import Callable
from . import prepare as prep, analysis, melody


class AnalysisError(Exception):
    pass


def analyze(path: str, work_path: str | None = None,
            progress: Callable[[int, str], None] = lambda p, m: None) -> dict:
    progress(5, "Préparation de l'audio")
    try:
        a = prep.prepare(path, work_path)
    except prep.AudioError as e:
        raise AnalysisError(str(e)) from e
    y, sr, dur = a["y"], a["sr"], a["report"]["duree_s"]

    progress(25, "Tempo et mesure")
    tb = analysis.tempo_and_beats(y, sr)
    progress(45, "Tonalité")
    ch = analysis.chroma(y, sr)
    k = analysis.key(ch)
    progress(60, "Accords")
    chords = analysis.chords(ch, sr, tb["beats_s"], len(y) / sr)
    progress(75, "Mélodie")
    mel = melody.extract(y, sr)
    progress(100, "Analyse terminée")

    limites = [
        "Mélodie : suivi monophonique (pYIN). Sur un mixage complet ou un chœur, isoler la voix au préalable (phase 3).",
        "Accords : triades majeures/mineures uniquement.",
        "Mesure : hypothèse binaire/ternaire à confirmer.",
    ]
    if not mel["notes"]:
        limites.insert(0, "Aucune mélodie exploitable détectée : aucune note n'a été inventée.")
    elif mel["confiance"] < 0.5:
        limites.insert(0, "Mélodie peu fiable sur cet enregistrement : vérification manuelle recommandée.")
    return {
        "audio": a["report"],
        "tempo": {k2: tb[k2] for k2 in ("bpm", "confiance", "hypotheses")},
        "mesure": tb["mesure"],
        "tonalite": k,
        "accords": chords,
        "melodie": mel,
        "beats_s": tb["beats_s"],
        "limites": limites,
    }
