import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileAudio, Loader2, Mic, Upload, X } from "lucide-react";
import { api } from "../api";
import { go } from "../App";
import Recorder from "../components/Recorder";
import { Alerte, Titre } from "../components/ui";

const EXT = [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".webm", ".mp4", ".mov"];

export default function NewProject() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"import" | "micro">("import");
  const [titre, setTitre] = useState("");
  const [src, setSrc] = useState<{ blob: Blob; nom: string } | null>(null);
  const [droits, setDroits] = useState(false);
  const [over, setOver] = useState(false);
  const [errF, setErrF] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const creer = useMutation({
    mutationFn: () => api.creer(src!.blob, src!.nom, titre),
    onSuccess: ({ id }) => { qc.invalidateQueries({ queryKey: ["projets"] }); go(`/projet/${id}`); },
  });

  function choisir(f?: File) {
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!EXT.includes(ext)) { setErrF(`Format ${ext || "inconnu"} non pris en charge.`); return; }
    setErrF(""); setSrc({ blob: f, nom: f.name });
    if (!titre) setTitre(f.name.replace(/\.[^.]+$/, ""));
  }
  const onglet = (m: typeof mode, label: string, Icon: typeof Mic) => (
    <button role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setSrc(null); setErrF(""); }}
      className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold ${mode === m ? "bg-night-700 text-white" : "text-mist hover:text-white"}`}>
      <Icon size={16} className={mode === m ? "text-gold-400" : ""} />{label}
    </button>
  );

  return (
    <div className="rise max-w-2xl">
      <Titre sur="Nouveau projet">Apportez un enregistrement</Titre>
      <div className="panel p-5 sm:p-6 space-y-6">
        <div role="tablist" className="flex gap-1 rounded-xl bg-night-950 p-1">
          {onglet("import", "Importer un fichier", Upload)}
          {onglet("micro", "Enregistrer au micro", Mic)}
        </div>

        {mode === "import" ? (
          src ? (
            <div className="flex items-center gap-3 rounded-xl border border-night-600 bg-night-800 px-4 py-3">
              <FileAudio className="text-plum-400 shrink-0" size={22} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{src.nom}</p>
                <p className="text-xs text-mist">{(src.blob.size / 1048576).toFixed(1)} Mo</p>
              </div>
              <button aria-label="Retirer le fichier" className="p-2 text-mist hover:text-white" onClick={() => setSrc(null)}><X size={16} /></button>
            </div>
          ) : (
            <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); choisir(e.dataTransfer.files[0]); }}
              className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${over ? "border-gold-400 bg-night-800" : "border-night-600"}`}>
              <Upload className="mx-auto text-plum-400" size={26} />
              <p className="mt-3 font-medium">Déposez un fichier audio ou vidéo ici</p>
              <p className="text-sm text-mist mt-1">MP3, WAV, FLAC, M4A, AAC, OGG · MP4 et MOV (audio extrait)</p>
              <button className="btn btn-ghost mt-4" onClick={() => input.current?.click()}>Parcourir…</button>
              <input ref={input} type="file" accept={EXT.join(",")} className="sr-only" aria-label="Fichier audio" onChange={(e) => choisir(e.target.files?.[0])} />
            </div>
          )
        ) : (
          <Recorder onReady={(b, nom) => setSrc(b ? { blob: b, nom } : null)} />
        )}
        {errF && <Alerte tone="error">{errF}</Alerte>}

        <div>
          <label htmlFor="titre" className="label block mb-1.5">Titre du morceau</label>
          <input id="titre" value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Ex. Refrain du dimanche" maxLength={120}
            className="w-full rounded-lg bg-night-950 border border-night-600 px-3 py-2.5 placeholder:text-mist/50 focus:border-plum-400 outline-none" />
        </div>

        <p className="text-sm text-mist leading-relaxed">
          La mélodie est suivie <strong className="text-white">une voix à la fois</strong> : le résultat est le plus fiable sur une voix seule ou un fredonnement. Sur un morceau complet, tempo, tonalité et accords restent exploitables, la mélodie beaucoup moins.
        </p>

        <label className="flex gap-3 text-sm cursor-pointer">
          <input type="checkbox" checked={droits} onChange={(e) => setDroits(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#e3b653]" />
          <span>Je confirme disposer des droits nécessaires pour importer et traiter cet enregistrement.</span>
        </label>

        {creer.error && <Alerte tone="error">{(creer.error as Error).message}</Alerte>}
        <button className="btn btn-gold w-full justify-center py-3" disabled={!src || !droits || creer.isPending} onClick={() => creer.mutate()}>
          {creer.isPending ? <><Loader2 size={17} className="animate-spin" />Envoi…</> : "Lancer l'analyse"}
        </button>
      </div>
    </div>
  );
}
