import { useMemo, useRef, useState } from "react";
import { nomNote, type Analyse, type Note } from "../api";

const ROW = 13, GUT = 44;
const NOIRES = new Set([1, 3, 6, 8, 10]);
type Drag = { id: number; mode: "move" | "resize"; x0: number; y0: number; orig: Note; moved: boolean };

type Props = {
  notes: Note[]; onCommit: (n: Note[]) => void;
  selected: number | null; onSelect: (id: number | null) => void;
  accords: Analyse["accords"]; beats: number[]; duree: number;
  pos: number; onSeek: (t: number) => void; px: number;
};

export default function PianoRoll({ notes, onCommit, selected, onSelect, accords, beats, duree, pos, onSeek, px }: Props) {
  const [draft, setDraft] = useState<Note[] | null>(null);
  const drag = useRef<Drag | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const skipClick = useRef(false); // le clic qui suit un glisser ne doit pas désélectionner
  const shown = draft ?? notes;

  const [lo, hi] = useMemo(() => {
    if (!notes.length) return [55, 79];
    const ms = notes.map((n) => n.midi);
    return [Math.max(21, Math.min(...ms) - 5), Math.min(108, Math.max(...ms) + 5)];
  }, [notes]);
  const rows = hi - lo + 1;
  const fin = Math.max(duree, ...notes.map((n) => n.debut_s + n.duree_s)) + 1;
  const W = fin * px, H = rows * ROW;

  const at = (e: { clientX: number; clientY: number }) => {
    const r = grid.current!.getBoundingClientRect();
    return { t: Math.max(0, (e.clientX - r.left) / px), midi: hi - Math.floor((e.clientY - r.top) / ROW) };
  };

  function down(e: React.PointerEvent, n: Note) {
    e.stopPropagation();
    skipClick.current = true;
    onSelect(n.id);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mode = r.right - e.clientX < 9 ? "resize" : "move";
    drag.current = { id: n.id, mode, x0: e.clientX, y0: e.clientY, orig: n, moved: false };
    grid.current!.setPointerCapture(e.pointerId);
    grid.current!.focus();
  }
  function move(e: React.PointerEvent) {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.x0) / px, dy = Math.round((d.y0 - e.clientY) / ROW);
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3 && dy === 0) return;
    d.moved = true;
    const n = d.mode === "resize"
      ? { ...d.orig, duree_s: Math.max(0.05, +(d.orig.duree_s + dx).toFixed(3)) }
      : { ...d.orig, debut_s: Math.max(0, +(d.orig.debut_s + dx).toFixed(3)), midi: Math.min(hi, Math.max(lo, d.orig.midi + dy)) };
    setDraft(notes.map((x) => (x.id === d.id ? n : x)));
  }
  function up() {
    const d = drag.current; drag.current = null;
    setTimeout(() => { skipClick.current = false; }, 0);
    if (d?.moved && draft) onCommit(draft.map((x) => (x.id === d.id ? { ...x, confiance: 1, source: "corrigee" } : x)));
    setDraft(null);
  }
  function dbl(e: React.MouseEvent) {
    const { t, midi } = at(e);
    const id = Math.max(-1, ...notes.map((n) => n.id)) + 1;
    onCommit([...notes, { id, midi, debut_s: +t.toFixed(3), duree_s: 0.4, confiance: 1, source: "manuelle" }]);
    onSelect(id);
  }
  function key(e: React.KeyboardEvent) {
    const n = notes.find((x) => x.id === selected); if (!n) return;
    const set = (p: Partial<Note>) => onCommit(notes.map((x) => (x.id === n.id ? { ...x, ...p, confiance: 1, source: x.source === "manuelle" ? "manuelle" : "corrigee" } : x)));
    if (e.key === "Delete" || e.key === "Backspace") { onCommit(notes.filter((x) => x.id !== n.id)); onSelect(null); }
    else if (e.key === "ArrowUp") set({ midi: Math.min(108, n.midi + 1) });
    else if (e.key === "ArrowDown") set({ midi: Math.max(21, n.midi - 1) });
    else if (e.key === "ArrowLeft") set({ debut_s: Math.max(0, +(n.debut_s - 0.02).toFixed(3)) });
    else if (e.key === "ArrowRight") set({ debut_s: +(n.debut_s + 0.02).toFixed(3) });
    else return;
    e.preventDefault();
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-night-700 bg-night-950">
      <div style={{ width: W + GUT }} className="relative select-none">
        {/* Accords */}
        <div className="relative h-7 border-b border-night-700" style={{ marginLeft: GUT }}>
          {accords.map((a, i) => (
            <div key={i} title={`${a.accord} · confiance ${Math.round(a.confiance * 100)} % · autre lecture : ${a.alternative}`}
              className={`absolute top-1 bottom-1 rounded px-1.5 text-[11px] font-semibold leading-5 overflow-hidden whitespace-nowrap ${a.confiance >= 0.5 ? "bg-night-700 text-gold-300" : "bg-night-800 text-mist/70 italic"}`}
              style={{ left: a.debut_s * px + 1, width: Math.max(0, (a.fin_s - a.debut_s) * px - 2) }}>
              {a.accord}{a.confiance < 0.5 && " ?"}
            </div>
          ))}
        </div>
        {/* Règle */}
        <div className="relative h-5 border-b border-night-700 cursor-pointer text-[10px] text-mist/70" style={{ marginLeft: GUT }}
          onClick={(e) => onSeek(Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left) / px))}>
          {Array.from({ length: Math.ceil(fin) }, (_, s) => (
            <span key={s} className="absolute top-0.5 tabular-nums" style={{ left: s * px + 3 }}>{s % (px < 80 ? 5 : 1) === 0 ? `${s}s` : ""}</span>
          ))}
        </div>
        <div className="flex">
          {/* Clavier */}
          <div className="sticky left-0 z-20 shrink-0 bg-night-900 border-r border-night-700" style={{ width: GUT, height: H }}>
            {Array.from({ length: rows }, (_, i) => hi - i).map((m) => (
              <div key={m} style={{ height: ROW }} className={`text-[9px] leading-[13px] pr-1 text-right ${NOIRES.has(m % 12) ? "bg-night-950 text-transparent" : m % 12 === 0 ? "text-gold-300" : "text-mist/50"}`}>
                {m % 12 === 0 || m === hi || m === lo ? nomNote(m) : ""}
              </div>
            ))}
          </div>
          {/* Grille */}
          <div ref={grid} tabIndex={0} role="application" aria-label="Éditeur de mélodie. Flèches pour déplacer la note sélectionnée, Suppr pour l'effacer."
            className="relative outline-none focus-visible:ring-1 ring-gold-400 touch-pan-x" style={{ width: W, height: H }}
            onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={dbl} onKeyDown={key}
            onClick={(e) => { if (e.target === e.currentTarget && !skipClick.current) { onSelect(null); onSeek(at(e).t); } }}>
            {Array.from({ length: rows }, (_, i) => hi - i).map((m, i) => (
              <div key={m} className={`absolute left-0 right-0 pointer-events-none ${NOIRES.has(m % 12) ? "bg-white/[0.025]" : ""} ${m % 12 === 0 ? "border-b border-night-600" : ""}`} style={{ top: i * ROW, height: ROW }} />
            ))}
            {beats.map((b, i) => <div key={i} className="absolute top-0 bottom-0 w-px bg-night-700 pointer-events-none" style={{ left: b * px }} />)}
            {shown.map((n) => {
              const sel = n.id === selected, edit = !!n.source, bas = n.confiance < 0.5;
              return (
                <div key={n.id} role="button" aria-label={`${nomNote(n.midi)}, début ${n.debut_s.toFixed(2)} s`} aria-pressed={sel}
                  onPointerDown={(e) => down(e, n)} onDoubleClick={(e) => e.stopPropagation()}
                  className={`absolute rounded-[4px] cursor-grab active:cursor-grabbing touch-none border ${sel ? "ring-2 ring-white z-10" : ""} ${edit ? "border-gold-400" : bas ? "border-dashed border-rose-300" : "border-plum-300/60"}`}
                  style={{ left: n.debut_s * px, width: Math.max(5, n.duree_s * px - 1), top: (hi - n.midi) * ROW + 1, height: ROW - 2,
                    background: edit ? "#e3b653" : `rgba(155,130,240,${0.35 + 0.65 * n.confiance})` }}>
                  <span className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize" />
                </div>
              );
            })}
            <div className="absolute top-0 bottom-0 w-0.5 bg-gold-400 pointer-events-none z-10" style={{ left: pos * px }} />
          </div>
        </div>
      </div>
    </div>
  );
}
