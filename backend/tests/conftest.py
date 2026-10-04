import os, sys
import numpy as np, soundfile as sf, pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
SR = 44100


def tone(midi, dur, sr=SR):
    """Son harmonique (5 partiels) avec enveloppe, proche d'une voix tenue."""
    f = 440 * 2 ** ((midi - 69) / 12)
    t = np.arange(int(dur * sr)) / sr
    y = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 6))
    env = np.minimum(1, np.minimum(t / 0.02, (dur - t) / 0.03))
    return y * env


@pytest.fixture(scope="session")
def scale_wav(tmp_path_factory):
    """Gamme de Do majeur montante puis descendante, noires à 120 BPM."""
    seq = [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60]
    y = np.concatenate([tone(m, 0.5) for m in seq]) * 0.3
    p = tmp_path_factory.mktemp("a") / "gamme.wav"
    sf.write(p, y, SR)
    return str(p), seq


@pytest.fixture(scope="session")
def chords_wav(tmp_path_factory):
    """C – F – G – C, une mesure chacun à 100 BPM, accords plaqués sur chaque temps."""
    prog = [(48, 52, 55), (53, 57, 60), (55, 59, 62), (48, 52, 55)] * 2
    beat = 0.6
    y = np.concatenate([sum(tone(m, beat) for m in c) for c in prog for _ in range(4)]) * 0.15
    p = tmp_path_factory.mktemp("c") / "accords.wav"
    sf.write(p, y, SR)
    return str(p)


@pytest.fixture(scope="session")
def silence_wav(tmp_path_factory):
    p = tmp_path_factory.mktemp("s") / "silence.wav"
    sf.write(p, np.zeros(SR * 2), SR)
    return str(p)
