// Pagina -- declaracion de observaciones OTIF, nivel 1 (manual agregado)
// y nivel 2 (pegado tabular). Incremento 4 Bloque B, piloto OTIF (Alex,
// 2026-10-08/09).
//
// Solo ADMINISTRADOR durante el piloto (decision 3) -- mismo criterio que
// kpis/cobertura/page.tsx: requireAdminOrRedirect() en vez de los dos
// chequeos manuales.
//
// Server Component: resuelve las cadenas de la empresa (para el select
// del paso 1) y el historial de observaciones OTIF ya declaradas, y se
// los pasa al asistente cliente -- mismo patron que
// kpis/cobertura/page.tsx.
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import DeclaracionOtifWizard from "./DeclaracionOtifWizard";

function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit" });
}

function formatearPorcentaje(valor: number | null): string {
  if (valor === null) return "--";
  return `${(valor * 100).toFixed(1)}%`;
}

export default async function DeclaracionOtifPage() {
  const sesion = await requireAdminOrRedirect();

  const client = tenantClient(sesion.empresaId);
  const [cadenas, observaciones] = await Promise.all([
    client.cadena.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, nombre: true } }),
    client.observacionKpi.findMany({
      where: { definicionKpi: { codigo: "OTIF" } },
      orderBy: { periodoInicio: "desc" },
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
        <h1 className="mt-2 text-2xl font-semibold">Declarar OTIF (piloto)</h1>
        <p className="text-sm text-slate-600">
          Declará una observación de OTIF a mano (numerador/denominador del período) o pegando una tabla de pedidos -- se
          calcula en el servidor y se previsualiza antes de confirmar.
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
        <DeclaracionOtifWizard cadenas={cadenas} />
      )}

      <div>
        <h2 className="mb-2 font-medium">Historial reciente</h2>
        {observaciones.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay ninguna observación OTIF declarada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
            {observaciones.map((obs) => (
              <li key={obs.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{obs.cadena.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {formatearFecha(obs.periodoInicio)} – {formatearFecha(obs.periodoFin)} · {obs.fuente}
                  </p>
                </div>
                <span className="self-start rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 sm:self-center">
                  OTIF: {formatearPorcentaje(obs.valor)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
