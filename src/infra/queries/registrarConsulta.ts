// Infraestructura -- I5-13, registro auditable de cada consulta
// ejecutada. INSERT puro, append-only (nunca update/delete -- ver el
// GRANT de la migracion 20261015060000_incremento5_consulta_log: el rol
// de runtime no tiene permiso de UPDATE/DELETE sobre esta tabla).
// Minimiza lo persistido (Seccion 8 de la autorizacion): nunca el texto
// de hecho/interpretacion/accion, nunca filtros libres -- solo
// numerador/denominador crudos y el resultado booleano.
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import type { CatalogoConsultaId, RespuestaConsulta } from "@/domain/queries/tipos";

export interface ContextoRegistroConsulta {
  empresaId: string;
  usuarioId: string;
  cadenaId: string;
  catalogoId: CatalogoConsultaId;
  periodo: { inicio: Date; fin: Date } | null;
}

export async function registrarConsulta(
  cliente: TenantPrismaClient,
  contexto: ContextoRegistroConsulta,
  respuesta: RespuestaConsulta,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts (Prisma Client stub, prisma generate pendiente)
  await (cliente as any).consultaLog.create({
    data: {
      empresaId: contexto.empresaId,
      usuarioId: contexto.usuarioId,
      cadenaId: contexto.cadenaId,
      catalogoId: contexto.catalogoId,
      periodoInicio: contexto.periodo?.inicio ?? null,
      periodoFin: contexto.periodo?.fin ?? null,
      resultadoOk: respuesta.ok,
      numerador: respuesta.ok ? respuesta.numerador : null,
      denominador: respuesta.ok ? respuesta.denominador : null,
      ruleVersion: respuesta.ok ? respuesta.ruleVersion : "consultas-v1",
    },
  });
}
