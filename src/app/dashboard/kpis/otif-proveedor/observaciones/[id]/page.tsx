// Pagina -- detalle duradero de UNA ObservacionOtifProveedor ya
// persistida. Incremento 5 PR3 (Alex, 2026-11-18).
//
// Deliberadamente NO delega en kpis/_compartido/DetalleObservacionKpi.tsx
// -- ese componente es generico solo para los 2 codigos de
// ObservacionKpi habilitados por esCodigoConDetalleHabilitado()
// (src/infra/kpis/estadoVisualizacion.ts: "la UNICA puerta que decide
// que codigo puede abrir la pagina de detalle generica, para que una
// futura adicion de KPI no quede expuesta por accidente antes de
// construirle su propio flujo completo"). ObservacionOtifProveedor es
// una TABLA DISTINTA (no ObservacionKpi: tiene proveedorAliasClave en su
// identidad y no tiene relacion con AccionDecisionKpi ni con el
// historico/analisis de tendencia construido para ObservacionKpi) --
// extender ese componente para soportar dos esquemas distintos esta
// fuera del alcance de PR3 (Alex no pidio analisis de tendencia ni
// acciones de decision para este catalogo, ver los 20 puntos de
// autorizacion). Esta pagina reutiliza SOLO lo que es realmente generico:
// requireAdminOrRedirect() (mismo rol exigido que el historial del que
// viene el enlace), tenantClient() (mismo aislamiento de tenant, RNF1
// capa 1), clasificarValorObservacionKpi() (pura, ya generica sobre
// `valor: number | null`) y el mismo criterio de formatearFecha() con
// timeZone: "UTC" para periodoInicio/periodoFin date-only (correccion de
// validacion real en Windows, 2026-11-16 -- nunca repetir ese error).
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { clasificarValorObservacionKpi } from "@/infra/kpis/estadoVisualizacion";

const ETIQUETA_ESTADO_DATO: Record<string, string> = {
  DECLARADO: "Declarado",
  INFERIDO: "Inferido",
  VERIFICADO: "Verificado",
};

function formatearFechaHora(fecha: Date): string {
  return fecha.toLocaleString("es-PE", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Mismo criterio que DetalleObservacionKpi.tsx/kpis/otif/page.tsx:
// periodoInicio/periodoFin son date-only, persistidas a medianoche UTC
// exacta (parsearFechaCalendarioEstricta(), src/infra/kpis/otif/declarar.ts)
// -- timeZone: "UTC" evita que una zona de offset negativo muestre un
// dia calendario antes. createdAt/updatedAt son timestamps reales y usan
// formatearFechaHora() (zona local del que mira la pantalla), nunca esta
// funcion.
function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

// `unidad` de DefinicionKpi.unidad -- mismo criterio que
// DetalleObservacionKpi.tsx: no se asume "%" a ciegas, aunque hoy
// OTIF_PROVEEDOR siempre lo use (ver prisma/seedDefinicionesKpi.ts).
function formatearValorConUnidad(valor: number, unidad: string): string {
  if (unidad === "%") return `${(valor * 100).toFixed(1)}%`;
  return `${valor.toFixed(2)} ${unidad}`;
}

export default async function DetalleObservacionOtifProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await requireAdminOrRedirect();
  const client = tenantClient(sesion.empresaId);

  // findFirst (no findUnique) -- mismo motivo que DetalleObservacionKpi.tsx:
  // combina `id` con el filtro de `definicionKpi.codigo` en el mismo
  // WHERE. El aislamiento de tenant lo agrega tenantClient()
  // (injectTenantFilter, src/infra/prisma/tenantScope.ts) igual que en
  // cualquier otra consulta de esta pagina.
  const observacion = await client.observacionOtifProveedor.findFirst({
    where: { id, definicionKpi: { codigo: "OTIF_PROVEEDOR" } },
    include: {
      cadena: { select: { nombre: true } },
      definicionKpi: { select: { nombre: true, formula: true, unidad: true } },
    },
  });

  if (!observacion) {
    notFound();
  }

  const estadoVisual = clasificarValorObservacionKpi(observacion.valor);
  const unidad = observacion.definicionKpi.unidad;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard/kpis/otif-proveedor" className="text-sm text-slate-500 underline">
          ← Volver a {observacion.definicionKpi.nombre}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {observacion.definicionKpi.nombre} — {observacion.cadena.nombre}
        </h1>
        <p className="text-sm text-slate-600">
          Proveedor: <span className="font-medium">{observacion.proveedorAlias}</span>
        </p>
        <p className="text-sm text-slate-600">
          {formatearFecha(observacion.periodoInicio)} – {formatearFecha(observacion.periodoFin)}
        </p>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Fórmula</p>
        <p className="text-sm">{observacion.definicionKpi.formula}</p>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Valor</p>
        {estadoVisual === "SIN_DATOS" ? (
          <>
            <p className="text-3xl font-semibold text-slate-400">--</p>
            <p className="mt-2 text-xs text-amber-700">
              Sin datos suficientes: no hubo ninguna fila evaluable al confirmar esta observación. No es un valor de
              cero -- es la ausencia de un resultado calculable.
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl font-semibold">{formatearValorConUnidad(observacion.valor as number, unidad)}</p>
            {estadoVisual === "CERO_REAL" && (
              <p className="mt-2 text-xs text-amber-700">
                Este valor es 0 porque ninguna fila evaluada cumplió el criterio del KPI en este período -- es un
                resultado real, no una ausencia de datos.
              </p>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Numerador</p>
          <p className="text-lg">{observacion.numerador === null ? "--" : observacion.numerador}</p>
        </div>
        <div className="rounded border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Denominador</p>
          <p className="text-lg">{observacion.denominador === null ? "--" : observacion.denominador}</p>
        </div>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        Filas evaluadas/excluidas y las advertencias del cálculo no están disponibles aquí: esos datos solo existen
        de forma transitoria durante la previsualización y la confirmación (no se persisten en esta tabla hoy).
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-500">Estado del dato</p>
          <p>{ETIQUETA_ESTADO_DATO[observacion.estado] ?? observacion.estado}</p>
        </div>
        <div>
          <p className="text-slate-500">Fuente</p>
          <p>{observacion.fuente}</p>
        </div>
        <div>
          <p className="text-slate-500">Declarada el</p>
          <p>{formatearFechaHora(observacion.createdAt)}</p>
        </div>
        <div>
          <p className="text-slate-500">Última actualización</p>
          <p>{formatearFechaHora(observacion.updatedAt)}</p>
        </div>
        <div>
          <p className="text-slate-500">Versión de regla</p>
          <p>{observacion.ruleVersion}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Esta observación se calculó y persistió de forma síncrona al confirmarla -- no existe, para este KPI, un paso
        de procesamiento asíncrono separado (sin cola de trabajos de por medio), así que no aplican aquí los estados
        de &quot;procesamiento pendiente&quot; ni &quot;procesamiento con errores&quot;. Reconfirmar este mismo
        proveedor y período desde otra fuente actualiza esta misma observación (nunca crea una segunda).
      </p>
    </main>
  );
}
