import { writeFileSync } from "node:fs";
import { toPdf } from "../src/score.js";

const notes = [];
const seq = [64, 67, 69, 67, 64, 62, 60, 62, 64, 64, 64, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60];
seq.forEach((m, i) => notes.push({ midi: m - 12, debut_s: i * 0.5, duree_s: i % 5 === 4 ? 0.75 : 0.5 }));
const chords = [
  { accord: "C", debut_s: 0, fin_s: 2 }, { accord: "Am", debut_s: 2, fin_s: 4 },
  { accord: "F", debut_s: 4, fin_s: 6 }, { accord: "G", debut_s: 6, fin_s: 8 },
  { accord: "C", debut_s: 8, fin_s: 12 },
];
const pdf = await toPdf(notes, 120, { title: "Test é", tonic: "C", mode: "majeur", timeSig: "4/4", chords });
writeFileSync(new URL("./sortie-test.pdf", import.meta.url), pdf);
console.log("OK", pdf.length, pdf.subarray(0, 5).toString());
