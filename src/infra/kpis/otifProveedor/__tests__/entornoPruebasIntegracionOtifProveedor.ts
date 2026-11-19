// Guardia + fixtures para las pruebas de integracion de OTIF Proveedor
// (declararObservacionOtifProveedor.integration.test.ts), Incremento 5
// PR3. Reutiliza la MISMA guardia reforzada ya establecida (Alex,
// 2026-09-25) -- re-exportada tal cual desde el modulo de Cobertura,
// mismo criterio que entornoPruebasIntegracionOtif.ts (OTIF normal):
// nunca duplicar el criterio de "es seguro correr esto" en un tercer
// lugar.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../prisma/client";
import { hashPassword } from "../../../auth/password";
import { TX_OPTIONS_INTEGRACION } from "../../cobertura/__tests__/entornoPruebasIntegracionCobertura";

export {
  VARIABLE_CONFIRMACION_ENTORNO,
  VALOR_CONFIRMACION_ENTORNO,
  requerirEntornoDePruebasConfirmado,
  TX_OPTIONS_INTEGRACION,
} from "../../cobertura/__tests__/entornoPruebasIntegracionCobertura";

export interface FixtureOtifProveedorIntegracion {
  empresaId: string;
  adminId: string;
  cadenaId: string;
}

/**
 * Crea, en una sola transaccion, un tenant sintetico minimo para probar
 * OTIF Proveedor: Empresa + Usuario ADMINISTRADOR + Cadena. A diferencia
 * de crearFixtureOtif() (OTIF normal), este fixture NO crea una
 * DefinicionKpi sintetica propia -- confirmarObservacionOtifProveedor()
 * (persistir.ts) busca la DefinicionKpi{codigo:"OTIF_PROVEEDOR"}
 * PUBLICADA, que YA esta sembrada por prisma/seedDefinicionesKpi.ts (ver
 * schema.prisma, prisma/seedDefinicionesKpi.ts lineas 175-181) -- a
 * diferencia de OTIF_PROVEEDOR en el piloto I4-07, no hace falta
 * sembrar nada nuevo para este PR.
 */
export async function crearFixtureOtifProveedor(etiqueta: string): Promise<FixtureOtifProveedorIntegracion> {
  const empresaId = randomUUID();
  const passwordHash = await hashPassword(`integracion-otif-proveedor-${randomUUID()}`);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.empresa.create({ data: { id: empresaId, nombre: `Integracion OTIF Proveedor ${etiqueta}` } });
    const admin = await tx.usuario.create({
      data: {
        empresaId,
        email: `integracion-otif-proveedor-admin-${etiqueta}-${randomUUID()}@chainpulse.test`,
        nombre: `Administradora de prueba (OTIF Proveedor ${etiqueta})`,
        rol: "ADMINISTRADOR",
        passwordHash,
      },
    });
    const cadena = await tx.cadena.create({
      data: {
        empresaId,
        nombre: `Cadena de prueba OTIF Proveedor ${etiqueta}`,
        productoServicio: "prueba de integracion",
        periodoInicio: new Date("2026-01-01T00:00:00.000Z"),
        periodoFin: new Date("2026-12-31T00:00:00.000Z"),
        tipoOperacion: "manufactura",
      },
    });
    return { empresaId, adminId: admin.id, cadenaId: cadena.id };
  }, TX_OPTIONS_INTEGRACION);
}

/**
 * Borra SOLO lo que crearFixtureOtifProveedor() genero -- ON DELETE
 * CASCADE de Empresa se lleva Usuario/Cadena/ObservacionOtifProveedor
 * por su cuenta. Nunca borra la DefinicionKpi real (no es sintetica
 * aca, a diferencia de OTIF normal).
 */
export async function borrarFixtureOtifProveedor(fixture: FixtureOtifProveedorIntegracion): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${fixture.empresaId}, true)`;
    await tx.empresa.delete({ where: { id: fixture.empresaId } });
  }, TX_OPTIONS_INTEGRACION);
}
