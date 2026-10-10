// Ruta API -- listado de observaciones OTIF de una cadena (RF-K6).
// Incremento 4 Bloque B, piloto OTIF (Alex, 2026-10-08/09; paginacion y
// `select` explicitos agregados 2026-10-10 -- "el GET no puede devolver
// todas las observaciones sin limite").
//
// requireSession() (cualquier rol), a diferencia de previsualizar/
// confirmar -- decision 3 (addendum Seccion 9) restringe DECLARAR a
// ADMINISTRADOR durante el piloto, no la lectura; RF-K6 no distingue rol.
// tenantClient(empresaId) ya acota el resultado al tenant de la sesion
// (RNF1 capa 1) -- un cadenaId de otra empresa simplemente no matchea
// ninguna fila, nunca filtra datos de otro tenant.
import { NextResponse } from "next/server";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";

export const runtime = "nodejs";

/** 50 -- generoso para una pantalla de listado (un periodo por fila, un
 * piloto de una cadena no acumula miles de observaciones por tenant
 * todavia) sin devolver una tabla sin limite. Sin precedente equivalente
 * en el repositorio que reutilizar (no existe paginacion en ninguna otra
 * ruta GET de KPIs todavia) -- valor propuesto, revisable en un solo
 * lugar si la experiencia real de uso lo justifica (Alex 2026-10-10). */
const LIMITE_LISTADO_OTIF_PREDETERMINADO = 50;

/** 200 -- techo explicito para `?limit=`, para que un cliente no pueda
 * pedir una pagina arbitrariamente grande y saltarse el proposito de
 * paginar. */
const LIMITE_LISTADO_OTIF_MAXIMO = 200;

interface LimitesPaginacion {
  porDefecto: number;
  minimo: number;
  maximo: number;
}

/** Entero estricto (solo digitos, sin signo/decimales) dentro de
 * [minimo, maximo] -- ausente devuelve `porDefecto`; presente pero
 * invalido devuelve null (DATOS_INVALIDOS explicito, nunca se clampea
 * en silencio -- mismo criterio que el resto de esta ronda de
 * validaciones). */
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
    porDefecto: LIMITE_LISTADO_OTIF_PREDETERMINADO,
    minimo: 1,
    maximo: LIMITE_LISTADO_OTIF_MAXIMO,
  });
  const pagina = parsearParametroEntero(searchParams.get("page"), { porDefecto: 1, minimo: 1, maximo: 1_000_000 });
  if (limite === null || pagina === null) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const cliente = tenantClient(sesion.empresaId);
  const where = { cadenaId, definicionKpi: { codigo: "OTIF" } };
  // `select` explicito -- nunca el objeto completo (Alex 2026-10-10): se
  // excluyen las columnas de relacion internas (empresaId,
  // definicionKpiId) que la UI de listado no necesita, ya acotadas por
  // `where` arriba.
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

  // Orden con desempates DETERMINISTAS -- ordenar solo por periodoInicio
  // deja el orden entre filas con el MISMO periodo a criterio de Postgres
  // (no garantizado, puede variar entre llamadas): con paginacion eso
  // puede repetir o saltear filas entre paginas distintas cuando varias
  // observaciones comparten periodo (ej. "manual" y "pegado" del mismo
  // rango). createdAt desc y, si dos filas se crearon en el mismo
  // instante, id desc (unico) cierran cualquier empate (Alex, 2026-10-10).
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
