// Pagina -- importador de Cobertura por CSV (Incremento 4 Bloque B,
// vertical slice de un solo KPI antes de generalizar a los otros 9).
// Solo ADMINISTRADOR (mismo criterio que la ruta API -- ver
// api/kpis/cobertura/importaciones/route.ts: escribe datos de negocio
// sensibles de forma masiva).
//
// Server Component: resuelve las cadenas de la empresa (para el select
// del paso 1) y el historial de importaciones ya existentes, y se los
// pasa al asistente cliente -- mismo patron que cadenas/[id]/page.tsx
// ("Server Component solo resuelve datos iniciales").
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import ImportadorCoberturaWizard from "./ImportadorCoberturaWizard";

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDIENTE_REVISION: "Pendiente de revisión",
  CONFIRMADA: "Confirmada",
  DESCARTADA: "Descartada",
  ERROR: "Error",
};

function formatearFechaHora(fecha: Date): string {
  return fecha.toLocaleString("es-PE", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function ImportadorCoberturaPage() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }
  if (session.user.rol !== "ADMINISTRADOR") {
    redirect("/dashboard");
  }

  const client = tenantClient(session.user.empresaId);
  const [cadenas, importaciones] = await Promise.all([
    client.cadena.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, nombre: true } }),
    client.importacionCsv.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { cadena: { select: { nombre: true } } },
    }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 underline">
          ← Volver al panel
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Importar Cobertura por CSV</h1>
        <p className="text-sm text-slate-600">
          Subí un archivo, revisá cómo se va a interpretar y confirmá -- el cálculo de Cobertura corre en segundo plano tras
          confirmar.
        </p>
      </div>

      {cadenas.length === 0 ? (
        <p className="text-sm text-slate-500">
          Todavía no declaraste ninguna cadena.{" "}
          <Link href="/dashboard/cadenas" className="underline">
            Declará una cadena primero
          </Link>
          .
        </p>
      ) : (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
        <ImportadorCoberturaWizard cadenas={cadenas as any} />
      )}

      <div>
        <h2 className="mb-2 font-medium">Historial reciente</h2>
        {importaciones.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay ninguna importación.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003) */}
            {importaciones.map((imp: any) => (
              <li key={imp.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{imp.cadena.nombre}</p>
                  <p className="text-xs text-slate-500">
                    Subida {formatearFechaHora(imp.createdAt)} · {imp.filasDetectadas}{" "}
                    {imp.filasDetectadas === 1 ? "fila" : "filas"}
                    {imp.filasConError > 0 && ` · ${imp.filasConError} con error`}
                  </p>
                </div>
                <span
                  className={
                    "self-start rounded px-2 py-1 text-xs font-medium sm:self-center " +
                    (imp.estado === "ERROR"
                      ? "bg-red-100 text-red-700"
                      : imp.estado === "CONFIRMADA" && imp.procesadaEn
                        ? "bg-emerald-100 text-emerald-700"
                        : imp.estado === "CONFIRMADA"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-600")
                  }
                >
                  {imp.estado === "CONFIRMADA" && !imp.procesadaEn
                    ? "Confirmada, procesando"
                    : imp.estado === "CONFIRMADA" && imp.procesadaEn
                      ? "Procesada"
                      : ETIQUETA_ESTADO[imp.estado] ?? imp.estado}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
