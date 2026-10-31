// Pagina — RF20 (PR 8): lista de cuestionarios por codigo. Server
// Component, lectura directa via listarCuestionarios() (mismo patron que
// dashboard/page.tsx: Server Components leen con el ORM/consultas.ts
// directo, nunca haciendo fetch a su propia API).
import Link from "next/link";
import { requireSesionPlataformaOrRedirect } from "@/infra/auth/sessionPlataforma";
import { listarCuestionarios } from "@/infra/rf20/consultas";
import CrearCuestionarioForm from "./CrearCuestionarioForm";

export default async function CuestionariosPage() {
  const sesion = await requireSesionPlataformaOrRedirect();
  const cuestionarios = await listarCuestionarios();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Cuestionarios (RF20)</h1>
        <p className="text-sm text-slate-500">
          Sesión: {sesion.usuarioId} · {sesion.rol}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-slate-700">Nuevo código</h2>
        <CrearCuestionarioForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-slate-700">Códigos existentes</h2>
        {cuestionarios.length === 0 && (
          <p className="text-sm text-slate-500">
            Todavía no hay ningún código de cuestionario declarado.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cuestionarios.map((c) => (
            <Link
              key={c.codigo}
              href={`/plataforma/rf20/cuestionarios/${encodeURIComponent(c.codigo)}`}
              className="rounded border border-slate-200 p-4 hover:border-slate-400"
            >
              <p className="font-mono text-sm text-slate-500">{c.codigo}</p>
              <p className="mt-1 text-sm text-slate-600">
                {c.totalVersiones} versión{c.totalVersiones === 1 ? "" : "es"} · última: v{c.ultimaVersion.numero} (
                {c.ultimaVersion.estado})
              </p>
              {c.versionPublicada ? (
                <p className="mt-1 text-sm text-emerald-700">
                  Publicada: v{c.versionPublicada.numero}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-400">Sin versión publicada</p>
              )}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
