// Ruta API -- listado de observaciones Lead time de una cadena. Mismo
// patron que src/app/api/kpis/otif/observaciones/route.ts (RF-K6,
// paginacion y `select` explicitos).
//
// requireSession() (cualquier rol) -- lectura, no declaracion (mismo
// criterio que OTIF: la restriccion a ADMINISTRADOR solo aplica a
// previsualizar/confirmar). tenantClient(empresaId) ya acota el
// resultado al tenant de la sesion (RNF1 capa 1).
import { NextResponse } from "next/server";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";

export const runtime = "nodejs";

/** Mismos valores que OTIF (LIMITE_LISTADO_OTIF_PREDETERMINADO/MAXIMO) --
 * ningun precedente propio de Lead time que justifique un numero
 * distinto todavia. */
const LIMITE_LISTADO_LEAD_TIME_PREDETERMINADO = 50;
const LIMITE_LISTADO_LEAD_TIME_MAXIMO = 200;

interface LimitesPaginacion {
  porDefecto: number;
  minimo: number;
  maximo: number;
}

/** Entero estricto dentro de [minimo, maximo] -- mismo criterio que la
 * ruta equivalente de OTIF: ausente devuelve `porDefecto`; presente pero
 * invalido devuelve null (DATOS_INVALIDOS explicito, nunca se clampea en
 * silencio). */
function parsearParametroEntero(valor: string | null, limites: LimitesPaginacion): number | null {
  if (valor === null) return limites.porDefecto;
  if (!/^\d+$/.test(valor)) return null;
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < limites.minimo || n > limites.maximo) return null;
  return n;
}

export async function GET(request: Request) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const { searchParams } = new URL(request.url);
  const cadenaId = searchParams.get("cadenaId");
  if (!cadenaId) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const limite = parsearParametroEntero(searchParams.get("limit"), {
    porDefecto: LIMITE_LISTADO_LEAD_TIME_PREDETERMINADO,
    minimo: 1,
    maximo: LIMITE_LISTADO_LEAD_TIME_MAXIMO,
  });
  const pagina = parsearParametroEntero(searchParams.get("page"), { porDefecto: 1, minimo: 1, maximo: 1_000_000 });
  if (limite === null || pagina === null) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const cliente = tenantClient(sesion.empresaId);
  const where = { cadenaId, definicionKpi: { codigo: "LEAD_TIME" } };
  const select = {
    id: true,
    cadenaId: true,
    periodoInicio: true,
    periodoFin: true,
    valor: true,
    numerador: true,
    denominador: true,
    fuente: true,
    estado: true,
    ruleVersion: true,
    createdAt: true,
  };

  // Mismos desempates DETERMINISTAS que OTIF (createdAt desc, id desc).
  const orderBy = [{ periodoInicio: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }];

  const [observaciones, total] = await Promise.all([
    cliente.observacionKpi.findMany({
      where,
      orderBy,
      skip: (pagina - 1) * limite,
      take: limite,
      select,
    }),
    cliente.observacionKpi.count({ where }),
  ]);

  return NextResponse.json({
    ok: true,
    observaciones,
    paginacion: { page: pagina, limit: limite, total },
  });
}
