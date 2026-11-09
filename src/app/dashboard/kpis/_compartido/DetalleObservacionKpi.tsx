// Componente (servidor) -- detalle duradero de UNA ObservacionKpi ya
// persistida. Incremento 4 PR1 (Alex, 2026-11-06): compartido por OTIF y
// Fill Rate (los unicos 2 codigos habilitados, ver esCodigoConDetalleHabilitado()
// en src/infra/kpis/estadoVisualizacion.ts) para no duplicar la consulta
// ni el render entre kpis/otif/observaciones/[id]/page.tsx y
// kpis/fill-rate/observaciones/[id]/page.tsx -- cada uno es un wrapper de
// unas pocas lineas que solo fija `codigo`.
//
// Carpeta con guion bajo (mismo patron ya usado en este repo por
// src/app/plataforma/_mfa): Next.js App Router no la trata como un
// segmento de ruta, asi que este archivo nunca queda expuesto como
// pagina propia.
//
// Reutiliza exactamente lo mismo que ya usan kpis/otif/page.tsx y
// kpis/fill-rate/page.tsx -- requireAdminOrRedirect() (mismo rol exigido
// que el historial del que viene el enlace) y tenantClient() (mismo
// aislamiento de tenant, capa 1 RNF1) -- no se agrega ningun mecanismo de
// autorizacion o de alcance de tenant nuevo.
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { clasificarValorObservacionKpi, esCodigoConDetalleHabilitado } from "@/infra/kpis/estadoVisualizacion";

type CodigoHabilitado = "OTIF" | "FILL_RATE";

const RUTA_HISTORIAL: Record<CodigoHabilitado, string> = {
  OTIF: "/dashboard/kpis/otif",
  FILL_RATE: "/dashboard/kpis/fill-rate",
};

const ETIQUETA_ESTADO_DATO: Record<string, string> = {
  DECLARADO: "Declarado",
  INFERIDO: "Inferido",
  VERIFICADO: "Verificado",
};

function formatearFechaHora(fecha: Date): string {
  return fecha.toLocaleString("es-PE", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit" });
}

// `unidad` viene de DefinicionKpi.unidad -- hoy siempre "%" para OTIF y
// Fill Rate (ver prisma/seedDefinicionesKpi.ts), pero esta funcion no lo
// asume: si unidad no es "%", muestra el numero crudo con la unidad al
// lado, para que un futuro KPI con otra unidad (ej. "días") no quede mal
// formateado por accidente.
function formatearValorConUnidad(valor: number, unidad: string): string {
  if (unidad === "%") return `${(valor * 100).toFixed(1)}%`;
  return `${valor.toFixed(2)} ${unidad}`;
}

export default async function DetalleObservacionKpi({ codigo, id }: { codigo: CodigoHabilitado; id: string }) {
  if (!esCodigoConDetalleHabilitado(codigo)) {
    // Defensivo -- hoy solo los 2 wrappers de OTIF/Fill Rate llaman a
    // este componente con un codigo fijo en el propio codigo fuente, asi
    // que esto nunca deberia dispararse en producción; existe para que un
    // futuro wrapper de uno de los 7 KPIs sin flujo completo no quede
    // expuesto por accidente antes de construirle su propia pagina.
    notFound();
  }

  const sesion = await requireAdminOrRedirect();
  const client = tenantClient(sesion.empresaId);

  // findFirst (no findUnique) a proposito: permite combinar el id con el
  // filtro de `definicionKpi.codigo` en el mismo WHERE sin pelear con la
  // restriccion de Prisma de que un findUnique solo acepte columnas de
  // una clave unica real -- el aislamiento de tenant lo sigue agregando
  // tenantClient() (injectTenantFilter, src/infra/prisma/tenantScope.ts)
  // exactamente igual que en cualquier otra consulta de este archivo, sin
  // ningun mecanismo nuevo.
  const observacion = await client.observacionKpi.findFirst({
    where: { id, definicionKpi: { codigo } },
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
        <Link href={RUTA_HISTORIAL[codigo]} className="text-sm text-slate-500 underline">
          ← Volver a {observacion.definicionKpi.nombre}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {observacion.definicionKpi.nombre} — {observacion.cadena.nombre}
        </h1>
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
        Verlos de forma duradera requeriría agregar esas columnas al esquema -- fuera del alcance de este cambio, sin
        una migración autorizada.
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
          <p className="text-slate-500">Versión de regla</p>
          <p>{observacion.ruleVersion}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Esta observación se calculó y persistió de forma síncrona al confirmarla -- no existe, para este KPI, un paso
        de procesamiento asíncrono separado (sin cola de trabajos de por medio), así que no aplican aquí los estados
        de &quot;procesamiento pendiente&quot; ni &quot;procesamiento con errores&quot;.
      </p>
    </main>
  );
}
