import os, time, pytest


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    os.environ["CHOIR_DATA"] = str(tmp_path_factory.mktemp("data"))
    from fastapi.testclient import TestClient
    import api
    return TestClient(api.app)


def _wait(client, pid):
    for _ in range(300):
        s = client.get(f"/projets/{pid}/statut").json()
        if s["statut"] != "en_cours":
            return s
        time.sleep(0.2)
    raise AssertionError("délai dépassé")


def test_parcours_complet(client, scale_wav):
    with open(scale_wav[0], "rb") as f:
        r = client.post("/projets", files={"fichier": ("gamme.wav", f, "audio/wav")})
    assert r.status_code == 202
    pid = r.json()["id"]
    assert _wait(client, pid)["statut"] == "terminee"
    a = client.get(f"/projets/{pid}/analyse").json()
    assert a["tonalite"]["tonalite"] == "Do majeur"
    nid = a["melodie"]["notes"][0]["id"]
    # correction manuelle : Do4 → Ré4
    p = client.patch(f"/projets/{pid}/notes/{nid}", json={"midi": 62}).json()
    assert p["nom"] == "D4" and p["source"] == "corrigee"
    assert client.post(f"/projets/{pid}/notes", json={"midi": 64, "debut_s": 9.0, "duree_s": 0.5}).status_code == 201
    assert client.delete(f"/projets/{pid}/notes/{a['melodie']['notes'][1]['id']}").status_code == 204
    n2 = client.get(f"/projets/{pid}/analyse").json()["melodie"]["notes"]
    assert n2[0]["midi"] == 62 and len(n2) == len(a["melodie"]["notes"])
    for fmt in ("midi", "musicxml"):
        e = client.get(f"/projets/{pid}/export/{fmt}", params={"bpm": 120})
        assert e.status_code == 200 and len(e.content) > 100
    assert client.delete(f"/projets/{pid}").status_code == 204
    assert client.get(f"/projets/{pid}/analyse").status_code == 404


def test_silence_explique(client, silence_wav):
    with open(silence_wav, "rb") as f:
        pid = client.post("/projets", files={"fichier": ("s.wav", f, "audio/wav")}).json()["id"]
    s = _wait(client, pid)
    assert s["statut"] == "echec" and "silencieux" in s["erreur"]
    assert client.get(f"/projets/{pid}/export/midi").status_code == 409


def test_format_refuse(client):
    r = client.post("/projets", files={"fichier": ("x.exe", b"abc", "application/octet-stream")})
    assert r.status_code == 415


def test_liste_choix_et_remplacement(client, scale_wav):
    with open(scale_wav[0], "rb") as f:
        pid = client.post("/projets", files={"fichier": ("gamme.wav", f, "audio/wav")},
                          data={"titre": "Ma gamme"}).json()["id"]
    assert _wait(client, pid)["statut"] == "terminee"
    l = [p for p in client.get("/projets").json() if p["id"] == pid][0]
    assert l["titre"] == "Ma gamme" and l["resume"]["notes"] == 16
    assert client.get(f"/projets/{pid}/audio").status_code == 200
    c = client.patch(f"/projets/{pid}/choix", json={"bpm": 120, "tonalite_index": 1, "mesure": "3/4"}).json()
    assert c["bpm"] == 120 and c["mesure"] == "3/4"
    a = client.get(f"/projets/{pid}/analyse").json()
    assert a["choix"]["tonalite"] == a["tonalite"]["hypotheses"][1]["tonalite"]
    r = client.put(f"/projets/{pid}/notes", json=[{"midi": 67, "debut_s": 1, "duree_s": 0.5, "source": "manuelle"},
                                                   {"midi": 60, "debut_s": 0, "duree_s": 0.5}])
    assert [n["nom"] for n in r.json()] == ["C4", "G4"]
    assert b"<beats>3</beats>" in client.get(f"/projets/{pid}/export/musicxml").content
    assert client.put(f"/projets/{pid}/notes", json=[{"midi": 300, "debut_s": 0, "duree_s": 1}]).status_code == 422
