// Pagina de inicio — punto de entrada publico de ChainPulse.
// RF11 (evaluacion expres publica) ya tiene ruta propia (/evaluacion,
// ver src/app/evaluacion/**); el flujo de cuenta completa (RF1 y
// siguientes) sigue como scaffolding pendiente -- ver requirements.md
// Seccion 4 y 4bis, y docs/ADR.
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold">ChainPulse</h1>
      <p className="text-slate-600">
        Detecta dónde existe descoordinación en tu cadena de suministro e identifica qué mejorar
        primero.
      </p>
      <Link
        href="/evaluacion"
        className="rounded bg-slate-900 px-6 py-3 text-sm font-medium text-white"
      >
        Comenzar evaluación gratuita
      </Link>
      <p className="text-xs text-slate-400">
        Sin crear cuenta. Ver <code className="rounded bg-slate-100 px-1.5 py-0.5">requirements.md</code>{" "}
        (Secciones 9-12) y <code className="rounded bg-slate-100 px-1.5 py-0.5">docs/ADR</code> para el
        alcance aprobado.
      </p>
    </main>
  );
}
