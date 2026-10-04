"""Usage : python -m choir_core.cli morceau.mp3 [dossier_sortie]"""
import json, os, sys
from . import analyze, AnalysisError
from .export import to_midi, to_musicxml, ExportError


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(src)[0] + "_analyse"
    os.makedirs(out, exist_ok=True)
    try:
        r = analyze(src, os.path.join(out, "travail.wav"),
                    progress=lambda p, m: print(f"[{p:3d}%] {m}", file=sys.stderr))
    except AnalysisError as e:
        sys.exit(f"Échec de l'analyse : {e}")
    with open(os.path.join(out, "analyse.json"), "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False, indent=2)
    t, k = r["tempo"], r["tonalite"]
    print(f"Tonalité : {k['tonalite']} (confiance {k['confiance']})")
    print(f"Tempo    : {t['bpm']} BPM (confiance {t['confiance']})")
    print(f"Accords  : {' | '.join(c['accord'] for c in r['accords'][:16])}")
    print(f"Mélodie  : {len(r['melodie']['notes'])} notes (confiance {r['melodie']['confiance']})")
    try:
        to_midi(r["melodie"]["notes"], t["bpm"], os.path.join(out, "melodie.mid"))
        to_musicxml(r["melodie"]["notes"], t["bpm"], os.path.join(out, "melodie.musicxml"),
                    tonic=k["tonique"], mode=k["mode"],
                    time_sig=(r["mesure"] or {}).get("valeur", "4/4"))
    except ExportError as e:
        print(f"Export non généré : {e}")
    print(f"Fichiers dans : {out}")


if __name__ == "__main__":
    main()
