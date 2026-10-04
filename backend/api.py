"""API FastAPI : import, analyse asynchrone avec progression, correction
manuelle des notes, exports. Les tâches tournent dans un pool de threads en
mémoire ; en production, remplacer par Celery + PostgreSQL + stockage S3."""
from __future__ import annotations
import json, os, shutil, time, uuid
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, HTTPException, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from choir_core import analyze, AnalysisError
from choir_core.export import to_midi, to_musicxml, ExportError
from choir_core.melody import note_name
from choir_core.prepare import AUDIO_EXT, VIDEO_EXT

DATA = os.environ.get("CHOIR_DATA", "./data")
MAX_MB = int(os.environ.get("CHOIR_MAX_MB", "100"))  # limite configurable (§3.B)
app = FastAPI(title="CHOIR AI STUDIO — cœur audio")
pool = ThreadPoolExecutor(max_workers=2)
jobs: dict[str, dict] = {}


def _dir(pid):
    return os.path.join(DATA, pid)


def _run(pid, src):
    j = jobs[pid]
    def prog(p, m):
        j.update(progression=p, etape=m)
    try:
        r = analyze(src, os.path.join(_dir(pid), "travail.wav"), prog)
        with open(os.path.join(_dir(pid), "analyse.json"), "w", encoding="utf-8") as f:
            json.dump(r, f, ensure_ascii=False)
        j.update(statut="terminee", progression=100)
    except AnalysisError as e:
        j.update(statut="echec", erreur=str(e))
    except Exception as e:  # erreur inattendue : expliquée, jamais masquée
        j.update(statut="echec", erreur=f"Erreur interne : {type(e).__name__}: {e}")


def _load(pid):
    p = os.path.join(_dir(pid), "analyse.json")
    if pid not in jobs and not os.path.exists(p):
        raise HTTPException(404, "Projet inconnu.")
    if not os.path.exists(p):
        j = jobs[pid]
        raise HTTPException(409, j.get("erreur") or "Analyse en cours.")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _save(pid, r):
    with open(os.path.join(_dir(pid), "analyse.json"), "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False)


@app.post("/projets", status_code=202)
async def creer(fichier: UploadFile, titre: str = Form("")):
    ext = os.path.splitext(fichier.filename or "")[1].lower()
    if ext not in AUDIO_EXT | VIDEO_EXT:
        raise HTTPException(415, f"Format non pris en charge : {ext or 'inconnu'}")
    pid = uuid.uuid4().hex[:12]
    os.makedirs(_dir(pid))
    src = os.path.join(_dir(pid), "original" + ext)
    size = 0
    with open(src, "wb") as f:
        while chunk := await fichier.read(1 << 20):
            size += len(chunk)
            if size > MAX_MB << 20:
                f.close(); shutil.rmtree(_dir(pid))
                raise HTTPException(413, f"Fichier trop volumineux (limite {MAX_MB} Mo).")
            f.write(chunk)
    nom = fichier.filename or "enregistrement"
    with open(os.path.join(_dir(pid), "meta.json"), "w", encoding="utf-8") as f:
        json.dump({"id": pid, "titre": titre.strip() or os.path.splitext(nom)[0],
                   "fichier": nom, "cree_le": time.time()}, f, ensure_ascii=False)
    jobs[pid] = {"statut": "en_cours", "progression": 0, "etape": "En file d'attente"}
    pool.submit(_run, pid, src)
    return {"id": pid}


def _statut(pid):
    if pid in jobs:
        return jobs[pid]
    if os.path.exists(os.path.join(_dir(pid), "analyse.json")):
        return {"statut": "terminee", "progression": 100}
    if os.path.isdir(_dir(pid)):
        return {"statut": "echec", "erreur": "Analyse interrompue par un redémarrage du serveur. Réimportez le fichier."}
    raise HTTPException(404, "Projet inconnu.")


@app.get("/projets")
def lister():
    out = []
    if not os.path.isdir(DATA):
        return out
    for pid in os.listdir(DATA):
        mp = os.path.join(_dir(pid), "meta.json")
        if not os.path.exists(mp):
            continue
        with open(mp, encoding="utf-8") as f:
            m = json.load(f)
        m["statut"] = _statut(pid)
        ap = os.path.join(_dir(pid), "analyse.json")
        if os.path.exists(ap):
            with open(ap, encoding="utf-8") as f:
                r = json.load(f)
            c = _choix(r)
            m["resume"] = {"tonalite": c["tonalite"], "bpm": c["bpm"],
                           "duree_s": r["audio"]["duree_s"], "notes": len(r["melodie"]["notes"])}
        out.append(m)
    return sorted(out, key=lambda m: -m["cree_le"])


@app.get("/projets/{pid}/audio")
def audio(pid: str):
    p = os.path.join(_dir(pid), "travail.wav")
    if not os.path.exists(p):
        raise HTTPException(404, "Audio indisponible.")
    return FileResponse(p, media_type="audio/wav")


@app.get("/projets/{pid}/statut")
def statut(pid: str):
    return _statut(pid)


def _choix(r):
    """Valeurs retenues : celles choisies par l'utilisateur, sinon la 1re hypothèse."""
    c = r.get("choix") or {}
    k = r["tonalite"]
    return {"bpm": c.get("bpm") or r["tempo"]["bpm"],
            "tonalite": c.get("tonalite") or k["tonalite"],
            "tonique": c.get("tonique") or k["tonique"],
            "mode": c.get("mode") or k["mode"],
            "mesure": c.get("mesure") or (r.get("mesure") or {}).get("valeur") or "4/4"}


@app.get("/projets/{pid}/analyse")
def analyse(pid: str):
    r = _load(pid)
    with open(os.path.join(_dir(pid), "meta.json"), encoding="utf-8") as f:
        r["meta"] = json.load(f)
    r["choix"] = _choix(r)
    return r


class Choix(BaseModel):
    bpm: float | None = Field(None, ge=30, le=300)
    tonalite_index: int | None = Field(None, ge=0, le=2)
    mesure: str | None = Field(None, pattern=r"^(2/4|3/4|4/4|6/8|12/8)$")


@app.patch("/projets/{pid}/choix")
def choisir(pid: str, c: Choix):
    r = _load(pid)
    ch = r.get("choix") or {}
    if c.bpm:
        ch["bpm"] = c.bpm
    if c.mesure:
        ch["mesure"] = c.mesure
    if c.tonalite_index is not None:
        h = r["tonalite"]["hypotheses"][c.tonalite_index]
        ch.update(tonalite=h["tonalite"], tonique=h["tonique"], mode=h["mode"])
    r["choix"] = ch
    _save(pid, r)
    return _choix(r)


class NoteIn(BaseModel):
    midi: int = Field(ge=21, le=108)
    debut_s: float = Field(ge=0)
    duree_s: float = Field(gt=0)


class NotePatch(BaseModel):
    midi: int | None = Field(None, ge=21, le=108)
    debut_s: float | None = Field(None, ge=0)
    duree_s: float | None = Field(None, gt=0)


def _finish(pid, r):
    ns = sorted(r["melodie"]["notes"], key=lambda n: n["debut_s"])
    r["melodie"]["notes"] = ns
    _save(pid, r)
    return ns


class NoteFull(NoteIn):
    confiance: float = Field(1.0, ge=0, le=1)
    source: str | None = None


@app.put("/projets/{pid}/notes")
def remplacer_notes(pid: str, notes: list[NoteFull]):
    """Enregistre l'état complet de l'éditeur (déplacements, ajouts, annulations)."""
    r = _load(pid)
    ns = sorted(notes, key=lambda n: n.debut_s)
    r["melodie"]["notes"] = [
        {"id": i, "midi": n.midi, "nom": note_name(n.midi), "debut_s": round(n.debut_s, 3),
         "duree_s": round(n.duree_s, 3), "confiance": n.confiance,
         **({"source": n.source} if n.source else {})} for i, n in enumerate(ns)]
    _save(pid, r)
    return r["melodie"]["notes"]


@app.post("/projets/{pid}/notes", status_code=201)
def ajouter_note(pid: str, n: NoteIn):
    r = _load(pid)
    nid = max((x["id"] for x in r["melodie"]["notes"]), default=-1) + 1
    r["melodie"]["notes"].append({**n.model_dump(), "id": nid, "nom": note_name(n.midi),
                                  "confiance": 1.0, "source": "manuelle"})
    _finish(pid, r)
    return {"id": nid}


@app.patch("/projets/{pid}/notes/{nid}")
def corriger_note(pid: str, nid: int, patch: NotePatch):
    r = _load(pid)
    for x in r["melodie"]["notes"]:
        if x["id"] == nid:
            x.update(patch.model_dump(exclude_none=True))
            x.update(nom=note_name(x["midi"]), confiance=1.0, source="corrigee")
            _finish(pid, r)
            return x
    raise HTTPException(404, "Note inconnue.")


@app.delete("/projets/{pid}/notes/{nid}", status_code=204)
def supprimer_note(pid: str, nid: int):
    r = _load(pid)
    ns = r["melodie"]["notes"]
    if not any(x["id"] == nid for x in ns):
        raise HTTPException(404, "Note inconnue.")
    r["melodie"]["notes"] = [x for x in ns if x["id"] != nid]
    _finish(pid, r)


@app.get("/projets/{pid}/export/{fmt}")
def exporter(pid: str, fmt: str, bpm: float | None = None):
    r = _load(pid)
    c = _choix(r)
    tempo = bpm or c["bpm"]
    try:
        if fmt == "midi":
            p = to_midi(r["melodie"]["notes"], tempo, os.path.join(_dir(pid), "melodie.mid"))
            return FileResponse(p, media_type="audio/midi", filename="melodie.mid")
        if fmt == "musicxml":
            p = to_musicxml(r["melodie"]["notes"], tempo, os.path.join(_dir(pid), "melodie.musicxml"),
                            title=_titre(pid), tonic=c["tonique"], mode=c["mode"], time_sig=c["mesure"])
            return FileResponse(p, media_type="application/vnd.recordare.musicxml+xml",
                                filename="melodie.musicxml")
    except ExportError as e:
        raise HTTPException(422, str(e))
    raise HTTPException(400, "Format d'export inconnu (midi ou musicxml).")


def _titre(pid):
    with open(os.path.join(_dir(pid), "meta.json"), encoding="utf-8") as f:
        return json.load(f)["titre"]


@app.delete("/projets/{pid}", status_code=204)
def supprimer(pid: str):
    if not os.path.isdir(_dir(pid)):
        raise HTTPException(404, "Projet inconnu.")
    shutil.rmtree(_dir(pid)); jobs.pop(pid, None)
