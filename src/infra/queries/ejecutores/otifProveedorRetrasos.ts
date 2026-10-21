// Infraestructura -- I5-02. Ver la nota de cabecera de
// engine/queries/otifProveedorRetrasos.ts: ObservacionKpi no tiene
// columna de proveedor, asi que este loader SIEMPRE entrega un array
// vacio hoy -- no hay ninguna tabla de la que leer un desglose real. El
// motor, con cero filas, responde correctamente SIN_DATOS_SUFICIENTES
// (comportamiento ya probado en otifProveedorRetrasos.test.ts).
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import { ejecutarOtifProveedorRetrasos } from "@/engine/queries/otifProveedorRetrasos";
import type { RespuestaConsulta } from "@/domain/queries/tipos";

export async function cargarYEjecutarOtifProveedorRetrasos(
  _cliente: TenantPrismaClient,
  _cadenaId: string,
  periodo: { inicio: Date; fin: Date },
): Promise<RespuestaConsulta> {
  // Ningun dato real que cargar hoy (ver nota de cabecera) -- la firma ya
  // recibe cliente/cadenaId para que, cuando I4-07 tenga persistencia por
  // proveedor, este archivo sea el UNICO que cambie (consulta real en vez
  // de un array vacio), sin tocar el motor ni el dispatcher.
  return ejecutarOtifProveedorRetrasos({ filas: [], periodoConsultado: periodo });
}
