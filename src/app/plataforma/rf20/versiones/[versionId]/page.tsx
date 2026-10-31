// Pagina — RF20 (PR 8): area de edicion de una version (metadata,
// preguntas, publicar/retirar). Server Component, lectura directa via
// obtenerDetalleVersion()/listarVersionesPorCodigo() (sin pasar por la
// API propia). El gating de "editable"/panel de admin aqui es solo UX
// -- la unica barrera real son las funciones SECURITY DEFINER, que cada
// ruta ya invoca.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSesionPlataformaOrRedirect } from "@/infra/auth/sessionPlataforma";
import { listarVersionesPorCodigo, obtenerDetalleVersion } from "@/infra/rf20/consultas";
import MetadataForm from "./MetadataForm";
import PreguntasEditor from "./PreguntasEditor";
import PublicarRetirarPanel from "./PublicarRetirarPanel";

export default async function VersionEditorPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const sesion = await requireSesionPlataformaOrRedirect();
  const { versionId } = await params;

  const version = await obtenerDetalleVersion(versionId);
  if (!version) notFound();

  const hermanas = await listarVersionesPorCodigo(version.codigo);
  const versionVigenteActualId = hermanas.find((v) => v.estado === "PUBLICADA")?.id ?? null;
  const editable = version.estado === "BORRADOR";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-12">
      <div>
        <Link
          href={`/plataforma/rf20/cuestionarios/${encodeURIComponent(version.codigo)}`}
          className="text-sm text-slate-500 underline"
        >
          ← Historial de {version.codigo}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {version.codigo} — v{version.numero}{" "}
          <span className="text-base font-normal text-slate-500">({version.estado})</span>
        </h1>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-700">Metadata</h2>
        <MetadataForm versionId={version.id} notasCambioInicial={version.notasCambio} editable={editable} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-700">Preguntas</h2>
        <PreguntasEditor versionId={version.id} preguntas={version.preguntas} editable={editable} />
      </section>

      {sesion.rol === "ADMINISTRADOR_PLATAFORMA" && (
        <section>
          <PublicarRetirarPanel
            versionId={version.id}
            estado={version.estado}
            versionVigenteActualId={versionVigenteActualId}
          />
        </section>
      )}
    </main>
  );
}
