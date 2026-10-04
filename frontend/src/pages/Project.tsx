import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Download, Loader2, Play, Redo2, Square, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { api, duree, nomFr, nomNote, type Analyse, type Note } from "../api";
import { usePlayer } from "../player";
import PianoRoll from "../components/PianoRoll";
import { Alerte, Confiance, Titre } from "../components/ui";

const MESURES = ["2/4", "3/4", "4/4", "6/8", "12/8"];
const Retour = () => <a href="#/" className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-white mb-4"><ArrowLeft size={15} />Projets</a>;

export default function Project({ id }: { id: string }) {
  const st = useQuery({
    queryKey: ["statut", id], queryFn: () => api.statut(id),
    refetchInterval: (q) => (q.state.data?.statut === "en_cours" ? 600 : false),
  });
  const s = st.data;
  const an = useQuery({ queryKey: ["analyse", id], queryFn: () => api.analyse(id), enabled: s?.statut === "terminee" });
  const qc = useQueryClient();
  const relance = useMutation({
    mutationFn: () => api.reanalyser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["statut", id] }),
  });

  if (st.error) return <div><Retour /><Alerte tone="error">{(st.error as Error).message}</Alerte></div>;
  if (!s) return <p className="text-mist flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Chargement…</p>;
  if (s.statut === "en_cours")
    return (
      <div className="rise max-w-xl">
        <Retour />
        <Titre sur="Analyse en cours">{s.etape ?? "Préparation"}</Titre>
        <div className="panel p-6">
          <div className="h-2 rounded-full bg-night-700 overflow-hidden" role="progressbar" aria-valuenow={s.progression} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-gold-400 transition-[width] duration-500" style={{ width: `${s.progression}%` }} />
          </div>
          <p className="mt-3 text-sm text-mist tabular-nums">{s.progression} % · préparation, tempo, tonalité, accords, puis mélodie</p>
        </div>
      </div>
    );
  if (s.statut === "echec")
    return (
      <div className="rise max-w-xl">
        <Retour />
        <Titre sur="Analyse impossible">Aucun résultat n'a été produit</Titre>
        <Alerte tone="error">{s.erreur}</Alerte>
        {relance.error && <div className="mt-3"><Alerte tone="error">{(relance.error as Error).message}</Alerte></div>}
        <div className="flex flex-wrap gap-3 mt-5">
          <button className="btn btn-gold" disabled={relance.isPending} onClick={() => relance.mutate()}>Relancer l'analyse</button>
          <a href="#/nouveau" className="btn">Essayer un autre enregistrement</a>
        </div>
      </div>
    );
  if (an.error) return <div><Retour /><Alerte tone="error">{(an.error as Error).message}</Alerte></div>;
  if (!an.data) return <p className="text-mist flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Chargement de l'analyse…</p>;
  return <Vue a={an.data} id={id} />;
}

function Puce({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-pressed={on} onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums ${on ? "border-gold-400 bg-gold-400/15 text-gold-300" : "border-night-600 text-mist hover:text-white hover:border-plum-400"}`}>
      {children}
    </button>
  );
}

function Vue({ a, id }: { a: Analyse; id: string }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Note[]>(a.melodie.notes);
  const [past, setPast] = useState<Note[][]>([]);
  const [future, setFuture] = useState<Note[][]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [px, setPx] = useState(90);
  const [choix, setChoix] = useState(a.choix);
  const [bpmTxt, setBpmTxt] = useState(String(a.choix.bpm ?? ""));
  const [errX, setErrX] = useState("");
  const timer = useRef<number>();

  const save = useMutation({ mutationFn: (n: Note[]) => api.notes(id, n), onSuccess: () => qc.invalidateQueries({ queryKey: ["projets"] }) });
  const choisir = useMutation({
    mutationFn: (c: Parameters<typeof api.choisir>[1]) => api.choisir(id, c),
    onSuccess: (c) => { setChoix(c); setBpmTxt(String(c.bpm ?? "")); qc.invalidateQueries({ queryKey: ["projets"] }); },
  });
  const [dirty, setDirty] = useState(false);
  const persist = (n: Note[]) => {
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save.mutate(n, { onSuccess: () => setDirty(false) }), 400);
  };
  const commit = useCallback((n: Note[]) => {
    setPast((p) => [...p.slice(-99), notes]); setFuture([]); setNotes(n); persist(n);
  }, [notes]); // eslint-disable-line
  const undo = useCallback(() => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1)); setFuture([notes, ...future]); setNotes(prev); persist(prev);
  }, [past, future, notes]); // eslint-disable-line
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast([...past, notes]); setFuture(future.slice(1)); setNotes(future[0]); persist(future[0]);
  }, [past, future, notes]); // eslint-disable-line

  const p = usePlayer(notes, api.audioUrl(id), a.audio.duree_s);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.code === "Space" && tag !== "BUTTON") { e.preventDefault(); p.playing ? p.stop() : p.play(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [undo, redo, p]);

  const exporter = async (fmt: "midi" | "musicxml" | "pdf") => {
    setErrX("");
    try {
      if (dirty) { clearTimeout(timer.current); await save.mutateAsync(notes); setDirty(false); }
      await api.exporter(id, fmt, a.meta.titre);
    } catch (e) { setErrX((e as Error).message); }
  };
  const n = notes.find((x) => x.id === sel);
  const vide = notes.length === 0;
  const bpmOk = Number(bpmTxt) >= 30 && Number(bpmTxt) <= 300;

  return (
    <div className="rise space-y-6">
      <div>
        <Retour />
        <Titre sur={`${a.meta.fichier} · ${duree(a.audio.duree_s)}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ghost" disabled={vide} onClick={() => exporter("midi")}><Download size={16} />MIDI</button>
              <button className="btn btn-ghost" disabled={vide || !choix.bpm} onClick={() => exporter("pdf")}><Download size={16} />Partition PDF (6 voix)</button>
              <button className="btn btn-gold" disabled={vide || !choix.bpm} onClick={() => exporter("musicxml")}><Download size={16} />MusicXML</button>
            </div>
          }>{a.meta.titre}</Titre>
        {errX && <Alerte tone="error">{errX}</Alerte>}
        {vide && <Alerte>Aucune note dans la mélodie : l'export est désactivé. Double-cliquez dans la grille pour saisir des notes à la main.</Alerte>}
      </div>

      {/* Paramètres */}
      <section aria-label="Paramètres détectés" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel p-4">
          <p className="label">Tonalité</p>
          <p className="font-display text-2xl mt-1 text-gold-300">{choix.tonalite}</p>
          <Confiance v={a.tonalite.hypotheses.find((h) => h.tonalite === choix.tonalite)?.confiance ?? 0} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {a.tonalite.hypotheses.map((h, i) => (
              <Puce key={h.tonalite} on={h.tonalite === choix.tonalite} onClick={() => choisir.mutate({ tonalite_index: i })}>{h.tonalite} · {Math.round(h.confiance * 100)} %</Puce>
            ))}
          </div>
        </div>
        <div className="panel p-4">
          <p className="label">Tempo</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{choix.bpm ?? "—"} <span className="text-base text-mist">BPM</span></p>
          {a.tempo.bpm ? <Confiance v={a.tempo.confiance} /> : <span className="text-xs text-rose-300">Non détecté : saisissez-le</span>}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {a.tempo.hypotheses.map((h) => (
              <Puce key={h.bpm} on={h.bpm === choix.bpm} onClick={() => choisir.mutate({ bpm: h.bpm })}>{h.bpm}</Puce>
            ))}
            <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); bpmOk && choisir.mutate({ bpm: Number(bpmTxt) }); }}>
              <input aria-label="Tempo manuel en BPM" inputMode="decimal" value={bpmTxt} onChange={(e) => setBpmTxt(e.target.value)}
                className="w-16 rounded-md bg-night-950 border border-night-600 px-2 py-1 text-xs tabular-nums outline-none focus:border-plum-400" />
              <button className="rounded-md border border-night-600 p-1 text-mist hover:text-white disabled:opacity-40" disabled={!bpmOk || Number(bpmTxt) === choix.bpm} aria-label="Appliquer ce tempo"><Check size={14} /></button>
            </form>
          </div>
        </div>
        <div className="panel p-4">
          <p className="label">Mesure</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{choix.mesure}</p>
          {a.mesure ? <Confiance v={a.mesure.hypotheses.find((h) => h.mesure === choix.mesure)?.confiance ?? 0} /> : <span className="text-xs text-mist">Non estimée (extrait trop court) : 4/4 par défaut</span>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {MESURES.map((m) => <Puce key={m} on={m === choix.mesure} onClick={() => choisir.mutate({ mesure: m })}>{m}</Puce>)}
          </div>
        </div>
        <div className="panel p-4">
          <p className="label">Mélodie</p>
          <p className="font-display text-2xl mt-1 tabular-nums">{notes.length} <span className="text-base text-mist">notes</span></p>
          <Confiance v={a.melodie.confiance} />
          <p className="mt-3 text-xs text-mist leading-relaxed">
            {a.melodie.ambitus && <>Ambitus détecté {nomFr(a.melodie.ambitus.min)} – {nomFr(a.melodie.ambitus.max)} · </>}
            signal audio de qualité {a.audio.qualite}
          </p>
        </div>
      </section>
      {choisir.error && <Alerte tone="error">{(choisir.error as Error).message}</Alerte>}

      {(a.audio.avertissements.length > 0 || a.limites.length > 0) && (
        <Alerte>
          <p className="font-semibold text-white mb-1">À savoir sur ce résultat</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {[...a.audio.avertissements, ...a.limites].map((l) => <li key={l}>{l}</li>)}
          </ul>
        </Alerte>
      )}

      {/* Éditeur */}
      <section aria-label="Éditeur de mélodie" className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button className="btn btn-gold" onClick={() => (p.playing ? p.stop() : p.play())}>
            {p.playing ? <><Square size={14} fill="currentColor" />Arrêter</> : <><Play size={15} fill="currentColor" />Écouter</>}
          </button>
          <span className="font-display text-xl tabular-nums w-24">{p.pos.toFixed(1)} s</span>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[#e3b653]" checked={p.original} onChange={(e) => p.setOriginal(e.target.checked)} />Original</label>
          <label className="flex items-center gap-1.5 text-sm" title="Son de contrôle généré par un oscillateur, pas une voix humaine"><input type="checkbox" className="accent-[#e3b653]" checked={p.synth} onChange={(e) => p.setSynth(e.target.checked)} />Mélodie transcrite <span className="text-mist/70">(synthèse)</span></label>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs text-mist mr-2" aria-live="polite">
              {save.error ? <span className="text-rose-300">Échec de l'enregistrement</span> : dirty || save.isPending ? "Enregistrement…" : past.length ? "Modifications enregistrées" : ""}
            </span>
            <button className="btn btn-ghost !p-2" onClick={undo} disabled={!past.length} aria-label="Annuler"><Undo2 size={16} /></button>
            <button className="btn btn-ghost !p-2" onClick={redo} disabled={!future.length} aria-label="Rétablir"><Redo2 size={16} /></button>
            <button className="btn btn-ghost !p-2" onClick={() => setPx(Math.max(40, px - 30))} disabled={px <= 40} aria-label="Dézoomer"><ZoomOut size={16} /></button>
            <button className="btn btn-ghost !p-2" onClick={() => setPx(Math.min(240, px + 30))} disabled={px >= 240} aria-label="Zoomer"><ZoomIn size={16} /></button>
          </div>
        </div>

        <PianoRoll notes={notes} onCommit={commit} selected={sel} onSelect={setSel} accords={a.accords} beats={a.beats_s}
          duree={a.audio.duree_s} pos={p.pos} onSeek={p.seek} px={px} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-sm">
          {n ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-display text-xl text-gold-300">{nomNote(n.midi)}</span>
              <span className="tabular-nums text-mist">début {n.debut_s.toFixed(2)} s · durée {n.duree_s.toFixed(2)} s</span>
              {n.source ? <span className="text-gold-300 text-xs">{n.source === "manuelle" ? "Ajoutée à la main" : "Corrigée à la main"}</span> : <Confiance v={n.confiance} />}
              <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => { commit(notes.filter((x) => x.id !== n.id)); setSel(null); }}><Trash2 size={13} />Supprimer</button>
            </div>
          ) : (
            <p className="text-mist">Glissez une note pour la déplacer, son bord droit pour l'allonger. Double-clic dans la grille pour en ajouter une.</p>
          )}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist">
            <li className="flex items-center gap-1.5"><span className="w-4 h-2.5 rounded-sm bg-plum-400 border border-plum-300/60" />Détectée</li>
            <li className="flex items-center gap-1.5"><span className="w-4 h-2.5 rounded-sm bg-plum-400/40 border border-dashed border-rose-300" />Incertaine</li>
            <li className="flex items-center gap-1.5"><span className="w-4 h-2.5 rounded-sm bg-gold-400" />Saisie ou corrigée</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
