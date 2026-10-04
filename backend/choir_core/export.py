"""Exports MIDI et MusicXML (§9.B). Refuse de produire une partition vide."""
from __future__ import annotations
import pretty_midi
from music21 import stream, note, tempo as m21tempo, meter, key as m21key, metadata, clef


class ExportError(Exception):
    pass


def _check(notes):
    if not notes:
        raise ExportError("Aucune note détectée : pas de partition générée (pas de partition vide).")


def to_midi(notes, bpm, path):
    _check(notes)
    pm = pretty_midi.PrettyMIDI(initial_tempo=float(bpm or 120))
    inst = pretty_midi.Instrument(program=52, name="Melodie")  # Choir Aahs
    for n in notes:
        inst.notes.append(pretty_midi.Note(velocity=90, pitch=int(n["midi"]),
                                           start=float(n["debut_s"]),
                                           end=float(n["debut_s"] + n["duree_s"])))
    pm.instruments.append(inst)
    pm.write(path)
    return path


def quantize(notes, bpm, grid=0.25):
    """Secondes → noires, arrondies à la double croche. Renvoie [(offset, durée, midi)]."""
    spq = 60.0 / float(bpm)
    t0 = min(n["debut_s"] for n in notes)
    ev = []
    for n in sorted(notes, key=lambda n: n["debut_s"]):
        off = round((n["debut_s"] - t0) / spq / grid) * grid
        dur = max(grid, round(n["duree_s"] / spq / grid) * grid)
        if ev and off < ev[-1][0] + grid:      # deux notes sur la même case
            off = ev[-1][0] + grid
        if ev and ev[-1][0] + ev[-1][1] > off:  # pas de chevauchement
            ev[-1] = (ev[-1][0], off - ev[-1][0], ev[-1][2])
        ev.append((off, dur, int(n["midi"])))
    return ev


def to_musicxml(notes, bpm, path, title="Mélodie", tonic=None, mode=None, time_sig="4/4"):
    _check(notes)
    if not bpm:
        raise ExportError("Tempo inconnu : impossible de placer les notes en mesures. "
                          "Indiquez un tempo manuellement.")
    ev = quantize(notes, bpm)
    p = stream.Part(); p.partName = "Mélodie"
    mean = sum(e[2] for e in ev) / len(ev)
    p.insert(0, clef.BassClef() if mean < 55 else clef.TrebleClef())
    if tonic:
        p.insert(0, m21key.Key(tonic.replace("b", "-"), "minor" if mode == "mineur" else "major"))
    p.insert(0, meter.TimeSignature(time_sig or "4/4"))
    p.insert(0, m21tempo.MetronomeMark(number=round(float(bpm))))
    for off, dur, m in ev:
        nt = note.Note(m); nt.quarterLength = dur
        p.insert(off, nt)
    p.makeRests(fillGaps=True, inPlace=True)
    sc = stream.Score(); sc.metadata = metadata.Metadata(title=title)
    sc.insert(0, p)
    sc.write("musicxml", fp=path)
    return path
