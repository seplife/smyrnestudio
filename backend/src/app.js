// API Fastify : import, analyse asynchrone avec progression, correction manuelle
// des notes, exports. Stockage sur disque et file de tâches en mémoire ; en
// production, remplacer par PostgreSQL + stockage S3 + file persistante (BullMQ).
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { extOk } from "./audio.js";
import { ExportError, toMidi, toMusicXml } from "./export.js";
import { toPdf } from "./score.js";
import { noteName } from "./melody.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp({
  dataDir = process.env.CHOIR_DATA || "./data",
  maxMb = Number(process.env.CHOIR_MAX_MB || 100), // limite configurable (§3.B)
  concurrency = Number(process.env.CHOIR_WORKERS || 2),
  logger = false,
} = {}) {
  const app = Fastify({ logger });
  await app.register(multipart, { limits: { fileSize: maxMb * 1024 * 1024, files: 1 } });

  const jobs = new Map(), queue = [];
  let running = 0;
  const dir = (pid) => path.join(dataDir, pid);
  const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
  const fail = (code, detail) => Object.assign(new Error(detail), { statusCode: code });

  app.setErrorHandler((err, _req, reply) => {
    if (err.validation) return reply.code(422).send({ detail: `Données invalides : ${err.message}` });
    const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) app.log.error(err);
    reply.code(code).send({ detail: code === 500 ? "Erreur interne du serveur." : err.message });
  });

  function pump() {
    while (running < concurrency && queue.length) {
      const { pid, src } = queue.shift(), job = jobs.get(pid);
      if (!job) continue; // projet supprimé entre-temps
      running++;
      const w = new Worker(path.join(here, "worker.js"), { workerData: { src, work: path.join(dir(pid), "travail.wav") } });
      job.worker = w;
      const done = () => { running--; job.worker = null; pump(); };
      w.on("message", async (m) => {
        if (m.type === "progress") Object.assign(job, { progression: m.progression, etape: m.etape });
        else if (m.type === "error") Object.assign(job, { statut: "echec", erreur: m.message });
        else if (m.type === "done") {
          try {
            if (m.result == null) throw new Error("l'analyse n'a retourné aucun résultat");
            await writeFile(path.join(dir(pid), "analyse.json"), JSON.stringify(m.result));
            Object.assign(job, { statut: "terminee", progression: 100 });
          } catch (e) { Object.assign(job, { statut: "echec", erreur: `Résultat non enregistré : ${e.message}` }); }
        }
      });
      w.on("error", (e) => Object.assign(job, { statut: "echec", erreur: `Erreur interne : ${e.message}` }));
      w.on("exit", done);
    }
  }

  const statutOf = (pid) => {
    const j = jobs.get(pid);
    if (j) { const { worker, ...pub } = j; return pub; }
    if (existsSync(path.join(dir(pid), "analyse.json"))) return { statut: "terminee", progression: 100 };
    if (existsSync(path.join(dir(pid), "meta.json")))
      return { statut: "echec", erreur: "Analyse interrompue par un redémarrage du serveur. Réimportez le fichier." };
    throw fail(404, "Projet inconnu.");
  };
  async function load(pid) {
    const f = path.join(dir(pid), "analyse.json");
    if (!existsSync(f)) {
      const s = statutOf(pid);
      throw fail(409, s.erreur || "Analyse en cours.");
    }
    return readJson(f);
  }
  const save = (pid, r) => writeFile(path.join(dir(pid), "analyse.json"), JSON.stringify(r));
  const meta = (pid) => readJson(path.join(dir(pid), "meta.json"));
  /** Valeurs retenues : celles choisies par l'utilisateur, sinon la première hypothèse. */
  const choix = (r) => {
    const c = r.choix || {}, k = r.tonalite;
    return { bpm: c.bpm || r.tempo.bpm, tonalite: c.tonalite || k.tonalite, tonique: c.tonique || k.tonique,
      mode: c.mode || k.mode, mesure: c.mesure || r.mesure?.valeur || "4/4" };
  };
  const sortNotes = (r) => r.melodie.notes.sort((a, b) => a.debut_s - b.debut_s);

  const idParam = { type: "object", properties: { pid: { type: "string", pattern: "^[a-f0-9]{12}$" }, nid: { type: "integer" } } };
  const noteProps = { midi: { type: "integer", minimum: 21, maximum: 108 }, debut_s: { type: "number", minimum: 0 }, duree_s: { type: "number", exclusiveMinimum: 0 } };
  const noteIn = { type: "object", required: ["midi", "debut_s", "duree_s"], properties: noteProps };

  await app.register(async (api) => {
    api.addHook("preValidation", async (req) => { if (req.params?.pid && !/^[a-f0-9]{12}$/.test(req.params.pid)) throw fail(404, "Projet inconnu."); });

    api.get("/projets", async () => {
      if (!existsSync(dataDir)) return [];
      const out = [];
      for (const pid of await readdir(dataDir)) {
        if (!existsSync(path.join(dir(pid), "meta.json"))) continue;
        const m = await meta(pid);
        m.statut = statutOf(pid);
        if (existsSync(path.join(dir(pid), "analyse.json"))) {
          const r = await load(pid), c = choix(r);
          m.resume = { tonalite: c.tonalite, bpm: c.bpm, duree_s: r.audio.duree_s, notes: r.melodie.notes.length };
        }
        out.push(m);
      }
      return out.sort((a, b) => b.cree_le - a.cree_le);
    });

    api.post("/projets", async (req, reply) => {
      const pid = randomBytes(6).toString("hex");
      let src = null, nom = "", titre = "";
      try {
        for await (const part of req.parts()) {
          if (part.type === "file" && part.fieldname === "fichier") {
            nom = part.filename || "enregistrement";
            const ext = path.extname(nom).toLowerCase();
            if (!extOk(ext)) throw fail(415, `Format non pris en charge : ${ext || "inconnu"}`);
            await mkdir(dir(pid), { recursive: true });
            src = path.join(dir(pid), "original" + ext);
            await pipeline(part.file, createWriteStream(src));
            if (part.file.truncated) throw fail(413, `Fichier trop volumineux (limite ${maxMb} Mo).`);
          } else if (part.type === "field" && part.fieldname === "titre") titre = String(part.value).trim().slice(0, 120);
          else if (part.type === "file") part.file.resume();
        }
        if (!src) throw fail(422, "Aucun fichier reçu (champ « fichier »).");
      } catch (e) {
        await rm(dir(pid), { recursive: true, force: true });
        if (e.code === "FST_REQ_FILE_TOO_LARGE") throw fail(413, `Fichier trop volumineux (limite ${maxMb} Mo).`);
        throw e;
      }
      await writeFile(path.join(dir(pid), "meta.json"),
        JSON.stringify({ id: pid, titre: titre || path.basename(nom, path.extname(nom)), fichier: nom, cree_le: Date.now() / 1000 }));
      jobs.set(pid, { statut: "en_cours", progression: 0, etape: "En file d'attente" });
      queue.push({ pid, src });
      pump();
      return reply.code(202).send({ id: pid });
    });

    api.get("/projets/:pid/statut", async (req) => statutOf(req.params.pid));

    // Relance l'analyse à partir du fichier original déjà importé (ex. après un échec ou un redémarrage)
    api.post("/projets/:pid/reanalyse", async (req, reply) => {
      const pid = req.params.pid;
      if (!/^[0-9a-f]{12}$/.test(pid) || !existsSync(path.join(dir(pid), "meta.json"))) throw fail(404, "Projet inconnu.");
      if (jobs.get(pid)?.statut === "en_cours") throw fail(409, "Analyse déjà en cours.");
      const orig = (await readdir(dir(pid))).find((f) => f.startsWith("original."));
      if (!orig) throw fail(404, "Fichier original introuvable : réimportez le fichier.");
      jobs.set(pid, { statut: "en_cours", progression: 0, etape: "En file d'attente" });
      queue.push({ pid, src: path.join(dir(pid), orig) });
      pump();
      return reply.code(202).send({ id: pid });
    });

    api.get("/projets/:pid/analyse", async (req) => {
      const r = await load(req.params.pid);
      return { ...r, meta: await meta(req.params.pid), choix: choix(r) };
    });

    api.get("/projets/:pid/audio", async (req, reply) => {
      const f = path.join(dir(req.params.pid), "travail.wav");
      if (!existsSync(f)) throw fail(404, "Audio indisponible.");
      return reply.type("audio/wav").send(await readFile(f));
    });

    api.patch("/projets/:pid/choix", {
      schema: { body: { type: "object", additionalProperties: false, properties: {
        bpm: { type: "number", minimum: 30, maximum: 300 }, tonalite_index: { type: "integer", minimum: 0, maximum: 2 },
        mesure: { type: "string", enum: ["2/4", "3/4", "4/4", "6/8", "12/8"] } } } },
    }, async (req) => {
      const r = await load(req.params.pid), c = r.choix || {}, b = req.body;
      if (b.bpm) c.bpm = b.bpm;
      if (b.mesure) c.mesure = b.mesure;
      if (b.tonalite_index != null) { const { tonalite, tonique, mode } = r.tonalite.hypotheses[b.tonalite_index]; Object.assign(c, { tonalite, tonique, mode }); }
      r.choix = c;
      await save(req.params.pid, r);
      return choix(r);
    });

    // Enregistre l'état complet de l'éditeur (déplacements, ajouts, annulations)
    api.put("/projets/:pid/notes", {
      schema: { body: { type: "array", maxItems: 20000, items: { ...noteIn,
        properties: { ...noteProps, confiance: { type: "number", minimum: 0, maximum: 1 }, source: { type: ["string", "null"], maxLength: 20 } } } } },
    }, async (req) => {
      const r = await load(req.params.pid);
      r.melodie.notes = [...req.body].sort((a, b) => a.debut_s - b.debut_s).map((n, i) => ({
        id: i, midi: n.midi, nom: noteName(n.midi), debut_s: +n.debut_s.toFixed(3), duree_s: +n.duree_s.toFixed(3),
        confiance: n.confiance ?? 1, ...(n.source ? { source: n.source } : {}) }));
      await save(req.params.pid, r);
      return r.melodie.notes;
    });

    api.post("/projets/:pid/notes", { schema: { body: noteIn } }, async (req, reply) => {
      const r = await load(req.params.pid), { midi, debut_s, duree_s } = req.body;
      const id = Math.max(-1, ...r.melodie.notes.map((n) => n.id)) + 1;
      r.melodie.notes.push({ id, midi, nom: noteName(midi), debut_s, duree_s, confiance: 1, source: "manuelle" });
      sortNotes(r);
      await save(req.params.pid, r);
      return reply.code(201).send({ id });
    });

    api.patch("/projets/:pid/notes/:nid", { schema: { params: idParam, body: { type: "object", additionalProperties: false, properties: noteProps } } }, async (req) => {
      const r = await load(req.params.pid), n = r.melodie.notes.find((x) => x.id === req.params.nid);
      if (!n) throw fail(404, "Note inconnue.");
      Object.assign(n, req.body, { confiance: 1, source: "corrigee" });
      n.nom = noteName(n.midi);
      sortNotes(r);
      await save(req.params.pid, r);
      return n;
    });

    api.delete("/projets/:pid/notes/:nid", { schema: { params: idParam } }, async (req, reply) => {
      const r = await load(req.params.pid), before = r.melodie.notes.length;
      r.melodie.notes = r.melodie.notes.filter((x) => x.id !== req.params.nid);
      if (r.melodie.notes.length === before) throw fail(404, "Note inconnue.");
      await save(req.params.pid, r);
      return reply.code(204).send();
    });

    api.get("/projets/:pid/export/:fmt", {
      schema: { querystring: { type: "object", properties: { bpm: { type: "number", minimum: 30, maximum: 300 } } } },
    }, async (req, reply) => {
      const { pid, fmt } = req.params;
      if (fmt !== "midi" && fmt !== "musicxml" && fmt !== "pdf") throw fail(400, "Format d'export inconnu (midi, musicxml ou pdf).");
      const r = await load(pid), c = choix(r), bpm = req.query.bpm || c.bpm;
      try {
        if (fmt === "midi")
          return reply.type("audio/midi").header("Content-Disposition", 'attachment; filename="melodie.mid"').send(toMidi(r.melodie.notes, bpm, c.mesure));
        if (fmt === "pdf") {
          const pdf = await toPdf(r.melodie.notes, bpm, { title: (await meta(pid)).titre, tonic: c.tonique, mode: c.mode, timeSig: c.mesure, chords: r.accords || [] });
          return reply.type("application/pdf").header("Content-Disposition", 'attachment; filename="partition.pdf"').send(pdf);
        }
        const xml = toMusicXml(r.melodie.notes, bpm, { title: (await meta(pid)).titre, tonic: c.tonique, mode: c.mode, timeSig: c.mesure });
        return reply.type("application/vnd.recordare.musicxml+xml").header("Content-Disposition", 'attachment; filename="melodie.musicxml"').send(xml);
      } catch (e) {
        if (e instanceof ExportError) throw fail(422, e.message);
        throw e;
      }
    });

    // Suppression définitive : fichiers audio, analyse et exports
    api.delete("/projets/:pid", async (req, reply) => {
      const { pid } = req.params;
      if (!existsSync(dir(pid))) throw fail(404, "Projet inconnu.");
      const j = jobs.get(pid);
      jobs.delete(pid);
      await j?.worker?.terminate();
      await rm(dir(pid), { recursive: true, force: true });
      return reply.code(204).send();
    });
  }, { prefix: "/api" });

  // Interface web compilée (frontend/dist), si elle existe
  const dist = path.resolve(here, "../../frontend/dist");
  if (existsSync(dist)) await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ detail: "Ressource introuvable." }));

  app.addHook("onClose", async () => { await Promise.all([...jobs.values()].map((j) => j.worker?.terminate())); });
  return app;
}
