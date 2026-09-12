// Incremento 1: punto de entrada temporal. RF11 (evaluacion expres publica)
// y el flujo de cuenta completa (RF1 y siguientes) se construyen como
// rutas propias — ver requirements.md Seccion 4 y 4bis.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-semibold">ChainPulse</h1>
      <p className="text-slate-600">
        Scaffolding del Incremento 1 en construccion. Ver{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5">requirements.md</code> (Secciones
        9-12) y <code className="rounded bg-slate-100 px-1.5 py-0.5">docs/ADR</code> para el
        alcance aprobado.
      </p>
    </main>
  );
}
