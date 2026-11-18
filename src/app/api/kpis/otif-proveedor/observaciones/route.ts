// Ruta API -- listado de observaciones OTIF Proveedor de una cadena.
// Incremento 5 PR3 (Alex, 2026-11-18). Mismo patron que
// src/app/api/kpis/otif/observaciones/route.ts: requireSession() (RF-K6
// no distingue rol, a diferencia de declarar que exige ADMINISTRADOR),
// tenantClient(empresaId) acota al tenant de la sesion (RNF1 capa 1),
// paginacion y `select` explicitos, orden con desempates deterministas.
//
// Diferencia de forma respecto del listado de OTIF normal: el `where`
// filtra por `definicionKpi: { codigo: "OTIF_PROVEEDOR" } }` (en vez de
// "OTIF") y el `select` agrega `proveedorAlias`/`proveedorAliasClave` --
// nunca expone `proveedorAliasClave` como un "id" navegable, es un campo
// de agrupacion/identidad interna, no un identificador sensible (Alex,
// punto 18: "no exposicion de IDs sensibles" se refiere a no filtrar
// empresaId/definicionKpiId, no a ocultar la clave de agrupacion que la
// propia UI necesita mostrar para distinguir proveedores).
import { NextResponse } from "next/server";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";

export const runtime = "nodejs";

/** Mismos valores y mismo razonamiento que el listado de OTIF normal
 * (route.ts, Alex 2026-10-10) -- sin precedente de uso real todavia que
 * justifique un numero distinto para este catalogo. */
const LIMITE_LISTADO_OTIF_PROVEEDOR_PREDETERMINADO = 50;
const LIMITE_LISTADO_OTIF_PROVEEDOR_MAXIMO = 200;

interface LimitesPaginacion {
  porDefecto: number;
  minimo: number;
  maximo: number;
}

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
    porDefecto: LIMITE_LISTADO_OTIF_PROVEEDOR_PREDETERMINADO,
    minimo: 1,
    maximo: LIMITE_LISTADO_OTIF_PROVEEDOR_MAXIMO,
  });
  const pagina = parsearParametroEntero(searchParams.get("page"), { porDefecto: 1, minimo: 1, maximo: 1_000_000 });
  if (limite === null || pagina === null) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const cliente = tenantClient(sesion.empresaId);
  const where = { cadenaId, definicionKpi: { codigo: "OTIF_PROVEEDOR" } };
  const select = {
    id: true,
    cadenaId: true,
    proveedorAlias: true,
    proveedorAliasClave: true,
    periodoInicio: true,
    periodoFin: true,
    valor: true,
    numerador: true,
    denominador: true,
    fuente: true,
    estado: true,
    ruleVersion: true,
    createdAt: true,
    updatedAt: true,
  };

  // Mismo criterio de desempate determinista que el listado de OTIF
  // normal: periodoInicio desc, createdAt desc, id desc (unico) -- con
  // varios proveedores por periodo este catalogo tiene AUN mas filas con
  // el mismo periodoInicio que OTIF normal, por lo que el desempate es
  // mas importante, no menos.
  const orderBy = [{ periodoInicio: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }];

  const [observaciones, total] = await Promise.all([
    cliente.observacionOtifProveedor.findMany({
      where,
      orderBy,
      skip: (pagina - 1) * limite,
      take: limite,
      select,
    }),
    cliente.observacionOtifProveedor.count({ where }),
  ]);

  return NextResponse.json({
    ok: true,
    observaciones,
    paginacion: { page: pagina, limit: limite, total },
  });
}
