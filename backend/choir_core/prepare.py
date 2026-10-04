"""Préparation de l'audio (§3.C). Le fichier original n'est jamais modifié :
on le décode en mémoire et on écrit une copie de travail WAV séparée."""
from __future__ import annotations
import subprocess, tempfile, os
import numpy as np
import soundfile as sf
import librosa

WORK_SR = 22050
VIDEO_EXT = {".mp4", ".mov"}
AUDIO_EXT = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".webm"}


class AudioError(Exception):
    pass


def _decode(path: str):
    """Décode vers mono float32 à la fréquence d'origine. ffmpeg pour tout ce
    que libsndfile ne lit pas (m4a, aac, vidéo)."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in AUDIO_EXT | VIDEO_EXT:
        raise AudioError(f"Format non pris en charge : {ext or 'inconnu'}")
    try:
        if ext in VIDEO_EXT | {".m4a", ".aac", ".webm"}:
            raise RuntimeError
        y, sr = sf.read(path, dtype="float32", always_2d=True)
    except Exception:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
            tmp = t.name
        try:
            r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-vn", tmp],
                               capture_output=True, text=True)
            if r.returncode != 0:
                raise AudioError("Fichier illisible ou sans piste audio : " + r.stderr.strip()[:200])
            y, sr = sf.read(tmp, dtype="float32", always_2d=True)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    return y.mean(axis=1), sr


def prepare(path: str, work_path: str | None = None) -> dict:
    y, sr = _decode(path)
    if len(y) < sr // 2:
        raise AudioError("Enregistrement trop court (moins de 0,5 s).")
    peak = float(np.max(np.abs(y)))
    if peak < 1e-4:
        raise AudioError("L'enregistrement est silencieux : aucun signal exploitable.")

    clipped = float(np.mean(np.abs(y) >= 0.999))
    # Coupures : suites de zéros numériques exacts (≥ 50 ms) au milieu du signal
    z = (y == 0).astype(int)
    edges = np.diff(np.concatenate([[0], z, [0]]))
    runs = np.where(edges == -1)[0] - np.where(edges == 1)[0]
    dropouts = int(np.sum(runs >= int(0.05 * sr)))

    yw = librosa.resample(y, orig_sr=sr, target_sr=WORK_SR) if sr != WORK_SR else y
    yw = yw / np.max(np.abs(yw)) * 0.95  # normalisation crête

    intervals = librosa.effects.split(yw, top_db=40)
    active = sum(int(e - s) for s, e in intervals)
    rms = librosa.feature.rms(y=yw)[0]
    rms_db = 20 * np.log10(np.maximum(rms, 1e-6))
    snr = float(np.percentile(rms_db, 95) - np.percentile(rms_db, 5))

    warnings = []
    if clipped > 0.001:
        warnings.append(f"Saturation détectée sur {clipped:.2%} des échantillons.")
    if dropouts:
        warnings.append(f"{dropouts} coupure(s) du signal détectée(s).")
    if snr < 15:
        warnings.append("Faible dynamique signal/bruit : résultats moins fiables.")
    if sr < 16000:
        warnings.append(f"Fréquence d'échantillonnage basse ({sr} Hz).")
    quality = "bonne" if not warnings else ("moyenne" if len(warnings) == 1 else "faible")

    if work_path:
        sf.write(work_path, yw, WORK_SR, subtype="PCM_16")
    return {
        "y": yw, "sr": WORK_SR,
        "report": {
            "duree_s": round(len(y) / sr, 2),
            "frequence_origine_hz": int(sr),
            "frequence_travail_hz": WORK_SR,
            "part_silence": round(1 - active / len(yw), 3),
            "dynamique_db": round(snr, 1),
            "saturation": round(clipped, 5),
            "coupures": dropouts,
            "qualite": quality,
            "avertissements": warnings,
        },
    }
