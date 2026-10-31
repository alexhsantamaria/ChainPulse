// Pagina — RF20 (PR 8): historial de versiones de un codigo. Server
// Component, lectura directa via listarVersionesPorCodigo() (sin pasar
// por la API propia).
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSesionPlataformaOrRedirect } from "@/infra/auth/sessionPlataforma";
import { listarVersionesPorCodigo } from "@/infra/rf20/consultas";
import CorregirVersionBoton from "./CorregirVersionBoton";

const ESTADO_ESTILO: Record<string, string> = {
  BORRADOR: "text-amber-700",
  PUBLICADA: "text-emerald-700",
  RETIRADA: "text-slate-400",
};

export default async function HistorialVersionesPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  await requireSesionPlataformaOrRedirect();
  const { codigo } = await params;
  const versiones = await listarVersionesPorCodigo(codigo);
  if (versiones.length === 0) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/plataforma/rf20/cuestionarios" className="text-sm text-slate-500 underline">
          ← Todos los códigos
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-semibold">{codigo}</h1>
        <p className="text-sm text-slate-500">
          {versiones.length} versión{versiones.length === 1 ? "" : "es"}
        </p>
      </div>

      <div className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
        {versiones.map((v) => (
          <div key={v.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">
                v{v.numero} —{" "}
                <span className={ESTADO_ESTILO[v.estado] ?? ""}>{v.estado}</span>
              </p>
              <p className="text-sm text-slate-500">
                {v.totalPreguntas} pregunta{v.totalPreguntas === 1 ? "" : "s"}
                {v.publicadaEn && ` · publicada ${new Date(v.publicadaEn).toLocaleString()}`}
                {v.retiradaEn && ` · retirada ${new Date(v.retiradaEn).toLocaleString()}`}
              </p>
              {v.notasCambio && <p className="mt-1 text-sm text-slate-600">{v.notasCambio}</p>}
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/plataforma/rf20/versiones/${v.id}`}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-400"
              >
                Abrir
              </Link>
              <CorregirVersionBoton versionId={v.id} />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
