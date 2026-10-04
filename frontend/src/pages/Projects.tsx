import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Music2, Plus, Trash2 } from "lucide-react";
import { api, duree, type Projet } from "../api";
import { Alerte, Titre } from "../components/ui";

function Etat({ p }: { p: Projet }) {
  const s = p.statut;
  if (s.statut === "en_cours")
    return <span className="inline-flex items-center gap-1.5 text-xs text-plum-300"><Loader2 size={13} className="animate-spin" />{s.etape} · {s.progression} %</span>;
  if (s.statut === "echec") return <span className="text-xs text-rose-300">Échec de l'analyse</span>;
  return <span className="text-xs text-mist">Analyse terminée</span>;
}

export default function Projects() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["projets"], queryFn: api.projets,
    refetchInterval: (x) => (x.state.data?.some((p) => p.statut.statut === "en_cours") ? 1000 : false),
  });
  const del = useMutation({ mutationFn: api.supprimer, onSuccess: () => qc.invalidateQueries({ queryKey: ["projets"] }) });
  const ps = q.data ?? [];
  const finis = ps.filter((p) => p.resume);
  const stats = [
    ["Projets", ps.length],
    ["Analyses terminées", finis.length],
    ["Notes transcrites", finis.reduce((a, p) => a + p.resume!.notes, 0)],
    ["Audio analysé", duree(finis.reduce((a, p) => a + p.resume!.duree_s, 0))],
  ] as const;

  return (
    <div className="rise">
      <Titre sur="Tableau de bord" actions={<a href="#/nouveau" className="btn btn-gold"><Plus size={17} />Nouveau projet</a>}>
        Vos projets
      </Titre>
      {q.error && <Alerte tone="error">{(q.error as Error).message}</Alerte>}
      {del.error && <div className="mb-4"><Alerte tone="error">{(del.error as Error).message}</Alerte></div>}

      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {stats.map(([k, v]) => (
          <div key={k} className="panel px-4 py-3.5">
            <dt className="label">{k}</dt>
            <dd className="font-display text-3xl mt-1 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {q.isLoading ? (
        <p className="text-mist flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Chargement…</p>
      ) : ps.length === 0 && !q.error ? (
        <div className="panel px-6 py-14 text-center">
          <Music2 className="mx-auto text-plum-400" size={34} />
          <h2 className="font-display text-2xl mt-4">Aucun projet pour l'instant</h2>
          <p className="text-mist mt-2 max-w-md mx-auto">Importez un enregistrement ou chantez dans le micro : tonalité, tempo, accords et mélodie sont extraits, puis corrigeables note par note.</p>
          <a href="#/nouveau" className="btn btn-gold mt-6"><Plus size={17} />Créer le premier projet</a>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ps.map((p) => (
            <li key={p.id} className="panel relative group hover:border-plum-500 transition-colors">
              <a href={`#/projet/${p.id}`} className="block px-5 py-4 pr-12">
                <h2 className="font-display text-xl truncate">{p.titre}</h2>
                <p className="text-xs text-mist/70 truncate mt-0.5">{p.fichier} · {new Date(p.cree_le * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</p>
                {p.resume ? (
                  <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span><span className="text-gold-400">{p.resume.tonalite}</span></span>
                    <span className="tabular-nums">{p.resume.bpm ?? "—"} BPM</span>
                    <span className="tabular-nums text-mist">{duree(p.resume.duree_s)}</span>
                    <span className="tabular-nums text-mist">{p.resume.notes} notes</span>
                  </p>
                ) : <p className="mt-4 text-sm text-mist/60">—</p>}
                <div className="mt-2"><Etat p={p} /></div>
              </a>
              <button aria-label={`Supprimer ${p.titre}`} disabled={del.isPending}
                onClick={() => confirm(`Supprimer définitivement « ${p.titre} » et ses fichiers ?`) && del.mutate(p.id)}
                className="absolute top-3 right-3 p-2 rounded-lg text-mist/60 hover:text-rose-300 hover:bg-night-700">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
