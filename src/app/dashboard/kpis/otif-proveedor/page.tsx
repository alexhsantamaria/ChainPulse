// Pagina -- declaracion de observaciones OTIF Proveedor, nivel 1
// (manual, un proveedor) y nivel 2 (pegado tabular, varios proveedores
// en la misma tabla). Incremento 5 PR3 (Alex, 2026-11-18). Mismo patron
// que kpis/otif/page.tsx: requireAdminOrRedirect() (piloto, solo
// ADMINISTRADOR puede declarar -- RF-K6 de lectura no distingue rol,
// pero esta pagina es la de DECLARAR).
//
// Server Component: resuelve las cadenas de la empresa (para el select
// del paso 1) y el historial de observaciones OTIF Proveedor ya
// declaradas, y se los pasa al asistente cliente.
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import DeclaracionOtifProveedorWizard from "./DeclaracionOtifProveedorWizard";

/** Mismo criterio que kpis/otif/page.tsx (correccion de validacion real
 * en Windows, 2026-11-16): periodoInicio/periodoFin son date-only,
 * persistidas a medianoche UTC exacta -- timeZone: "UTC" evita que una
 * zona de offset negativo muestre un dia calendario antes. */
function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

function formatearPorcentaje(valor: number | null): string {
  if (valor === null) return "--";
  return `${(valor * 100).toFixed(1)}%`;
}

export default async function DeclaracionOtifProveedorPage() {
  const sesion = await requireAdminOrRedirect();

  const client = tenantClient(sesion.empresaId);
  const [cadenas, observaciones] = await Promise.all([
    client.cadena.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, nombre: true } }),
    client.observacionOtifProveedor.findMany({
      where: { definicionKpi: { codigo: "OTIF_PROVEEDOR" } },
      orderBy: [{ periodoInicio: "desc" }, { createdAt: "desc" }, { id: "desc" }],
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
        <h1 className="mt-2 text-2xl font-semibold">Declarar OTIF Proveedor (piloto)</h1>
        <p className="text-sm text-slate-600">
          Declará una observación de OTIF por proveedor a mano (un proveedor por vez) o pegando una tabla de pedidos
          que puede mezclar varios proveedores -- se calcula en el servidor, agrupado por proveedor, y se previsualiza
          antes de confirmar.
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
        <DeclaracionOtifProveedorWizard cadenas={cadenas} />
      )}

      <div>
        <h2 className="mb-2 font-medium">Historial reciente</h2>
        {observaciones.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay ninguna observación OTIF Proveedor declarada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
            {observaciones.map((obs: (typeof observaciones)[number]) => (
              <li key={obs.id}>
                <Link
                  href={`/dashboard/kpis/otif-proveedor/observaciones/${obs.id}`}
                  className="flex flex-col gap-1 px-4 py-3 text-sm hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">
                      {obs.cadena.nombre} · {obs.proveedorAlias}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatearFecha(obs.periodoInicio)} – {formatearFecha(obs.periodoFin)} · {obs.fuente}
                    </p>
                  </div>
                  <span className="self-start rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 sm:self-center">
                    OTIF: {formatearPorcentaje(obs.valor)} · Ver detalle →
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
