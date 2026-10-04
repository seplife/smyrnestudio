import { useEffect, useState } from "react";
import { LayoutDashboard, PlusCircle } from "lucide-react";
import Projects from "./pages/Projects";
import NewProject from "./pages/NewProject";
import Project from "./pages/Project";

function useRoute() {
  const [h, setH] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const f = () => setH(location.hash.slice(1) || "/");
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return h;
}
export const go = (p: string) => { location.hash = p; };

const NAV = [
  { to: "/", label: "Projets", icon: LayoutDashboard },
  { to: "/nouveau", label: "Nouveau projet", icon: PlusCircle },
];
const A_VENIR = ["Séparation des voix", "Arrangement choral", "Lead et chœurs", "Partitions PDF", "Studio multipiste"];

function Logo() {
  return (
    <a href="#/" className="flex items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
        <rect width="34" height="34" rx="9" fill="#1b2450" />
        {[9, 14, 19, 24].map((x, i) => (
          <rect key={x} x={x} y={[13, 8, 11, 15][i]} width="2.6" height={[10, 18, 13, 6][i]} rx="1.3" fill={i === 1 ? "#e3b653" : "#9b82f0"} />
        ))}
      </svg>
      <span className="font-display text-lg leading-none tracking-tight">
        Choir <span className="text-gold-400">AI</span> Studio
      </span>
    </a>
  );
}

export default function App() {
  const route = useRoute();
  const m = route.match(/^\/projet\/([\w-]+)/);
  const page = m ? <Project id={m[1]} key={m[1]} /> : route === "/nouveau" ? <NewProject /> : <Projects />;
  return (
    <div className="min-h-full md:grid md:grid-cols-[230px_1fr]">
      <aside className="md:h-screen md:sticky md:top-0 border-b md:border-b-0 md:border-r border-night-700 bg-night-900 px-4 py-4 md:py-6 flex md:flex-col items-center md:items-stretch justify-between md:justify-start gap-4 md:gap-8">
        <Logo />
        <nav className="flex md:flex-col gap-1" aria-label="Navigation principale">
          {NAV.map(({ to, label, icon: Icon }) => {
            const on = route === to;
            return (
              <a key={to} href={`#${to}`} aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${on ? "bg-night-700 text-white" : "text-mist hover:text-white hover:bg-night-800"}`}>
                <Icon size={17} className={on ? "text-gold-400" : ""} />
                <span className={to === "/" ? "" : "hidden sm:inline"}>{label}</span>
              </a>
            );
          })}
        </nav>
        <div className="hidden md:block mt-auto">
          <p className="label mb-2">Prochains modules</p>
          <ul className="space-y-1.5 text-sm text-mist/70">
            {A_VENIR.map((x) => <li key={x}>{x}</li>)}
          </ul>
          <p className="mt-3 text-xs text-mist/60 leading-snug">Pas encore développés : ils apparaîtront ici une fois fonctionnels.</p>
        </div>
      </aside>
      <main className="px-4 py-6 sm:px-8 sm:py-8 max-w-[1280px] w-full min-w-0">{page}</main>
    </div>
  );
}
