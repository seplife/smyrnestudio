// Partition chorale à 6 voix (soprano, mezzo-alto, alto, ténor, baryton, basse) en PDF.
// La mélodie détectée est confiée au soprano ; les autres voix sont harmonisées à partir des
// accords détectés (notes de l'accord, conduite des voix par plus court déplacement).
import PDFDocument from "pdfkit";
import { CHORD_QUALITIES, NOTES_EN } from "./analysis.js";
import { ExportError, quantize, split } from "./export.js";

export const VOIX = [
  { nom: "Soprano", lo: 60, hi: 81, cle: "G" },
  { nom: "Mezzo-alto", lo: 55, hi: 76, cle: "G" },
  { nom: "Alto", lo: 53, hi: 72, cle: "G" },
  { nom: "Ténor", lo: 48, hi: 67, cle: "G8" },
  { nom: "Baryton", lo: 41, hi: 62, cle: "F" },
  { nom: "Basse", lo: 36, hi: 57, cle: "F" },
];

const FIFTHS = [0, 7, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const SHARP = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]];
const FLAT = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];
const LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** Classes de hauteur d'un nom d'accord ("C", "Am", "Bb", "G7", "Dsus4"...) ; racine en premier. */
function chordPcs(name) {
  const m = /^([A-G][b#]?)(.*)$/.exec(name || "");
  if (!m || !(m[2] in CHORD_QUALITIES)) return null;
  const r = NOTES_EN.indexOf(m[1]);
  return r < 0 ? null : CHORD_QUALITIES[m[2]].map((k) => (r + k) % 12);
}

/** Attribue une hauteur à chacune des 6 voix pour chaque note (null pour un silence). */
function harmonize(ev, chordList) {
  const prev = VOIX.map((v) => Math.round((v.lo + v.hi) / 2));
  let lastPcs = null;
  return ev.map((e) => {
    if (e.midi == null) return null;
    const c = chordList.find((x) => e.t >= x.debut_s && e.t < x.fin_s);
    const pcs = chordPcs(c?.accord) || lastPcs || [e.midi % 12];
    lastPcs = pcs;
    const out = [e.midi];
    let upper = e.midi;
    for (let v = 1; v < VOIX.length; v++) {
      const basse = v === VOIX.length - 1, allowed = basse ? [pcs[0]] : pcs;
      let cands = [];
      for (let m = VOIX[v].lo; m <= Math.min(VOIX[v].hi, upper); m++) if (allowed.includes(m % 12)) cands.push(m);
      if (!cands.length) for (let m = upper; m >= 0; m--) if (allowed.includes(m % 12)) { cands = [m]; break; }
      const used = new Set(out.map((x) => x % 12));
      const cost = (m) => Math.abs(m - prev[v]) + (m === upper && !basse ? 2 : 0) + (used.has(m % 12) && !basse ? 1.5 : 0);
      const best = cands.reduce((a, b) => (cost(b) < cost(a) ? b : a));
      out.push(best); prev[v] = best; upper = best;
    }
    return { pitches: out, chord: c?.accord || null };
  });
}

const GAP = 4.2, RX = 2.7, STAFF_H = GAP * 4, STAFF_SP = 16, SYS_H = 6 * STAFF_H + 5 * STAFF_SP;
const PAGE_W = 841.89, PAGE_H = 595.28, X0 = 92, X1 = PAGE_W - 36;

function accidental(doc, kind, x, y) {
  doc.lineWidth(0.55).strokeColor("#000");
  if (kind === -1) {
    doc.moveTo(x, y - 6).lineTo(x, y + 1.6).stroke();
    doc.moveTo(x, y + 1.6).bezierCurveTo(x + 4.2, y - 0.2, x + 3.6, y - 3.4, x, y - 1.6).stroke();
  } else if (kind === 1) {
    doc.moveTo(x - 1, y - 4.4).lineTo(x - 1, y + 3.6).stroke();
    doc.moveTo(x + 1, y - 3.6).lineTo(x + 1, y + 4.4).stroke();
    doc.lineWidth(1.1).moveTo(x - 2.6, y + 0.6).lineTo(x + 2.6, y - 1.2).stroke();
    doc.moveTo(x - 2.6, y + 2.4).lineTo(x + 2.6, y + 0.6).stroke();
  } else {
    doc.moveTo(x - 1.2, y - 4.4).lineTo(x - 1.2, y + 1.8).stroke();
    doc.moveTo(x + 1.2, y - 1.8).lineTo(x + 1.2, y + 4.4).stroke();
    doc.lineWidth(1).moveTo(x - 1.2, y + 1.2).lineTo(x + 1.2, y - 0.2).stroke();
    doc.moveTo(x - 1.2, y - 0.6).lineTo(x + 1.2, y - 2).stroke();
  }
}

function rest(doc, p, top) {
  const { x, type, dots, full } = p;
  doc.fillColor("#000").strokeColor("#000").lineWidth(0.8);
  if (full || type === "whole") doc.rect(x - 4, top + GAP, 8, GAP * 0.5).fill();
  else if (type === "half") doc.rect(x - 4, top + 2 * GAP - GAP * 0.5, 8, GAP * 0.5).fill();
  else if (type === "quarter") {
    doc.moveTo(x + 1.5, top + 0.7 * GAP).lineTo(x - 1.5, top + 1.5 * GAP).lineTo(x + 1.5, top + 2.4 * GAP)
      .lineTo(x - 1.5, top + 3.2 * GAP).stroke();
  } else {
    const n = type === "16th" ? 2 : 1;
    for (let i = 0; i < n; i++) doc.circle(x - 1.5, top + (1.4 + i * 0.9) * GAP, 1).fill();
    doc.moveTo(x + 1.8, top + 1.2 * GAP).lineTo(x - 1.5, top + (1.4 + n * 0.9 + 0.8) * GAP).stroke();
  }
  if (!full) for (let i = 0; i < (dots || 0); i++) doc.circle(x + 7 + i * 3, top + 1.5 * GAP, 0.9).fill();
}

/**
 * @param {Array} notes  notes de la mélodie ({midi, debut_s, duree_s})
 * @param {number} bpm
 * @param {{title?:string, tonic?:string|null, mode?:string, timeSig?:string, chords?:Array}} opts
 * @returns {Promise<Buffer>}
 */
export function toPdf(notes, bpm, { title = "Partition", tonic = null, mode = "majeur", timeSig = "4/4", chords = [] } = {}) {
  if (!notes?.length) throw new ExportError("Aucune note détectée : pas de partition générée (pas de partition vide).");
  if (!Number(bpm)) throw new ExportError("Tempo inconnu : impossible de placer les notes en mesures. Indiquez un tempo manuellement.");

  // Mélodie ramenée dans la tessiture du soprano (par octaves entières : tonalité inchangée)
  const sortedMidi = notes.map((n) => n.midi).sort((a, b) => a - b), median = sortedMidi[Math.floor(sortedMidi.length / 2)];
  const shift = 12 * Math.round((70 - median) / 12);
  const shifted = notes.map((n) => ({ ...n, midi: n.midi + shift }));

  const [num, den] = timeSig.split("/").map(Number), mlen = (num * 16) / den;
  const pc = tonic ? NOTES_EN.indexOf(tonic) : -1;
  const fifths = pc < 0 ? 0 : FIFTHS[(pc + (mode === "mineur" ? 3 : 0)) % 12];
  const spell = fifths < 0 ? FLAT : SHARP;

  // Ligne de temps : notes et silences en doubles croches, avec le temps réel de chaque note
  const t0 = Math.min(...notes.map((n) => n.debut_s)), unit = 60 / Number(bpm) / 4;
  const ev = quantize(shifted, bpm).map((e) => ({ ...e, t: t0 + e.off * unit }));
  const harmo = harmonize(ev, chords);
  const items = []; let pos = 0;
  ev.forEach((e, i) => {
    if (e.off > pos) items.push({ pos, dur: e.off - pos });
    items.push({ pos: e.off, dur: e.dur, midi: e.midi, ...harmo[i] });
    pos = e.off + e.dur;
  });
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
    pieces.forEach((pc2, i) => measures[pc2.m].push({ ...pc2, item: it, first: i === 0, last: i === pieces.length - 1 }));
  }
  const all = measures.flat();
  all.forEach((p, i) => { p.next = all[i + 1]; });

  // Répartition en systèmes (lignes) : largeur d'une mesure selon son nombre de figures
  const CLEF_W = 24, FIRST_EXTRA = 24;
  const widths = measures.map((m) => Math.max(80, m.length * 26 + 16));
  const systems = []; let cur = [], sum = 0;
  const avail = (k) => X1 - X0 - CLEF_W - (k === 0 ? FIRST_EXTRA : 0);
  widths.forEach((w, i) => {
    if (cur.length && sum + w > avail(systems.length)) { systems.push(cur); cur = []; sum = 0; }
    cur.push(i); sum += w;
  });
  if (cur.length) systems.push(cur);
  const mpos = [];
  systems.forEach((idxs, k) => {
    const tot = idxs.reduce((a, i) => a + widths[i], 0);
    let f = avail(k) / tot;
    if (k === systems.length - 1) f = Math.min(f, 1.4);
    let x = X0 + CLEF_W + (k === 0 ? FIRST_EXTRA : 0);
    for (const i of idxs) {
      const w = widths[i] * f, n = measures[i].length;
      measures[i].forEach((p, j) => { p.x = p.full ? x + w / 2 : x + 8 + ((j + 0.5) * (w - 12)) / n; p.sys = k; });
      mpos[i] = { x, w }; x += w;
    }
  });

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: title, Creator: "Choir AI Studio" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res, rej) => { doc.on("end", () => res(Buffer.concat(chunks))); doc.on("error", rej); });

  let page = 1;
  const footer = () => {
    doc.font("Helvetica").fontSize(7).fillColor("#666").text(
      `Choir AI Studio · harmonisation automatique à vérifier et à corriger avant usage · page ${page}`,
      36, PAGE_H - 24, { width: PAGE_W - 72, align: "center", lineBreak: false });
    doc.fillColor("#000");
  };

  // En-tête
  const tonLabel = tonic ? `${tonic} ${mode}` : "tonalité inconnue";
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#000").text(title, 36, 30, { width: PAGE_W - 72, align: "center", lineBreak: false });
  const octs = shift / 12;
  doc.font("Helvetica").fontSize(9).fillColor("#333").text(
    `${tonLabel} · mesure ${timeSig} · noire = ${Math.round(bpm)}` +
      (shift ? ` · mélodie transposée de ${octs > 0 ? "+" : ""}${octs} octave(s) pour la tessiture du soprano` : ""),
    36, 56, { width: PAGE_W - 72, align: "center", lineBreak: false });
  doc.fillColor("#000");
  footer();

  const BOTTOM = PAGE_H - 40;
  let y = 90, lastChord = null;
  const BASE = (v) => (VOIX[v].cle === "F" ? 18 : 30); // position diatonique de la ligne du bas
  const posOf = (midi, v) => {
    const w = VOIX[v].cle === "G8" ? midi + 12 : midi, [l, alt] = spell[w % 12];
    return { p: (Math.floor(w / 12) - 1) * 7 + LETTER[l], alt };
  };

  systems.forEach((idxs, k) => {
    if (y + 16 + SYS_H > BOTTOM) { doc.addPage(); page++; footer(); y = 36; }
    const top0 = y + 16, stTop = (v) => top0 + v * (STAFF_H + STAFF_SP);
    y += 16 + SYS_H + 30;
    const xEnd = mpos[idxs[idxs.length - 1]].x + mpos[idxs[idxs.length - 1]].w;
    const xStart = X0;

    // Portées, noms, clés
    VOIX.forEach((vx, v) => {
      const t = stTop(v);
      doc.lineWidth(0.5).strokeColor("#000");
      for (let i = 0; i < 5; i++) doc.moveTo(xStart, t + i * GAP).lineTo(xEnd, t + i * GAP).stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor("#000").text(vx.nom, 36, t + 2 * GAP - 4, { width: X0 - 42, lineBreak: false });
      const f = vx.cle === "F";
      doc.font("Helvetica-BoldOblique").fontSize(15).text(f ? "F" : "G", xStart + 5, (f ? t + GAP : t + 3 * GAP) - 9, { lineBreak: false });
      if (vx.cle === "G8") doc.font("Helvetica-Bold").fontSize(6).text("8", xStart + 9, t + 4 * GAP + 3, { lineBreak: false });
      if (k === 0) {
        doc.font("Helvetica-Bold").fontSize(11).text(String(num), xStart + CLEF_W + 4, t + 0.1 * GAP - 1, { lineBreak: false })
          .text(String(den), xStart + CLEF_W + 4, t + 2.1 * GAP - 1, { lineBreak: false });
      }
    });
    // Barre de début reliant les 6 portées
    doc.lineWidth(0.8).moveTo(xStart, stTop(0)).lineTo(xStart, stTop(5) + STAFF_H).stroke();

    idxs.forEach((mi, j) => {
      const { x, w } = mpos[mi], xb = x + w, last = mi === measures.length - 1;
      doc.font("Helvetica").fontSize(6.5).fillColor("#888").text(String(mi + 1), x + 2, top0 - 9, { lineBreak: false });
      doc.fillColor("#000").lineWidth(last ? 0.8 : 0.5).moveTo(xb, stTop(0)).lineTo(xb, stTop(5) + STAFF_H).stroke();
      if (last) doc.lineWidth(1.6).moveTo(xb - 3, stTop(0)).lineTo(xb - 3, stTop(5) + STAFF_H).stroke();
      const acc = VOIX.map(() => new Map()); // altérations en vigueur dans la mesure
      measures[mi].forEach((p) => {
        if (!p.item.midi && p.item.midi !== 0) { VOIX.forEach((_, v) => rest(doc, p, stTop(v))); return; }
        if (p.first && p.item.chord && p.item.chord !== lastChord) {
          doc.font("Helvetica-Bold").fontSize(8).fillColor("#7a5a00").text(p.item.chord, p.x - 4, top0 - 14, { lineBreak: false });
          doc.fillColor("#000"); lastChord = p.item.chord;
        }
        p.item.pitches.forEach((midi, v) => {
          const t = stTop(v), bottom = t + 4 * GAP;
          const { p: sp, alt } = posOf(midi, v), yy = bottom - (sp - BASE(v)) * (GAP / 2), rel = sp - BASE(v);
          // lignes supplémentaires
          doc.lineWidth(0.5).strokeColor("#000");
          for (let r = -2; r >= rel; r -= 2) doc.moveTo(p.x - RX - 2.5, bottom - r * (GAP / 2)).lineTo(p.x + RX + 2.5, bottom - r * (GAP / 2)).stroke();
          for (let r = 10; r <= rel; r += 2) doc.moveTo(p.x - RX - 2.5, bottom - r * (GAP / 2)).lineTo(p.x + RX + 2.5, bottom - r * (GAP / 2)).stroke();
          // altération
          const cur2 = acc[v].get(sp) ?? 0;
          if (cur2 !== alt) { accidental(doc, alt, p.x - RX - 5.5, yy); acc[v].set(sp, alt); }
          // tête de note
          const open = p.type === "whole" || p.type === "half";
          doc.save().translate(p.x, yy);
          if (p.type !== "whole") doc.rotate(-20);
          doc.ellipse(0, 0, p.type === "whole" ? RX + 0.6 : RX, RX * 0.72).lineWidth(0.8);
          if (open) doc.stroke("#000"); else doc.fill("#000");
          doc.restore();
          // hampe et crochets
          const up = rel < 4;
          if (p.type !== "whole") {
            const sx = up ? p.x + RX - 0.4 : p.x - RX + 0.4, ey = up ? yy - GAP * 3.3 : yy + GAP * 3.3;
            doc.lineWidth(0.7).strokeColor("#000").moveTo(sx, yy).lineTo(sx, ey).stroke();
            const flags = p.type === "eighth" ? 1 : p.type === "16th" ? 2 : 0;
            for (let f = 0; f < flags; f++) {
              const fy = ey + (up ? 1 : -1) * f * 2.6;
              doc.lineWidth(1).moveTo(sx, fy).bezierCurveTo(sx + 3, fy + (up ? 3 : -3), sx + 5, fy + (up ? 5 : -5), sx + 4, fy + (up ? 8 : -8)).stroke();
            }
          }
          // points
          for (let d = 0; d < (p.dots || 0); d++) doc.circle(p.x + RX + 3.5 + d * 3, yy + (rel % 2 === 0 ? -GAP / 2 : 0), 0.9).fill("#000");
          // liaison vers la figure suivante de la même note
          if (!p.last) {
            const nxt = p.next;
            const x2 = nxt && nxt.item === p.item && nxt.sys === p.sys ? nxt.x : p.x + 14, dir = up ? 1 : -1, y0 = yy + dir * 2.4;
            doc.lineWidth(0.6).moveTo(p.x, y0).bezierCurveTo(p.x + (x2 - p.x) * 0.3, y0 + dir * 4, p.x + (x2 - p.x) * 0.7, y0 + dir * 4, x2, y0).stroke();
          }
        });
      });
    });
  });

  doc.end();
  return done;
}
