// Exports MIDI et MusicXML (§9.B), écrits directement. Refuse de produire une partition vide.
import { NOTES_EN } from "./analysis.js";

export class ExportError extends Error {}
const check = (notes) => {
  if (!notes?.length) throw new ExportError("Aucune note détectée : pas de partition générée (pas de partition vide).");
};

const varlen = (v) => { const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); return b; };

/** Fichier MIDI standard (format 0, 480 ticks par noire). */
export function toMidi(notes, bpm, timeSig = "4/4") {
  check(notes);
  const tempo = Number(bpm) || 120, tpq = 480, tick = (s) => Math.round((s * tempo * tpq) / 60);
  const ev = [];
  for (const n of notes) {
    const a = tick(n.debut_s), b = Math.max(a + 1, tick(n.debut_s + n.duree_s));
    ev.push([a, 1, 0x90, n.midi, 90], [b, 0, 0x80, n.midi, 0]);
  }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // à tick égal, les fins avant les débuts
  const us = Math.round(60e6 / tempo), [num, den] = timeSig.split("/").map(Number);
  const trk = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255,
    0, 0xff, 0x58, 4, num, Math.log2(den), 24, 8,
    0, 0xc0, 52]; // Choir Aahs
  let t = 0;
  for (const [at, , st, p, v] of ev) { trk.push(...varlen(at - t), st, p, v); t = at; }
  trk.push(0, 0xff, 0x2f, 0);
  const head = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, tpq >> 8, tpq & 255, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 0]);
  head.writeUInt32BE(trk.length, 18);
  return Buffer.concat([head, Buffer.from(trk)]);
}

/** Secondes → doubles croches (entiers). Renvoie [{off, dur, midi}] sans chevauchement. */
export function quantize(notes, bpm) {
  const u = 60 / Number(bpm) / 4, sorted = [...notes].sort((a, b) => a.debut_s - b.debut_s), t0 = sorted[0].debut_s, ev = [];
  for (const n of sorted) {
    let off = Math.round((n.debut_s - t0) / u);
    const dur = Math.max(1, Math.round(n.duree_s / u)), last = ev[ev.length - 1];
    if (last && off <= last.off) off = last.off + 1;           // deux notes sur la même case
    if (last && last.off + last.dur > off) last.dur = off - last.off; // pas de chevauchement
    ev.push({ off, dur, midi: n.midi });
  }
  return ev;
}

const TYPES = [[24, "whole", 1], [16, "whole", 0], [12, "half", 1], [8, "half", 0], [6, "quarter", 1], [4, "quarter", 0], [3, "eighth", 1], [2, "eighth", 0], [1, "16th", 0]];
/** Découpe une durée en valeurs notables alignées sur la pulsation. */
export function split(pos, dur) {
  const out = [];
  while (dur > 0) {
    const [d, type, dots] = TYPES.find(([d, , dots]) => d <= dur && pos % (dots ? d / 3 : d) === 0);
    out.push({ d, type, dots }); pos += d; dur -= d;
  }
  return out;
}
const FIFTHS = [0, 7, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const STEP_SHARP = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]];
const STEP_FLAT = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

export function toMusicXml(notes, bpm, { title = "Mélodie", tonic = null, mode = "majeur", timeSig = "4/4" } = {}) {
  check(notes);
  if (!Number(bpm)) throw new ExportError("Tempo inconnu : impossible de placer les notes en mesures. Indiquez un tempo manuellement.");
  const [num, den] = timeSig.split("/").map(Number), mlen = (num * 16) / den;
  const pc = tonic ? NOTES_EN.indexOf(tonic) : -1;
  const fifths = pc < 0 ? 0 : FIFTHS[(pc + (mode === "mineur" ? 3 : 0)) % 12];
  const spell = fifths < 0 ? STEP_FLAT : STEP_SHARP;
  const ev = quantize(notes, bpm);
  const bass = ev.reduce((a, e) => a + e.midi, 0) / ev.length < 55;

  // Ligne de temps continue : notes et silences, complétée jusqu'à la fin de la dernière mesure
  const items = []; let pos = 0;
  for (const e of ev) { if (e.off > pos) items.push({ pos, dur: e.off - pos }); items.push({ pos: e.off, dur: e.dur, midi: e.midi }); pos = e.off + e.dur; }
  const total = Math.ceil(pos / mlen) * mlen;
  if (total > pos) items.push({ pos, dur: total - pos });

  const measures = Array.from({ length: total / mlen }, () => []);
  for (const it of items) {
    const pieces = [];
    for (let p = it.pos, left = it.dur; left > 0; ) {
      const m = Math.floor(p / mlen), room = (m + 1) * mlen - p, d = Math.min(room, left), inM = p - m * mlen;
      if (it.midi == null && d === mlen) pieces.push({ m, full: true, d });
      else for (const s of split(inM, d)) pieces.push({ m, ...s });
      p += d; left -= d;
    }
    pieces.forEach((pc2, i) => {
      let x = "      <note>\n";
      if (it.midi == null) x += pc2.full ? '        <rest measure="yes"/>\n' : "        <rest/>\n";
      else {
        const [step, alter] = spell[it.midi % 12];
        x += `        <pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${Math.floor(it.midi / 12) - 1}</octave></pitch>\n`;
      }
      x += `        <duration>${pc2.d}</duration>\n`;
      const stop = it.midi != null && i > 0, start = it.midi != null && i < pieces.length - 1;
      if (stop) x += '        <tie type="stop"/>\n';
      if (start) x += '        <tie type="start"/>\n';
      x += "        <voice>1</voice>\n";
      if (!pc2.full) x += `        <type>${pc2.type}</type>\n` + "        <dot/>\n".repeat(pc2.dots);
      if (stop || start) x += `        <notations>${stop ? '<tied type="stop"/>' : ""}${start ? '<tied type="start"/>' : ""}</notations>\n`;
      measures[pc2.m].push(x + "      </note>\n");
    });
  }

  const head = `      <attributes>
        <divisions>4</divisions>
        <key><fifths>${fifths}</fifths><mode>${mode === "mineur" ? "minor" : "major"}</mode></key>
        <time><beats>${num}</beats><beat-type>${den}</beat-type></time>
        <clef><sign>${bass ? "F" : "G"}</sign><line>${bass ? 4 : 2}</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type>
        <sound tempo="${Math.round(bpm)}"/>
      </direction>
`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${esc(title)}</work-title></work>
  <identification><encoding><software>Choir AI Studio</software></encoding></identification>
  <part-list>
    <score-part id="P1"><part-name>Mélodie</part-name></score-part>
  </part-list>
  <part id="P1">
${measures.map((m, i) => `    <measure number="${i + 1}">\n${i ? "" : head}${m.join("")}    </measure>\n`).join("")}  </part>
</score-partwise>
`;
}
