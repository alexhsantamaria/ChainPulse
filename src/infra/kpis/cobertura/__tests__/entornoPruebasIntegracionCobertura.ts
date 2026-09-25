// Guardia + fixtures compartidos por las 3 pruebas de integracion nuevas
// de Cobertura (Incremento 4 Bloque B, condiciones de cierre de Alex
// 2026-09-25): confirmarAtomicidad, confirmarConcurrencia,
// procesarLoteFalloParcial (*.integration.test.ts).
//
// GUARDIA MAS ESTRICTA QUE LAS PRUEBAS DE INTEGRACION YA EXISTENTES
// -----------------------------------------------------------------
// aislamientoMultitenant.integration.test.ts y las demas *.integration.test.ts
// ya existentes solo exigen DATABASE_URL. Alex, sobre este lote nuevo,
// 2026-09-25: "no alcanza con habilitarlos porque exista DATABASE_URL:
// exigí una confirmación explícita de entorno de pruebas, usá datos
// sintéticos aislados y limitá la limpieza a los registros creados por
// esas pruebas. Nunca borrar datos existentes ni usar producción." Estas
// 3 pruebas nuevas exigen ADEMAS una segunda variable de entorno, con un
// valor EXACTO (no alcanza con que exista) -- asi nadie las corre sin
// querer solo porque su .env de desarrollo normal ya tiene DATABASE_URL
// configurado. No se retrofitea a las pruebas de integracion ya
// existentes (fuera del pedido puntual de Alex) -- si se quiere el mismo
// criterio ahi, es una decision aparte.
import { randomUUID } from "node:crypto";
import { prisma } from "../../../prisma/client";
import { hashPassword } from "../../../auth/password";

export const VARIABLE_CONFIRMACION_ENTORNO = "CHAINPULSE_CONFIRMAR_PRUEBAS_DESTRUCTIVAS";
export const VALOR_CONFIRMACION_ENTORNO = "confirmo-entorno-de-pruebas-no-produccion";

/**
 * Llamar SIEMPRE como primera linea de un `beforeAll` -- lanza (fallando
 * la corrida entera, antes de crear ningun dato) si falta DATABASE_URL o
 * si la confirmacion explicita no esta presente con el valor exacto.
 */
export function requerirEntornoDePruebasConfirmado(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Esta prueba necesita DATABASE_URL (conexion real a Postgres) -- no deberia correr en este entorno. Usar `npm run test:integration` en Windows, nunca `npm run test`.",
    );
  }
  if (process.env[VARIABLE_CONFIRMACION_ENTORNO] !== VALOR_CONFIRMACION_ENTORNO) {
    throw new Error(
      `Esta prueba crea Y BORRA datos reales en la base de DATABASE_URL. Por seguridad, ademas de DATABASE_URL hace falta confirmar explicitamente que ese DATABASE_URL apunta a un entorno de pruebas (NUNCA produccion) -- definir ${VARIABLE_CONFIRMACION_ENTORNO}=${VALOR_CONFIRMACION_ENTORNO} en el entorno antes de correr \`npm run test:integration\`. Sin esta confirmacion, la prueba se niega a correr -- no alcanza con que DATABASE_URL exista.`,
    );
  }
}

// Neon "duerme" cuando esta inactiva -- mismo margen que
// aislamientoMultitenant.integration.test.ts para la primera conexion de
// la corrida.
export const TX_OPTIONS_INTEGRACION = { maxWait: 15000, timeout: 20000 };

export interface FixtureCoberturaIntegracion {
  empresaId: string;
  adminId: string;
  cadenaId: string;
  definicionKpiId: string;
}

/**
 * Crea, en una sola transaccion, un tenant sintetico minimo para probar
 * Cobertura: Empresa + Usuario ADMINISTRADOR + Cadena + DefinicionKpi
 * COBERTURA propia (numero aleatorio para no chocar con el
 * @@unique([codigo, numero]) de una DefinicionKpi COBERTURA ya sembrada
 * de verdad en la base). Todos los ids son randomUUID()/cuid generados
 * aca -- nunca toca cuentas ni definiciones ya existentes.
 */
export async function crearFixtureCobertura(etiqueta: string): Promise<FixtureCoberturaIntegracion> {
  const empresaId = randomUUID();
  const passwordHash = await hashPassword(`integracion-cobertura-${randomUUID()}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.empresa.create({ data: { id: empresaId, nombre: `Integracion Cobertura ${etiqueta}` } });
    const admin = await tx.usuario.create({
      data: {
        empresaId,
        email: `integracion-cobertura-${etiqueta}-${randomUUID()}@chainpulse.test`,
        nombre: `Administradora de prueba (Cobertura ${etiqueta})`,
        rol: "ADMINISTRADOR",
        passwordHash,
      },
    });
    const cadena = await tx.cadena.create({
      data: {
        empresaId,
        nombre: `Cadena de prueba ${etiqueta}`,
        productoServicio: "prueba de integracion",
        periodoInicio: new Date("2026-01-01T00:00:00.000Z"),
        periodoFin: new Date("2026-12-31T00:00:00.000Z"),
        tipoOperacion: "manufactura",
      },
    });
    // DefinicionKpi NO es tenant-scoped (sin empresaId) -- numero
    // aleatorio para no chocar con la COBERTURA real ya sembrada
    // (@@unique([codigo, numero])). PERO ademas hay un indice unico
    // PARCIAL sobre codigo solo, WHERE estado='PUBLICADA'
    // (uq_definicion_kpi_publicada, migracion 20260924020000 -- "una
    // version PUBLICADA nunca convive con otra PUBLICADA del mismo
    // codigo", backstop de base de datos a proposito, no representable en
    // schema.prisma). Windows lo encontro real contra Postgres (el `tx`
    // falso de la Mac nunca valida constraints reales): crear esta fila
    // sintetica como PUBLICADA choca con la COBERTURA real ya sembrada,
    // que SI esta PUBLICADA. Ninguno de los tres archivos de integracion
    // que usan este fixture pasa por el unico lookup del codigo que
    // exige estado=PUBLICADA (src/app/api/kpis/cobertura/importaciones/
    // route.ts:58, la ruta de SUBIDA -- ninguno de los tres la ejercita,
    // construyen su propia ImportacionCsv/ObservacionCobertura
    // directamente) -- job.ts busca por id (findUnique), sin filtrar por
    // estado. BORRADOR alcanza y mantiene el fixture 100% aislado de la
    // fila real (nunca la toca, nunca depende de que exista).
    const definicionKpi = await tx.definicionKpi.create({
      data: {
        codigo: "COBERTURA",
        numero: 900_000 + Math.floor(Math.random() * 99_999),
        estado: "BORRADOR",
        nombre: `Cobertura (prueba de integracion ${etiqueta})`,
        descripcion: "Definicion sintetica solo para pruebas de integracion -- nunca usada en produccion.",
        formula: "inventarioDisponible / consumoDiarioEsperado",
        unidad: "dias",
        periodoDefecto: "mensual",
      },
    });
    return { empresaId, adminId: admin.id, cadenaId: cadena.id, definicionKpiId: definicionKpi.id };
  }, TX_OPTIONS_INTEGRACION);
}

/**
 * Borra SOLO lo que crearFixtureCobertura() (mas lo que la propia prueba
 * haya creado colgado de esa Empresa/DefinicionKpi) genero -- nunca toca
 * cuentas ni definiciones preexistentes. Orden: primero la Empresa
 * (ON DELETE CASCADE se lleva Usuario/Cadena/ImportacionCsv/
 * ObservacionCobertura por su cuenta), recien despues la DefinicionKpi
 * sintetica (que hasta ese momento tiene onDelete:Restrict mientras algo
 * la referencia).
 */
export async function borrarFixtureCobertura(fixture: FixtureCoberturaIntegracion): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${fixture.empresaId}, true)`;
    await tx.empresa.delete({ where: { id: fixture.empresaId } });
  }, TX_OPTIONS_INTEGRACION);
  await prisma.definicionKpi.delete({ where: { id: fixture.definicionKpiId } });
}
