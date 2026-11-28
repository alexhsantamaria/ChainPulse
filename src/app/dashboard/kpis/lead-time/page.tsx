// Pagina -- declaracion de observaciones Lead time, nivel 1 (manual, un
// promedio ya calculado) y nivel 2 (pegado tabular por proceso).
// Incremento 5 (Alex, 2026-11-27/28), primer KPI activado de los seis
// pendientes. Mismo patron que kpis/fill-rate/page.tsx y
// kpis/otif/page.tsx.
//
// Solo ADMINISTRADOR durante el piloto -- mismo criterio que el resto
// del catalogo: requireAdminOrRedirect().
//
// Server Component: resuelve las cadenas de la empresa (para el select
// del paso 1) y el historial de observaciones Lead time ya declaradas, y
// se los pasa al asistente cliente -- mismo patron que
// kpis/fill-rate/page.tsx.
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import DeclaracionLeadTimeWizard from "./DeclaracionLeadTimeWizard";

/** Mismo patron de formatearFecha() que DetalleObservacionKpi.tsx y las
 * paginas hermanas de OTIF/Fill Rate (periodoInicio/periodoFin son
 * date-only, persistidas a medianoche UTC exacta -- ver
 * parsearFechaCalendarioEstricta() en infra/kpis/leadTime/declarar.ts).
 * timeZone: "UTC" evita el defecto ya corregido en Fill Rate/OTIF (2026-
 * 11-16): sin esto, en una zona de offset negativo (ej. America/Lima) la
 * medianoche UTC se muestra un dia antes en hora local. */
function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

function formatearDias(valor: number | null): string {
  if (valor === null) return "--";
  return `${valor.toFixed(1)} días`;
}

export default async function DeclaracionLeadTimePage() {
  const sesion = await requireAdminOrRedirect();

  const client = tenantClient(sesion.empresaId);
  const [cadenas, observaciones] = await Promise.all([
    client.cadena.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, nombre: true } }),
    client.observacionKpi.findMany({
      where: { definicionKpi: { codigo: "LEAD_TIME" } },
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
        <h1 className="mt-2 text-2xl font-semibold">Declarar Lead time (piloto)</h1>
        <p className="text-sm text-slate-600">
          Declará una observación de Lead time a mano (un promedio en días ya calculado) o pegando una tabla de
          procesos (inicio/fin) -- se calcula en el servidor y se previsualiza antes de confirmar. Los procesos
          repetidos exactamente dentro de la misma carga se marcan con una advertencia que no bloquea la
          confirmación.
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
        <DeclaracionLeadTimeWizard cadenas={cadenas} />
      )}

      <div>
        <h2 className="mb-2 font-medium">Historial reciente</h2>
        {observaciones.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay ninguna observación Lead time declarada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
            {observaciones.map((obs) => (
              <li key={obs.id}>
                <Link
                  href={`/dashboard/kpis/lead-time/observaciones/${obs.id}`}
                  className="flex flex-col gap-1 px-4 py-3 text-sm hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{obs.cadena.nombre}</p>
                    <p className="text-xs text-slate-500">
                      {formatearFecha(obs.periodoInicio)} – {formatearFecha(obs.periodoFin)} · {obs.fuente}
                    </p>
                  </div>
                  <span className="self-start rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 sm:self-center">
                    Lead time: {formatearDias(obs.valor)} · Ver detalle →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
