import os, hashlib, pytest
import pretty_midi
from music21 import converter
from choir_core import analyze, AnalysisError
from choir_core.export import to_midi, to_musicxml, ExportError


@pytest.fixture(scope="module")
def scale_result(scale_wav):
    return analyze(scale_wav[0])


def test_melodie_gamme(scale_result, scale_wav):
    notes = scale_result["melodie"]["notes"]
    got = [n["midi"] for n in notes]
    # les deux Do aigus consécutifs peuvent être fusionnés ou non
    seq = scale_wav[1]
    assert got in (seq, seq[:8] + seq[9:]), got
    assert scale_result["melodie"]["confiance"] > 0.6
    assert abs(notes[1]["debut_s"] - 0.5) < 0.06


def test_tonalite(scale_result):
    k = scale_result["tonalite"]
    assert k["tonalite"] == "Do majeur"
    assert len(k["hypotheses"]) == 3 and 0 < k["confiance"] <= 1


def test_tempo(scale_result):
    hyp = [h["bpm"] for h in scale_result["tempo"]["hypotheses"]]
    assert any(abs(b - 120) < 4 for b in hyp), hyp


def test_accords(chords_wav):
    r = analyze(chords_wav)
    seq = [c["accord"] for c in r["accords"] if c["fin_s"] - c["debut_s"] > 1.0]
    assert seq == ["C", "F", "G", "C", "C", "F", "G", "C"] or seq == ["C", "F", "G", "C", "F", "G", "C"], seq
    assert r["tonalite"]["tonalite"] == "Do majeur"


def test_original_intact_et_copie(scale_wav, tmp_path):
    h = hashlib.md5(open(scale_wav[0], "rb").read()).hexdigest()
    analyze(scale_wav[0], str(tmp_path / "w.wav"))
    assert hashlib.md5(open(scale_wav[0], "rb").read()).hexdigest() == h
    assert os.path.getsize(tmp_path / "w.wav") > 1000


def test_silence_refuse(silence_wav):
    with pytest.raises(AnalysisError, match="silencieux"):
        analyze(silence_wav)


def test_format_refuse(tmp_path):
    p = tmp_path / "x.txt"; p.write_text("non")
    with pytest.raises(AnalysisError, match="Format"):
        analyze(str(p))


def test_exports(scale_result, tmp_path):
    notes, bpm = scale_result["melodie"]["notes"], 120
    mid = to_midi(notes, bpm, str(tmp_path / "m.mid"))
    assert [n.pitch for n in pretty_midi.PrettyMIDI(mid).instruments[0].notes] == [n["midi"] for n in notes]
    xml = to_musicxml(notes, bpm, str(tmp_path / "m.musicxml"), tonic="C", mode="majeur")
    sc = converter.parse(xml)
    ns = [n for n in sc.flatten().notes if not (n.tie and n.tie.type != 'start')]
    assert [n.pitch.midi for n in ns] == [n["midi"] for n in notes]
    assert len(sc.parts[0].getElementsByClass("Measure")) >= 4


def test_pas_de_partition_vide(tmp_path):
    with pytest.raises(ExportError):
        to_musicxml([], 120, str(tmp_path / "v.musicxml"))
    with pytest.raises(ExportError):
        to_midi([], 120, str(tmp_path / "v.mid"))
