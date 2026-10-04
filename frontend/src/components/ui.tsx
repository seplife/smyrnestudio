import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

/** Jauge de confiance : la couleur ET le pourcentage portent l'information. */
export function Confiance({ v, compact }: { v: number; compact?: boolean }) {
  const pct = Math.round(v * 100);
  const tone = v >= 0.7 ? "bg-plum-400" : v >= 0.45 ? "bg-gold-400" : "bg-rose-400";
  const mot = v >= 0.7 ? "fiable" : v >= 0.45 ? "à vérifier" : "incertain";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-mist" title={`Confiance ${pct} %`}>
      <span className="h-1.5 w-14 rounded-full bg-night-700 overflow-hidden" aria-hidden>
        <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">{pct} %</span>
      {!compact && <span className="text-mist/70">· {mot}</span>}
    </span>
  );
}

export function Alerte({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "error" }) {
  const c = tone === "error" ? "border-rose-400/40 bg-rose-400/10 text-rose-100" : "border-gold-400/30 bg-gold-400/10 text-gold-300";
  return (
    <div role={tone === "error" ? "alert" : "note"} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${c}`}>
      <AlertTriangle size={17} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Titre({ sur, children, actions }: { sur?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {sur && <p className="label mb-1">{sur}</p>}
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight break-words">{children}</h1>
      </div>
      {actions}
    </header>
  );
}
