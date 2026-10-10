// Guardia + fixtures para las pruebas de integracion de OTIF
// (declararObservacionOtif.integration.test.ts), piloto Incremento 4
// Bloque B. Reutiliza la MISMA guardia reforzada de
// src/infra/kpis/cobertura/__tests__/entornoPruebasIntegracionCobertura.ts
// (Alex, 2026-09-25): no alcanza con que exista DATABASE_URL, hace falta
// ADEMAS una confirmacion explicita de entorno de pruebas con un valor
// EXACTO -- nunca producción, datos 100% sinteticos y aislados, limpieza
// limitada a lo que el propio fixture creo. No se duplica esa guardia
// aca: se re-exporta tal cual desde el modulo de Cobertura, para que
// nunca haya dos criterios de "es seguro correr esto" divergentes en el
// mismo repositorio.
import { randomUUID } from "node:crypto";
import { prisma } from "../../../prisma/client";
import { hashPassword } from "../../../auth/password";
import { TX_OPTIONS_INTEGRACION } from "../../cobertura/__tests__/entornoPruebasIntegracionCobertura";

export {
  VARIABLE_CONFIRMACION_ENTORNO,
  VALOR_CONFIRMACION_ENTORNO,
  requerirEntornoDePruebasConfirmado,
  TX_OPTIONS_INTEGRACION,
} from "../../cobertura/__tests__/entornoPruebasIntegracionCobertura";

export interface FixtureOtifIntegracion {
  empresaId: string;
  adminId: string;
  responsableId: string;
  cadenaId: string;
  definicionKpiId: string;
}

/**
 * Crea, en una sola transaccion, un tenant sintetico minimo para probar
 * OTIF: Empresa + Usuario ADMINISTRADOR + Usuario RESPONSABLE (para la
 * prueba de autorizacion, decision 3) + Cadena + DefinicionKpi OTIF
 * propia (numero aleatorio, mismo motivo que crearFixtureCobertura: no
 * chocar con la OTIF real ya sembrada -- @@unique([codigo, numero]) +
 * el indice parcial uq_definicion_kpi_publicada). Nunca toca cuentas ni
 * definiciones ya existentes.
 *
 * Nota: confirmarObservacionOtif() (persistir.ts) busca la DefinicionKpi
 * OTIF PUBLICADA -- encuentra la REAL ya sembrada (prisma/seedDefinicionesKpi.ts),
 * nunca esta fila sintetica BORRADOR. Eso es intencional (mismo patron
 * que la DefinicionKpi COBERTURA sintetica de crearFixtureCobertura): la
 * fila sintetica de aca solo sirve para pruebas que arman sus propias
 * ObservacionKpi directamente contra Prisma, sin pasar por confirmarObservacionOtif().
 */
export async function crearFixtureOtif(etiqueta: string): Promise<FixtureOtifIntegracion> {
  const empresaId = randomUUID();
  const passwordHash = await hashPassword(`integracion-otif-${randomUUID()}`);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.empresa.create({ data: { id: empresaId, nombre: `Integracion OTIF ${etiqueta}` } });
    const admin = await tx.usuario.create({
      data: {
        empresaId,
        email: `integracion-otif-admin-${etiqueta}-${randomUUID()}@chainpulse.test`,
        nombre: `Administradora de prueba (OTIF ${etiqueta})`,
        rol: "ADMINISTRADOR",
        passwordHash,
      },
    });
    const responsable = await tx.usuario.create({
      data: {
        empresaId,
        email: `integracion-otif-resp-${etiqueta}-${randomUUID()}@chainpulse.test`,
        nombre: `Responsable de prueba (OTIF ${etiqueta})`,
        rol: "RESPONSABLE",
        passwordHash,
      },
    });
    const cadena = await tx.cadena.create({
      data: {
        empresaId,
        nombre: `Cadena de prueba OTIF ${etiqueta}`,
        productoServicio: "prueba de integracion",
        periodoInicio: new Date("2026-01-01T00:00:00.000Z"),
        periodoFin: new Date("2026-12-31T00:00:00.000Z"),
        tipoOperacion: "manufactura",
      },
    });
    const definicionKpi = await tx.definicionKpi.create({
      data: {
        codigo: "OTIF",
        numero: 900_000 + Math.floor(Math.random() * 99_999),
        estado: "BORRADOR",
        nombre: `OTIF (prueba de integracion ${etiqueta})`,
        descripcion: "Definicion sintetica solo para pruebas de integracion -- nunca usada en produccion.",
        formula: "pedidos completos y a tiempo / pedidos evaluados",
        unidad: "%",
        periodoDefecto: "mensual",
      },
    });
    return { empresaId, adminId: admin.id, responsableId: responsable.id, cadenaId: cadena.id, definicionKpiId: definicionKpi.id };
  }, TX_OPTIONS_INTEGRACION);
}

/**
 * Borra SOLO lo que crearFixtureOtif() genero (ON DELETE CASCADE de
 * Empresa se lleva Usuario/Cadena/ObservacionKpi por su cuenta) -- mismo
 * orden que borrarFixtureCobertura: primero la Empresa, recien despues la
 * DefinicionKpi sintetica (onDelete:Restrict mientras algo la referencia).
 */
export async function borrarFixtureOtif(fixture: FixtureOtifIntegracion): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${fixture.empresaId}, true)`;
    await tx.empresa.delete({ where: { id: fixture.empresaId } });
  }, TX_OPTIONS_INTEGRACION);
  await prisma.definicionKpi.delete({ where: { id: fixture.definicionKpiId } });
}
