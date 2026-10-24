// Guardia + fixtures compartidos por las 5 pruebas de integracion de RF24
// (derechos/retiro), PR-A, autorizacion de Alex 2026-10-22. Mismo
// criterio, deliberadamente mas estricto que "solo exigir DATABASE_URL",
// que entornoPruebasIntegracionCobertura.ts (Incremento 4 Bloque B) --
// ver la cabecera de ese archivo para el razonamiento completo; se
// reusan sus mismos nombres de variable de confirmacion (no se inventa
// un segundo esquema de confirmacion para el mismo proposito).
//
// PREPARADA, NO EJECUTADA EN ESTA RONDA (igual que el resto de pruebas de
// integracion de este proyecto, ver loginLookupIdentidadRonda11.
// integration.test.ts): corren SOLO con `npm run test:integration`,
// manualmente, en Windows, contra una base de prueba real (nunca
// produccion) -- esta sesion no abre ninguna conexion.
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../../prisma/client";
import {
  VARIABLE_CONFIRMACION_ENTORNO,
  VALOR_CONFIRMACION_ENTORNO,
  TX_OPTIONS_INTEGRACION,
} from "../../kpis/cobertura/__tests__/entornoPruebasIntegracionCobertura";
// CORRECCION B1 (Alex, auditoria de los 24 fallos, 2026-10-23): solo para
// el tipo -- ver borrarFixtureEvaluacionRf24() mas abajo.
import type { ClientePrueba } from "../../pruebaRevocacion/clientePrueba";

export { VARIABLE_CONFIRMACION_ENTORNO, VALOR_CONFIRMACION_ENTORNO, TX_OPTIONS_INTEGRACION };

/**
 * Llamar SIEMPRE como primera linea de un `beforeAll` -- lanza (fallando
 * la corrida entera, antes de crear ningun dato) si falta DATABASE_URL o
 * si la confirmacion explicita no esta presente con el valor exacto.
 * Mismo criterio exacto que requerirEntornoDePruebasConfirmado() de
 * Cobertura -- reimplementada aca (en vez de reexportada sola) porque el
 * mensaje de error nombra RF24 explicitamente, para que quien vea fallar
 * esta prueba sepa de inmediato cual paquete la exige.
 */
export function requerirEntornoDePruebasRf24Confirmado(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Las pruebas de integracion de RF24 necesitan DATABASE_URL (conexion real a Postgres) -- no deberian correr en este entorno. Usar `npm run test:integration` en Windows, nunca `npm run test`.",
    );
  }
  if (process.env[VARIABLE_CONFIRMACION_ENTORNO] !== VALOR_CONFIRMACION_ENTORNO) {
    throw new Error(
      `Las pruebas de integracion de RF24 crean Y BORRAN datos reales en la base de DATABASE_URL. Por seguridad, ademas de DATABASE_URL hace falta confirmar explicitamente que ese DATABASE_URL apunta a un entorno de pruebas (NUNCA produccion) -- definir ${VARIABLE_CONFIRMACION_ENTORNO}=${VALOR_CONFIRMACION_ENTORNO} en el entorno antes de correr \`npm run test:integration\`. Sin esta confirmacion, la prueba se niega a correr.`,
    );
  }
}

export interface FixtureEvaluacionRf24 {
  cuestionarioVersionId: string;
  evaluacionExpresV2Id: string;
}

/**
 * Crea, en una sola transaccion, el minimo necesario para que exista una
 * EvaluacionExpresV2 valida sobre la que probar RF24: una
 * CuestionarioVersion BORRADOR sintetica (codigo/numero aleatorios, para
 * no chocar con @@unique([codigo, numero]) de versiones reales ya
 * sembradas) + la propia evaluacion, con `correo` poblado (necesario
 * para ejercitar la verificacion interna de correo de
 * crear_solicitud_derechos -- Prueba 1 de este paquete usa el correo
 * real; las pruebas que no verifican coincidencia de correo no lo
 * necesitan pero lo reciben igual, para un unico fixture compartido).
 * EvaluacionExpresV2 no es tenant-scoped (sin empresaId, sin RLS,
 * confirmado en prisma/rls.sql) -- a diferencia de crearFixtureCobertura,
 * esta funcion nunca llama a set_config('app.tenant_id', ...).
 */
export async function crearFixtureEvaluacionRf24(
  etiqueta: string,
  correo = `titular-${etiqueta}-${randomUUID()}@chainpulse.test`,
): Promise<FixtureEvaluacionRf24> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  return prisma.$transaction(async (tx: any) => {
    const cuestionarioVersion = await tx.cuestionarioVersion.create({
      data: {
        codigo: `rf24-integracion-${etiqueta}`,
        numero: 1 + Math.floor(Math.random() * 999_999),
        estado: "BORRADOR",
      },
    });
    const evaluacion = await tx.evaluacionExpresV2.create({
      data: {
        cuestionarioVersionId: cuestionarioVersion.id,
        productoServicio: `producto de prueba RF24 (${etiqueta})`,
        periodoInicio: new Date("2026-01-01T00:00:00.000Z"),
        periodoFin: new Date("2026-12-31T00:00:00.000Z"),
        tipoOperacion: "manufactura",
        huellaOrigen: `huella-integracion-rf24-${etiqueta}-${randomUUID()}`,
        correo,
        nombreCompleto: `Titular de prueba RF24 (${etiqueta})`,
      },
    });
    return { cuestionarioVersionId: cuestionarioVersion.id, evaluacionExpresV2Id: evaluacion.id };
  }, TX_OPTIONS_INTEGRACION);
}

/**
 * Borra SOLO lo que crearFixtureEvaluacionRf24() (mas lo que la propia
 * prueba haya creado colgado de esa EvaluacionExpresV2 -- SolicitudDerechos,
 * ConsentimientoExpres) genero. Orden: SolicitudDerechos primero
 * (onDelete: Restrict hacia EvaluacionExpresV2 -- no se puede borrar la
 * evaluacion mientras exista una fila que la referencie), despues la
 * propia EvaluacionExpresV2 (ON DELETE CASCADE se lleva
 * ConsentimientoExpres/Respuesta/HallazgoExpres por su cuenta), por
 * ultimo la CuestionarioVersion sintetica.
 *
 * CORRECCION B1 (Alex, auditoria de los 24 fallos, 2026-10-23): la
 * migracion correctiva de Ronda 8 revoco SELECT/INSERT/UPDATE/DELETE
 * directo de chainpulse_app sobre "solicitudes_derechos" -- el
 * `prisma.solicitudDerechos.deleteMany` de abajo (cliente de aplicacion)
 * fallaba con "permission denied for table solicitudes_derechos" en el
 * afterAll de 3 de las 5 suites de este paquete (root cause de 3 de las
 * 4 suites fallidas del log real). Ahora recibe el cliente ADMINISTRATIVO
 * (neondb_owner, construido con construirClientePrueba() en cada archivo
 * de prueba) como segundo parametro -- obligatorio, nunca con default,
 * para que sea imposible volver a llamar esta funcion sin pasarlo.
 * `evaluacionExpresV2.delete`/`cuestionarioVersion.delete` quedan EXACTAMENTE
 * igual, con el cliente de aplicacion -- esas 2 tablas nunca perdieron
 * privilegios para chainpulse_app, cambiarlas tambien seria un cambio sin
 * motivo. Nunca se restaura ningun privilegio de tabla ni se concede nada
 * nuevo a chainpulse_app -- la correccion es exclusivamente del lado de
 * la prueba.
 */
export async function borrarFixtureEvaluacionRf24(
  fixture: FixtureEvaluacionRf24,
  clienteAdmin: ClientePrueba,
): Promise<void> {
  await clienteAdmin.solicitudDerechos.deleteMany({
    where: { evaluacionExpresV2Id: fixture.evaluacionExpresV2Id },
  });
  await prisma.evaluacionExpresV2.delete({ where: { id: fixture.evaluacionExpresV2Id } });
  await prisma.cuestionarioVersion.delete({ where: { id: fixture.cuestionarioVersionId } });
}

/** sha256 hexadecimal de lower(trim(correo)) -- CORRECCION Alex
 * 2026-10-22, punto 5 (antes md5, reemplazado por colisionable):
 * exactamente la misma normalizacion Y el mismo algoritmo que la
 * funcion SQL crear_solicitud_derechos calcula internamente sobre el
 * correo almacenado (encode(sha256(convert_to(lower(trim(correo)),
 * 'UTF8')), 'hex') -- ver migracion de funciones, Funcion 1). "utf8"
 * aqui en Node coincide byte a byte con convert_to(..., 'UTF8') del
 * lado SQL -- misma codificacion explicita en ambos lados, nunca la
 * codificacion por defecto de ninguno de los dos. La aplicacion (y
 * estas pruebas) nunca envian el correo en claro como argumento de esa
 * funcion. */
export function hashCorreoNormalizado(correo: string): string {
  return createHash("sha256").update(correo.trim().toLowerCase(), "utf8").digest("hex");
}
