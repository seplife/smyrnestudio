import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { buildApp } from "../src/app.js";
import { scaleWav, silenceWav, tmp } from "./helpers.js";

let app, base;
before(async () => {
  app = await buildApp({ dataDir: path.join(tmp, "data"), maxMb: 2 });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${app.server.address().port}/api`;
});
after(() => app.close());

const j = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function upload(file, nom, titre) {
  const f = new FormData();
  f.append("fichier", new Blob([typeof file === "string" ? readFileSync(file) : file]), nom);
  if (titre) f.append("titre", titre); // après le fichier, comme le fait l'interface
  return fetch(`${base}/projets`, { method: "POST", body: f });
}
async function wait(pid) {
  for (let i = 0; i < 300; i++) {
    const s = await (await fetch(`${base}/projets/${pid}/statut`)).json();
    if (s.statut !== "en_cours") return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("délai dépassé");
}

test("parcours complet : import, analyse, corrections, choix, exports, suppression", async () => {
  const r = await upload(scaleWav(), "gamme.wav", "Ma gamme");
  assert.equal(r.status, 202);
  const { id } = await r.json(), p = `${base}/projets/${id}`;
  assert.equal((await wait(id)).statut, "terminee");

  const a = await (await fetch(`${p}/analyse`)).json();
  assert.equal(a.tonalite.tonalite, "Do majeur");
  assert.equal(a.meta.titre, "Ma gamme");
  const liste = await (await fetch(`${base}/projets`)).json();
  assert.equal(liste.find((x) => x.id === id).resume.notes, 16);
  assert.equal((await fetch(`${p}/audio`)).headers.get("content-type"), "audio/wav");

  // corrections note par note : Do4 → Ré4, ajout, suppression
  const n0 = a.melodie.notes[0].id;
  const c = await (await fetch(`${p}/notes/${n0}`, j("PATCH", { midi: 62 }))).json();
  assert.deepEqual([c.nom, c.source], ["D4", "corrigee"]);
  assert.equal((await fetch(`${p}/notes`, j("POST", { midi: 64, debut_s: 9, duree_s: 0.5 }))).status, 201);
  assert.equal((await fetch(`${p}/notes/${a.melodie.notes[1].id}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${p}/notes/9999`, { method: "DELETE" })).status, 404);

  // choix de l'utilisateur repris à l'export
  const ch = await (await fetch(`${p}/choix`, j("PATCH", { bpm: 120, tonalite_index: 1, mesure: "3/4" }))).json();
  assert.deepEqual([ch.bpm, ch.mesure, ch.tonalite], [120, "3/4", a.tonalite.hypotheses[1].tonalite]);
  const xml = await (await fetch(`${p}/export/musicxml`)).text();
  assert.match(xml, /<beats>3<\/beats>/);
  assert.match(xml, /<work-title>Ma gamme</);
  const mid = Buffer.from(await (await fetch(`${p}/export/midi`)).arrayBuffer());
  assert.equal(mid.subarray(0, 4).toString(), "MThd");

  // remplacement complet (éditeur) et validation
  const put = await (await fetch(`${p}/notes`, j("PUT", [{ midi: 67, debut_s: 1, duree_s: 0.5, source: "manuelle" }, { midi: 60, debut_s: 0, duree_s: 0.5 }]))).json();
  assert.deepEqual(put.map((n) => n.nom), ["C4", "G4"]);
  const bad = await fetch(`${p}/notes`, j("PUT", [{ midi: 300, debut_s: 0, duree_s: 1 }]));
  assert.equal(bad.status, 422);
  assert.equal(typeof (await bad.json()).detail, "string");
  assert.equal((await fetch(`${p}/choix`, j("PATCH", { mesure: "5/4" }))).status, 422);
  assert.equal((await fetch(`${p}/export/pdf`)).status, 400);

  assert.equal((await fetch(p, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${p}/analyse`)).status, 404);
});

test("un silence échoue avec un message, et rien n'est exportable", async () => {
  const { id } = await (await upload(silenceWav(), "s.wav")).json();
  const s = await wait(id);
  assert.equal(s.statut, "echec");
  assert.match(s.erreur, /silencieux/);
  assert.equal((await fetch(`${base}/projets/${id}/export/midi`)).status, 409);
});

test("formats, taille et identifiants invalides sont refusés", async () => {
  assert.equal((await upload(Buffer.from("abc"), "x.exe")).status, 415);
  const gros = await upload(Buffer.alloc(3 * 1024 * 1024), "gros.wav");
  assert.equal(gros.status, 413);
  assert.match((await gros.json()).detail, /2 Mo/);
  assert.equal((await fetch(`${base}/projets/..%2F..%2Fetc/statut`)).status, 404);
  assert.equal((await fetch(`${base}/projets/abcdefabcdef/statut`)).status, 404);
});
