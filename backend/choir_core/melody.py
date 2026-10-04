"""Extraction de la mélodie (§4.B) par pYIN (suivi probabiliste de F0).

Limite assumée : pYIN suit UNE voix. Il est fiable sur une voix seule, un
fredonnement ou un instrument mélodique ; sur un mixage complet il faut d'abord
isoler la voix (Demucs, phase 3). Il ne transcrit pas un chœur polyphonique."""
from __future__ import annotations
import numpy as np
import librosa
from scipy.ndimage import median_filter

HOP = 256
MIN_NOTE_S = 0.09


def note_name(midi: int) -> str:
    return librosa.midi_to_note(int(midi), unicode=False)


def extract(y, sr) -> dict:
    f0, voiced, prob = librosa.pyin(y, fmin=librosa.note_to_hz("E2"), fmax=librosa.note_to_hz("C6"),
                                    sr=sr, hop_length=HOP, frame_length=2048)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP)
    midi_f = np.where(voiced, librosa.hz_to_midi(np.where(voiced, f0, 440.0)), np.nan)
    q = np.where(voiced, np.round(midi_f), -1).astype(int)
    q = median_filter(q, size=7, mode="nearest")
    dt = HOP / sr
    # Attaques (énergie) : servent à séparer deux notes répétées de même hauteur
    on = librosa.onset.onset_detect(y=y, sr=sr, hop_length=HOP, units="frames")
    cut = np.zeros(len(q) + 1, dtype=bool)
    cut[on[on < len(q)]] = True
    guard = int(MIN_NOTE_S / dt)
    notes, i, n = [], 0, len(q)
    while i < n:
        j = i + 1
        while j < n and q[j] == q[i] and not (cut[j] and j - i >= guard
                                              and np.all(q[j:j + guard] == q[i])):
            j += 1
        if q[i] >= 0 and (j - i) * dt >= MIN_NOTE_S:
            seg = midi_f[i:j]; seg = seg[~np.isnan(seg)]
            dev = float(np.std(seg)) if len(seg) else 0.0
            notes.append({
                "midi": int(q[i]), "nom": note_name(q[i]),
                "debut_s": round(float(times[i]), 3), "duree_s": round((j - i) * dt, 3),
                "confiance": round(float(np.nanmean(prob[i:j])), 2),
                "vibrato_probable": bool(dev > 0.25 and (j - i) * dt > 0.4),
            })
        i = j
    # Fusion des fragments d'une même note séparés par un trou < 60 ms
    merged = []
    for nt in notes:
        if merged and merged[-1]["midi"] == nt["midi"] and nt["duree_s"] < 2 * MIN_NOTE_S and \
                nt["debut_s"] - (merged[-1]["debut_s"] + merged[-1]["duree_s"]) < 0.06:
            m = merged[-1]
            m["duree_s"] = round(nt["debut_s"] + nt["duree_s"] - m["debut_s"], 3)
            m["confiance"] = round((m["confiance"] + nt["confiance"]) / 2, 2)
        else:
            merged.append(nt)
    for k, nt in enumerate(merged):
        nt["id"] = k
    voiced_ratio = float(np.mean(voiced))
    conf = round(float(np.mean([n["confiance"] for n in merged])), 2) if merged else 0.0
    out = {"notes": merged, "confiance": conf, "part_voisee": round(voiced_ratio, 2),
           "methode": "pYIN (monophonique)"}
    if merged:
        ms = [n["midi"] for n in merged]
        out["ambitus"] = {"min": note_name(min(ms)), "max": note_name(max(ms))}
    return out
