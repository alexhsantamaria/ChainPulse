// Ruta API -- listado de observaciones Fill Rate de una cadena.
// Incremento 4 Bloque B, siguiente KPI despues de OTIF (Alex, 2026-10-14).
// Mismo patron exacto que la ruta equivalente de OTIF
// (src/app/api/kpis/otif/observaciones/route.ts), con
// `definicionKpi.codigo = "FILL_RATE"`.
//
// requireSession() (cualquier rol) -- la lectura de observaciones ya
// confirmadas no esta restringida a ADMINISTRADOR (mismo criterio que
// OTIF, decision 3 solo restringe DECLARAR). tenantClient(empresaId) ya
// acota el resultado al tenant de la sesion -- un cadenaId de otra
// empresa simplemente no matchea ninguna fila, nunca filtra datos de otro
// tenant.
//
// Correccion de Alex 2026-10-14 (antes de autorizar el commit): ademas
// de ese acotamiento implicito, esta ruta ahora valida EXPLICITAMENTE
// que `cadenaId` pertenezca al tenant de la sesion -- mismo mecanismo
// que ya usa persistir.ts en escritura (`tenantClient(empresaId).cadena.findUnique()`),
// con el mismo error estable `CADENA_INEXISTENTE`. Ese gate corre ANTES
// de cualquier consulta a `observacionKpi`: si la cadena no existe para
// este tenant, la ruta nunca llega a tocar esa tabla.
import { NextResponse } from "next/server";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";

export const runtime = "nodejs";

/** 50 -- mismo valor y mismo razonamiento que el listado de OTIF:
 * generoso para una pantalla de listado sin devolver una tabla sin
 * limite. */
const LIMITE_LISTADO_FILL_RATE_PREDETERMINADO = 50;

/** 200 -- mismo techo explicito que OTIF para `?limit=`. */
const LIMITE_LISTADO_FILL_RATE_MAXIMO = 200;

interface LimitesPaginacion {
  porDefecto: number;
  minimo: number;
  maximo: number;
}

/** Entero estricto (solo digitos, sin signo/decimales) dentro de
 * [minimo, maximo] -- ausente devuelve `porDefecto`; presente pero
 * invalido devuelve null (DATOS_INVALIDOS explicito, nunca se clampea en
 * silencio). Mismo helper que el listado de OTIF. */
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
    porDefecto: LIMITE_LISTADO_FILL_RATE_PREDETERMINADO,
    minimo: 1,
    maximo: LIMITE_LISTADO_FILL_RATE_MAXIMO,
  });
  const pagina = parsearParametroEntero(searchParams.get("page"), { porDefecto: 1, minimo: 1, maximo: 1_000_000 });
  if (limite === null || pagina === null) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const cliente = tenantClient(sesion.empresaId);

  // Gate explicito de pertenencia -- mismo mecanismo y mismo error que
  // la escritura (persistir.ts): si `cadenaId` no existe para ESTE
  // tenant (no existe en absoluto, o existe pero es de otra empresa),
  // `cliente.cadena.findUnique()` (ya acotado por tenantClient/RLS) no
  // la encuentra. Corta aca -- nunca se llega a consultar
  // `observacionKpi` si este gate falla.
  const cadena = await cliente.cadena.findUnique({ where: { id: cadenaId } });
  if (!cadena) {
    return NextResponse.json({ ok: false, error: "CADENA_INEXISTENTE" }, { status: 404 });
  }

  const where = { cadenaId, definicionKpi: { codigo: "FILL_RATE" } };
  // `select` explicito -- nunca el objeto completo: se excluyen las
  // columnas de relacion internas (empresaId, definicionKpiId) que la UI
  // de listado no necesita y que no deben exponerse, ya acotadas por
  // `where` arriba. Mismo criterio que el listado de OTIF.
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

  // Orden con desempates DETERMINISTAS -- mismo criterio que OTIF:
  // createdAt desc y, si dos filas se crearon en el mismo instante, id
  // desc (unico) cierran cualquier empate entre filas con el mismo
  // periodo.
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
