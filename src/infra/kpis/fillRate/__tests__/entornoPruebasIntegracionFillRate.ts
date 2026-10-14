// Guardia + fixtures para las pruebas de integracion de Fill Rate
// (declararObservacionFillRate.integration.test.ts), Incremento 4 Bloque
// B, siguiente KPI despues de OTIF (Alex, 2026-10-14). Mismo patron
// EXACTO que src/infra/kpis/otif/__tests__/entornoPruebasIntegracionOtif.ts:
// re-exporta la guardia reforzada de Cobertura (Alex, 2026-09-25) tal
// cual, para que nunca haya dos criterios de "es seguro correr esto"
// divergentes en el mismo repositorio.
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

export interface FixtureFillRateIntegracion {
  empresaId: string;
  adminId: string;
  responsableId: string;
  cadenaId: string;
  definicionKpiId: string;
}

/**
 * Crea, en una sola transaccion, un tenant sintetico minimo para probar
 * Fill Rate: Empresa + Usuario ADMINISTRADOR + Usuario RESPONSABLE (para
 * la prueba de autorizacion, mismo criterio decision 3 que OTIF) +
 * Cadena + DefinicionKpi FILL_RATE propia (numero aleatorio, mismo
 * motivo que crearFixtureOtif/crearFixtureCobertura: no chocar con la
 * FILL_RATE real ya sembrada -- @@unique([codigo, numero]) + el indice
 * parcial uq_definicion_kpi_publicada). Nunca toca cuentas ni
 * definiciones ya existentes.
 *
 * Nota: confirmarObservacionFillRate() (persistir.ts) busca la
 * DefinicionKpi FILL_RATE PUBLICADA -- encuentra la REAL ya sembrada
 * (prisma/seedDefinicionesKpi.ts), nunca esta fila sintetica BORRADOR.
 * Eso es intencional (mismo patron que OTIF/Cobertura): la fila sintetica
 * de aca solo sirve para pruebas que arman sus propias ObservacionKpi
 * directamente contra Prisma, sin pasar por confirmarObservacionFillRate().
 */
export async function crearFixtureFillRate(etiqueta: string): Promise<FixtureFillRateIntegracion> {
  const empresaId = randomUUID();
  const passwordHash = await hashPassword(`integracion-fillrate-${randomUUID()}`);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.empresa.create({ data: { id: empresaId, nombre: `Integracion Fill Rate ${etiqueta}` } });
    const admin = await tx.usuario.create({
      data: {
        empresaId,
        email: `integracion-fillrate-admin-${etiqueta}-${randomUUID()}@chainpulse.test`,
        nombre: `Administradora de prueba (Fill Rate ${etiqueta})`,
        rol: "ADMINISTRADOR",
        passwordHash,
      },
    });
    const responsable = await tx.usuario.create({
      data: {
        empresaId,
        email: `integracion-fillrate-resp-${etiqueta}-${randomUUID()}@chainpulse.test`,
        nombre: `Responsable de prueba (Fill Rate ${etiqueta})`,
        rol: "RESPONSABLE",
        passwordHash,
      },
    });
    const cadena = await tx.cadena.create({
      data: {
        empresaId,
        nombre: `Cadena de prueba Fill Rate ${etiqueta}`,
        productoServicio: "prueba de integracion",
        periodoInicio: new Date("2026-01-01T00:00:00.000Z"),
        periodoFin: new Date("2026-12-31T00:00:00.000Z"),
        tipoOperacion: "manufactura",
      },
    });
    const definicionKpi = await tx.definicionKpi.create({
      data: {
        codigo: "FILL_RATE",
        numero: 900_000 + Math.floor(Math.random() * 99_999),
        estado: "BORRADOR",
        nombre: `Fill Rate (prueba de integracion ${etiqueta})`,
        descripcion: "Definicion sintetica solo para pruebas de integracion -- nunca usada en produccion.",
        formula: "unidades servidas / unidades solicitadas",
        unidad: "%",
        periodoDefecto: "mensual",
      },
    });
    return { empresaId, adminId: admin.id, responsableId: responsable.id, cadenaId: cadena.id, definicionKpiId: definicionKpi.id };
  }, TX_OPTIONS_INTEGRACION);
}

/**
 * Borra SOLO lo que crearFixtureFillRate() genero (ON DELETE CASCADE de
 * Empresa se lleva Usuario/Cadena/ObservacionKpi por su cuenta) -- mismo
 * orden que borrarFixtureOtif/borrarFixtureCobertura: primero la Empresa,
 * recien despues la DefinicionKpi sintetica (onDelete:Restrict mientras
 * algo la referencia).
 */
export async function borrarFixtureFillRate(fixture: FixtureFillRateIntegracion): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${fixture.empresaId}, true)`;
    await tx.empresa.delete({ where: { id: fixture.empresaId } });
  }, TX_OPTIONS_INTEGRACION);
  await prisma.definicionKpi.delete({ where: { id: fixture.definicionKpiId } });
}
