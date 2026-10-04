import { useEffect, useRef, useState } from "react";
import { Circle, Mic, Pause, Play, RotateCcw, Square } from "lucide-react";
import { Alerte } from "./ui";

type Etat = "repos" | "enregistre" | "pause" | "pret";

/** Enregistrement micro réel (MediaRecorder) avec niveau d'entrée et détection de saturation. */
export default function Recorder({ onReady }: { onReady: (b: Blob | null, nom: string) => void }) {
  const [etat, setEtat] = useState<Etat>("repos");
  const [err, setErr] = useState("");
  const [sec, setSec] = useState(0);
  const [sature, setSature] = useState(false);
  const [url, setUrl] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const etatRef = useRef<Etat>("repos");
  etatRef.current = etat;

  const liberer = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    ctx.current?.close().catch(() => {});
    stream.current = null; ctx.current = null;
  };
  useEffect(() => liberer, []);
  useEffect(() => {
    if (etat !== "enregistre") return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [etat]);

  async function demarrer() {
    setErr(""); setSature(false); setSec(0); onReady(null, "");
    if (url) { URL.revokeObjectURL(url); setUrl(""); }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErr("Ce navigateur ne permet pas l'enregistrement. Importez un fichier à la place."); return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      stream.current = s;
      const ac = new AudioContext(); ctx.current = ac;
      const an = ac.createAnalyser(); an.fftSize = 2048;
      ac.createMediaStreamSource(s).connect(an);
      const buf = new Float32Array(an.fftSize);
      const hist: number[] = [];
      const draw = () => {
        raf.current = requestAnimationFrame(draw);
        an.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        if (etatRef.current === "enregistre") {
          if (peak >= 0.99) setSature(true);
          hist.push(peak); if (hist.length > 400) hist.shift();
        }
        const c = canvas.current; if (!c) return;
        const g = c.getContext("2d")!; const w = c.width, h = c.height;
        g.clearRect(0, 0, w, h);
        const bw = w / 400;
        hist.forEach((p, i) => {
          g.fillStyle = p >= 0.99 ? "#fb7185" : "#9b82f0";
          const bh = Math.max(2, p * h);
          g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 1), bh);
        });
      };
      draw();
      const chunks: Blob[] = [];
      const r = new MediaRecorder(s); rec.current = r;
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const type = r.mimeType || "audio/webm";
        const b = new Blob(chunks, { type });
        liberer();
        setUrl(URL.createObjectURL(b)); setEtat("pret");
        onReady(b, `enregistrement.${type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm"}`);
      };
      r.start(250); setEtat("enregistre");
    } catch (e) {
      liberer();
      setErr((e as Error).name === "NotAllowedError" ? "Accès au microphone refusé. Autorisez-le dans le navigateur, puis réessayez." : "Aucun microphone utilisable n'a été trouvé.");
    }
  }
  const pause = () => { rec.current?.pause(); setEtat("pause"); };
  const reprendre = () => { rec.current?.resume(); setEtat("enregistre"); };
  const arreter = () => rec.current?.stop();
  const actif = etat === "enregistre" || etat === "pause";

  return (
    <div className="space-y-4">
      {err && <Alerte tone="error">{err}</Alerte>}
      <div className="rounded-xl bg-night-950 border border-night-700 h-28 flex items-center justify-center overflow-hidden">
        {actif ? <canvas ref={canvas} width={800} height={112} className="w-full h-full" aria-label="Niveau d'entrée" />
          : url ? <audio controls src={url} className="w-full px-3" />
          : <p className="text-mist/70 text-sm flex items-center gap-2"><Mic size={16} />Le niveau d'entrée s'affichera ici</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {etat === "repos" && <button className="btn btn-gold" onClick={demarrer}><Circle size={14} fill="currentColor" />Enregistrer</button>}
        {etat === "enregistre" && <button className="btn btn-ghost" onClick={pause}><Pause size={16} />Pause</button>}
        {etat === "pause" && <button className="btn btn-ghost" onClick={reprendre}><Play size={16} />Reprendre</button>}
        {actif && <button className="btn btn-gold" onClick={arreter}><Square size={14} fill="currentColor" />Arrêter</button>}
        {etat === "pret" && <button className="btn btn-ghost" onClick={demarrer}><RotateCcw size={16} />Réenregistrer</button>}
        {(actif || etat === "pret") && (
          <span className="ml-auto font-display text-2xl tabular-nums" aria-live="off">
            {etat === "enregistre" && <span className="inline-block w-2 h-2 rounded-full bg-rose-400 mr-2 align-middle animate-pulse" />}
            {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      {sature && <Alerte>Saturation détectée : éloignez-vous du micro ou baissez le volume d'entrée, puis réenregistrez pour une analyse fiable.</Alerte>}
    </div>
  );
}
