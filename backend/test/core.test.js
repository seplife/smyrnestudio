import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import { fft } from "../src/fft.js";
import { ExportError, quantize, toMidi, toMusicXml } from "../src/export.js";
import { AnalysisError, analyze } from "../src/pipeline.js";
import { SCALE, chordsWav, scaleWav, silenceWav, tmp } from "./helpers.js";

let wav, res;
before(async () => { wav = scaleWav(); res = await analyze(wav); });

test("FFT : une sinusoïde donne un pic sur le bon indice", () => {
  const n = 256, re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n)), im = new Float64Array(n);
  fft(re, im);
  const mag = Array.from(re, (r, i) => Math.hypot(r, im[i]));
  assert.equal(mag.indexOf(Math.max(...mag.slice(0, n / 2))), 5);
  assert.ok(Math.abs(mag[5] - n / 2) < 1e-6);
});

test("mélodie : les 16 notes de la gamme, au bon endroit", () => {
  const notes = res.melodie.notes;
  assert.deepEqual(notes.map((n) => n.midi), SCALE);
  assert.ok(res.melodie.confiance > 0.6);
  assert.ok(Math.abs(notes[1].debut_s - 0.5) < 0.06);
  assert.deepEqual(res.melodie.ambitus, { min: "C4", max: "C5" });
});

test("tonalité : Do majeur avec trois hypothèses", () => {
  assert.equal(res.tonalite.tonalite, "Do majeur");
  assert.equal(res.tonalite.hypotheses.length, 3);
  assert.ok(res.tonalite.confiance > 0 && res.tonalite.confiance <= 1);
});

test("tempo : 120 BPM à ±2", () => {
  assert.ok(Math.abs(res.tempo.bpm - 120) < 2, String(res.tempo.bpm));
  assert.ok(res.tempo.hypotheses.length >= 2);
});

test("accords : C – F – G – C et tempo 100", async () => {
  const r = await analyze(chordsWav());
  assert.deepEqual(r.accords.map((c) => c.accord), ["C", "F", "G", "C", "F", "G", "C"]);
  assert.ok(r.accords.every((c) => c.confiance > 0.8));
  assert.ok(Math.abs(r.tempo.bpm - 100) < 2);
  assert.equal(r.tonalite.tonalite, "Do majeur");
  assert.equal(r.melodie.notes.length, 0, "un accord plaqué n'est pas une mélodie : aucune note inventée");
});

test("l'original reste intact et une copie de travail est écrite", async () => {
  const h = () => createHash("md5").update(readFileSync(wav)).digest("hex"), avant = h(), w = path.join(tmp, "w.wav");
  await analyze(wav, w);
  assert.equal(h(), avant);
  assert.ok(statSync(w).size > 1000);
});

test("un silence est refusé avec une explication", async () => {
  await assert.rejects(analyze(silenceWav()), (e) => e instanceof AnalysisError && /silencieux/.test(e.message));
});

test("un format inconnu ou un faux fichier audio est refusé", async () => {
  const t = path.join(tmp, "x.txt"), faux = path.join(tmp, "faux.mp3");
  writeFileSync(t, "non"); writeFileSync(faux, "ceci n'est pas un mp3");
  await assert.rejects(analyze(t), /Format/);
  await assert.rejects(analyze(faux), AnalysisError);
});

test("MIDI : en-tête valide et une note par note détectée", () => {
  const b = toMidi(res.melodie.notes, 120);
  assert.equal(b.subarray(0, 4).toString(), "MThd");
  assert.equal(b.readUInt32BE(18), b.length - 22);
  const on = [];
  for (let i = 22; i < b.length - 2; i++) if (b[i] === 0x90 && b[i + 2] === 90) on.push(b[i + 1]);
  assert.deepEqual(on, SCALE);
});

test("MusicXML : mesures pleines, hauteurs et armure correctes", () => {
  const xml = toMusicXml(res.melodie.notes, 120, { tonic: "C", mode: "majeur" });
  const steps = [...xml.matchAll(/<step>(.)<\/step><octave>(\d)/g)].map((m) => m[1] + m[2]);
  assert.deepEqual(steps, ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"]);
  const measures = xml.split("<measure ").slice(1);
  assert.equal(measures.length, 4);
  for (const m of measures) assert.equal([...m.matchAll(/<duration>(\d+)/g)].reduce((a, x) => a + +x[1], 0), 16);
  assert.match(xml, /<fifths>0<\/fifths>/);
});

test("MusicXML : liaisons par-dessus la barre, silences, bémols, 3/4", () => {
  const notes = [{ midi: 63, debut_s: 0, duree_s: 1.75 }, { midi: 70, debut_s: 2.5, duree_s: 0.5 }];
  const xml = toMusicXml(notes, 120, { tonic: "Eb", mode: "majeur", timeSig: "3/4" });
  assert.match(xml, /<fifths>-3<\/fifths>/);
  assert.match(xml, /<step>E<\/step><alter>-1<\/alter>/);
  assert.equal((xml.match(/<tie type="start"\/>/g) || []).length, 1);
  assert.match(xml, /<rest\/>/);
  for (const m of xml.split("<measure ").slice(1)) assert.equal([...m.matchAll(/<duration>(\d+)/g)].reduce((a, x) => a + +x[1], 0), 12);
  assert.deepEqual(quantize(notes, 120).map((e) => [e.off, e.dur]), [[0, 14], [20, 4]]);
});

test("pas de partition vide, pas de MusicXML sans tempo", () => {
  assert.throws(() => toMusicXml([], 120), ExportError);
  assert.throws(() => toMidi([], 120), ExportError);
  assert.throws(() => toMusicXml(res.melodie.notes, null), /Tempo inconnu/);
});
