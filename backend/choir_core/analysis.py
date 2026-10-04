"""Tempo, mesure, tonalité, accords (§4.A). Chaque résultat porte une confiance
et, quand c'est ambigu, plusieurs hypothèses."""
from __future__ import annotations
import numpy as np
import librosa

NOTES = ["Do", "Do#", "Ré", "Mib", "Mi", "Fa", "Fa#", "Sol", "Lab", "La", "Sib", "Si"]
NOTES_EN = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
HOP = 512


def tempo_and_beats(y, sr) -> dict:
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    if env.max() <= 0:
        return {"bpm": None, "confiance": 0.0, "hypotheses": [], "beats_s": [], "mesure": None}
    tempo, beats = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=HOP)
    bpm = float(np.atleast_1d(tempo)[0])
    # Force relative des candidats (octaves de tempo) dans le tempogramme
    tg = librosa.feature.tempogram(onset_envelope=env, sr=sr, hop_length=HOP).mean(axis=1)
    freqs = librosa.tempo_frequencies(len(tg), sr=sr, hop_length=HOP)
    def strength(b):
        if not (30 <= b <= 240):
            return 0.0
        return float(tg[np.argmin(np.abs(freqs[1:] - b)) + 1])
    cands = {round(b, 1): strength(b) for b in (bpm, bpm / 2, bpm * 2) if 30 <= b <= 240}
    tot = sum(cands.values()) or 1.0
    hyp = sorted(({"bpm": b, "confiance": round(s / tot, 2)} for b, s in cands.items()),
                 key=lambda h: -h["confiance"])
    # Régularité des battements → confiance
    bt = librosa.frames_to_time(beats, sr=sr, hop_length=HOP)
    reg = 0.0
    if len(bt) > 3:
        ibi = np.diff(bt)
        reg = float(np.clip(1 - np.std(ibi) / np.mean(ibi) * 4, 0, 1))
    conf = round(reg * next(h["confiance"] for h in hyp if h["bpm"] == round(bpm, 1)) ** 0.5, 2) if hyp else 0.0

    return {"bpm": round(bpm, 1), "confiance": conf, "hypotheses": hyp,
            "beats_s": [round(float(t), 3) for t in bt],
            "mesure": _meter(env, beats)}


def _meter(env, beats) -> dict | None:
    """Hypothèse binaire/ternaire par autocorrélation des accents sur les temps.
    Estimation fragile : toujours renvoyée avec les deux hypothèses."""
    if len(beats) < 16:
        return None
    acc = env[np.clip(beats, 0, len(env) - 1)]
    acc = acc - acc.mean()
    def ac(l):
        return float(np.dot(acc[:-l], acc[l:]) / (np.dot(acc, acc) + 1e-9))
    s = {"4/4": max(ac(4), ac(2)), "3/4": ac(3)}
    e = {k: np.exp(4 * v) for k, v in s.items()}
    tot = sum(e.values())
    hyp = sorted(({"mesure": k, "confiance": round(v / tot, 2)} for k, v in e.items()),
                 key=lambda h: -h["confiance"])
    return {"valeur": hyp[0]["mesure"], "confiance": hyp[0]["confiance"], "hypotheses": hyp,
            "note": "6/8 et 12/8 ne sont pas distingués à ce stade ; à confirmer par l'utilisateur."}


def chroma(y, sr):
    yh = librosa.effects.harmonic(y)
    return librosa.feature.chroma_cqt(y=yh, sr=sr, hop_length=HOP)


def key(ch) -> dict:
    """Krumhansl-Schmuckler : corrélation du chroma moyen avec 24 profils."""
    v = ch.mean(axis=1)
    scores = []
    for i in range(12):
        for mode, prof in (("majeur", _MAJ), ("mineur", _MIN)):
            r = float(np.corrcoef(v, np.roll(prof, i))[0, 1])
            scores.append((r, i, mode))
    scores.sort(reverse=True)
    e = np.exp(np.array([s[0] for s in scores]) * 10)
    p = e / e.sum()
    hyp = [{"tonalite": f"{NOTES[i]} {m}", "tonique": NOTES_EN[i], "mode": m,
            "confiance": round(float(p[k]), 2)} for k, (r, i, m) in enumerate(scores[:3])]
    return {**hyp[0], "hypotheses": hyp}


def _templates():
    names, T = [], []
    for i in range(12):
        for suf, iv in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            t = np.zeros(12); t[[(i + k) % 12 for k in iv]] = 1
            names.append(NOTES_EN[i] + suf); T.append(t / np.linalg.norm(t))
    return names, np.array(T)


def chords(ch, sr, beats_s, duration) -> list[dict]:
    """Accords majeurs/mineurs par gabarits sur chroma synchronisé aux temps.
    Limite assumée : pas de 7e, sus, ni renversements à ce stade."""
    names, T = _templates()
    bounds = np.array(beats_s) if len(beats_s) >= 4 else np.arange(0, duration, 0.5)
    bounds = np.unique(np.concatenate([[0.0], bounds, [duration]]))
    fr = librosa.time_to_frames(bounds, sr=sr, hop_length=HOP)
    out = []
    for a, b, t0, t1 in zip(fr[:-1], fr[1:], bounds[:-1], bounds[1:]):
        if b <= a:
            continue
        v = ch[:, a:b].mean(axis=1)
        n = np.linalg.norm(v)
        if n < 1e-6:
            continue
        sim = T @ (v / n)
        k = np.argsort(sim)[::-1]
        conf = float(np.clip((sim[k[0]] - 0.5) * 2, 0, 1) * np.clip((sim[k[0]] - sim[k[1]]) * 8 + 0.5, 0, 1))
        name = names[k[0]]
        if out and out[-1]["accord"] == name:
            w0 = out[-1]["fin_s"] - out[-1]["debut_s"]; w1 = t1 - t0
            out[-1]["confiance"] = round((out[-1]["confiance"] * w0 + conf * w1) / (w0 + w1), 2)
            out[-1]["fin_s"] = round(float(t1), 3)
        else:
            out.append({"accord": name, "alternative": names[k[1]], "debut_s": round(float(t0), 3),
                        "fin_s": round(float(t1), 3), "confiance": round(conf, 2)})
    return out
