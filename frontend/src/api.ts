export type Note = { id: number; midi: number; debut_s: number; duree_s: number; confiance: number; source?: string; nom?: string };
export type Statut = { statut: "en_cours" | "terminee" | "echec"; progression?: number; etape?: string; erreur?: string };
export type Choix = { bpm: number | null; tonalite: string; tonique: string; mode: string; mesure: string };
export type Projet = {
  id: string; titre: string; fichier: string; cree_le: number; statut: Statut;
  resume?: { tonalite: string; bpm: number | null; duree_s: number; notes: number };
};
export type Analyse = {
  meta: { id: string; titre: string; fichier: string; cree_le: number };
  audio: { duree_s: number; frequence_origine_hz: number; part_silence: number; dynamique_db: number; qualite: string; avertissements: string[] };
  tempo: { bpm: number | null; confiance: number; hypotheses: { bpm: number; confiance: number }[] };
  mesure: null | { valeur: string; confiance: number; hypotheses: { mesure: string; confiance: number }[]; note: string };
  tonalite: { tonalite: string; confiance: number; hypotheses: { tonalite: string; confiance: number }[] };
  accords: { accord: string; alternative: string; debut_s: number; fin_s: number; confiance: number }[];
  melodie: { notes: Note[]; confiance: number; part_voisee: number; methode: string; ambitus?: { min: string; max: string } };
  beats_s: number[]; limites: string[]; choix: Choix;
};

const B = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(B + path, init);
  } catch {
    throw new Error("Serveur injoignable. Vérifiez que l'API est démarrée.");
  }
  if (!r.ok) {
    let msg = `Erreur ${r.status}`;
    try {
      const j = await r.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch { /* corps non JSON */ }
    throw new Error(msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
  projets: () => req<Projet[]>("/projets"),
  creer: (fichier: Blob, nom: string, titre: string) => {
    const f = new FormData();
    f.append("fichier", fichier, nom);
    f.append("titre", titre);
    return req<{ id: string }>("/projets", { method: "POST", body: f });
  },
  statut: (id: string) => req<Statut>(`/projets/${id}/statut`),
  analyse: (id: string) => req<Analyse>(`/projets/${id}/analyse`),
  reanalyser: (id: string) => req<{ id: string }>(`/projets/${id}/reanalyse`, { method: "POST" }),
  choisir: (id: string, c: { bpm?: number; tonalite_index?: number; mesure?: string }) =>
    req<Choix>(`/projets/${id}/choix`, json("PATCH", c)),
  notes: (id: string, notes: Note[]) =>
    req<Note[]>(`/projets/${id}/notes`, json("PUT", notes.map(({ midi, debut_s, duree_s, confiance, source }) => ({ midi, debut_s, duree_s, confiance, source })))),
  supprimer: (id: string) => req<void>(`/projets/${id}`, { method: "DELETE" }),
  audioUrl: (id: string) => `${B}/projets/${id}/audio`,
  async exporter(id: string, fmt: "midi" | "musicxml" | "pdf", titre: string) {
    const r = await fetch(`${B}/projets/${id}/export/${fmt}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Erreur ${r.status}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = `${titre}.${fmt === "midi" ? "mid" : fmt === "pdf" ? "pdf" : "musicxml"}`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

const FR = ["Do", "Do♯", "Ré", "Mi♭", "Mi", "Fa", "Fa♯", "Sol", "La♭", "La", "Si♭", "Si"];
export const nomNote = (midi: number) => `${FR[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const duree = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const EN: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C#4" (notation de l'API) → "Do♯4" */
export const nomFr = (en: string) => {
  const m = en.match(/^([A-G])(#?)(-?\d+)$/);
  return m ? nomNote(EN[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12) : en;
};
