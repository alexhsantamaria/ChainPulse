// Script de mantenimiento — RF19/RF20 §8.3: "Restablecimiento de MFA
// (dispositivo perdido)": en UNA cuenta de UsuarioPlataforma puntual,
// identificada por email, pone mfaHabilitado=false, mfaSecret=NULL,
// mfaUltimoContadorUsado=NULL, e incrementa sessionVersion en 1 -- las
// cuatro escrituras, atomicas en una sola transaccion (ronda 3 de
// revision, Alex: incrementar sessionVersion revoca de inmediato toda
// sesion de plataforma ya emitida para esa cuenta, en vez de dejarlas
// vigentes hasta su vencimiento natural -- ver el comentario junto al
// $transaction mas abajo). El usuario vuelve a iniciar sesion y a
// enrolar MFA en su siguiente login real
// (src/app/api/plataforma/mfa/enrolar) -- este script nunca genera ni
// imprime ningun secreto TOTP nuevo.
//
// Misma credencial administrativa que aprovisionar-usuario-plataforma.ts
// (DATABASE_URL_PLATAFORMA_ADMIN, neondb_owner -- §4.2 revoca todo
// privilegio de chainpulse_app sobre usuarios_plataforma) y la misma
// infraestructura generica reutilizada de src/infra/pruebaRevocacion/.
//
// Doble confirmacion del email por DOS variables de entorno
// independientes que deben coincidir EXACTAMENTE (mismo criterio que
// scripts/restablecerPasswordCuentaPrueba.ts, punto 1 de su cabecera):
// un typo en una sola variable aborta en vez de arriesgar una
// coincidencia espuria sobre la cuenta equivocada.
//
// Doble capa de autorizacion exigida ADEMAS de --ejecutar (ronda 2 de
// revision, Alex), ademas de la doble confirmacion de email ya descrita
// arriba:
//   1) ENTORNO_PRUEBA_CONFIRMADO -- destino EXACTO (host:puerto/base?schema=esquema)
//      confirmado a mano contra el destino efectivamente resuelto
//      (exigirEntornoConfirmado(), infra generica sin modificar -- misma
//      funcion que ya usan scripts/rf20/calibrarExtractor23505RamaTemporal.ts
//      y scripts/rf19/aprovisionar-usuario-plataforma.ts).
//   2) AUTORIZO_RF19_RESTABLECER_MFA_PLATAFORMA="si" -- autorizacion
//      especifica de ESTA accion, distinta de ENTORNO_PRUEBA_CONFIRMADO
//      y de cualquier otra variable AUTORIZO_* de otro script.
//
// Modo diagnostico por defecto: sin --ejecutar, solo verifica destino +
// autorizacion + rol + localiza la cuenta (sin escribir nada).
//
// Uso:
//   RESTABLECER_MFA_EMAIL=... RESTABLECER_MFA_EMAIL_CONFIRMACION=... \
//     DATABASE_URL_PLATAFORMA_ADMIN=... ENTORNO_PRUEBA_CONFIRMADO=... \
//     AUTORIZO_RF19_RESTABLECER_MFA_PLATAFORMA=si \
//     npx tsx scripts/rf19/restablecer-mfa-plataforma-mantenimiento.ts
//   ... --ejecutar
import "../_cargarEnv";
import { etiquetaSegura } from "../../src/infra/auth/etiquetaErrorSegura";

const EMAIL = process.env.RESTABLECER_MFA_EMAIL ?? "";
const EMAIL_CONFIRMACION = process.env.RESTABLECER_MFA_EMAIL_CONFIRMACION ?? "";
const DATABASE_URL_ADMIN = process.env.DATABASE_URL_PLATAFORMA_ADMIN;

function exigirSegundaAutorizacion(): void {
  if (process.env.AUTORIZO_RF19_RESTABLECER_MFA_PLATAFORMA !== "si") {
    throw new Error("AUTORIZACION_RESTABLECIMIENTO_MFA_FALTANTE");
  }
}

// Señal interna para forzar el rollback dentro de $transaction -- mismo
// patron que ConteoInesperadoError en restablecerPasswordMantenimiento.ts.
// Exportada (ronda 3) para que las pruebas focalizadas puedan distinguir
// este motivo de rollback de cualquier otro error inesperado.
export class ConteoInesperadoError extends Error {
  constructor(public readonly cantidad: number) {
    super(`UPDATE afecto ${cantidad} filas (se exigia exactamente 1)`);
    this.name = "ConteoInesperadoError";
  }
}

// Forma minima del cliente que esta funcion necesita -- tipada a mano
// (no PrismaClient completo) para poder probarla con un mock simple, sin
// generar un cliente Prisma real ni tocar una base (mismo criterio que
// ClienteSoloLecturaRol en src/infra/pruebaRevocacion/destinoPrueba.ts).
export interface ClienteRestablecimientoMfa {
  $transaction<T>(fn: (tx: ClienteRestablecimientoMfa) => Promise<T>): Promise<T>;
  usuarioPlataforma: {
    updateMany(args: {
      where: { id: string; email: string };
      data: {
        mfaHabilitado: boolean;
        mfaSecret: null;
        mfaUltimoContadorUsado: null;
        sessionVersion: { increment: number };
      };
    }): Promise<{ count: number }>;
  };
}

/**
 * Las cuatro escrituras atomicas del restablecimiento (ronda 3, Alex):
 * limpia mfaHabilitado/mfaSecret/mfaUltimoContadorUsado e incrementa
 * sessionVersion en 1 para revocar de inmediato toda sesion de
 * plataforma ya emitida para esta cuenta (ver el comentario de cabecera
 * del archivo). Exigir resultado.count === 1 dentro de la MISMA
 * transaccion asegura que las cuatro escrituras se aplican todas juntas
 * o ninguna -- nunca una revocacion de sesion sin la limpieza de MFA, ni
 * al reves. Extraida a una funcion con nombre (en vez de quedar inline
 * en main()) exclusivamente para que las pruebas focalizadas puedan
 * invocarla con un cliente falso, sin ejecutar el resto del script
 * (validacion de variables de entorno, confirmacion de destino,
 * conexion real) -- no cambia ningun comportamiento.
 */
export async function restablecerMfaPlataformaTransaccion(
  cliente: ClienteRestablecimientoMfa,
  id: string,
  emailNormalizado: string,
): Promise<void> {
  await cliente.$transaction(async (tx) => {
    const resultado = await tx.usuarioPlataforma.updateMany({
      where: { id, email: emailNormalizado },
      data: {
        mfaHabilitado: false,
        mfaSecret: null,
        mfaUltimoContadorUsado: null,
        sessionVersion: { increment: 1 },
      },
    });
    if (resultado.count !== 1) {
      throw new ConteoInesperadoError(resultado.count);
    }
  });
}

async function main() {
  const ejecutar = process.argv.includes("--ejecutar");

  if (!EMAIL || !EMAIL_CONFIRMACION) {
    console.error(
      "RESTABLECER_MFA_EMAIL y RESTABLECER_MFA_EMAIL_CONFIRMACION deben estar definidas -- abortado antes de conectarse a nada. Ninguna de las dos se imprime.",
    );
    process.exitCode = 1;
    return;
  }
  if (EMAIL !== EMAIL_CONFIRMACION) {
    console.error(
      "RESTABLECER_MFA_EMAIL y RESTABLECER_MFA_EMAIL_CONFIRMACION no coinciden -- abortado antes de conectarse a nada.",
    );
    process.exitCode = 1;
    return;
  }
  if (!DATABASE_URL_ADMIN) {
    console.error(
      "DATABASE_URL_PLATAFORMA_ADMIN es obligatoria (credencial neondb_owner) -- abortado antes de conectarse a nada.",
    );
    process.exitCode = 1;
    return;
  }

  const emailNormalizado = EMAIL.trim().toLowerCase();

  const { construirClientePrueba, desconectarClientePrueba } = await import(
    "../../src/infra/pruebaRevocacion/clientePrueba"
  );
  const { resumenUrl, destinoConfirmado, exigirEntornoConfirmado, verificarRolConexionAdministrativa, ROL_ADMIN_ESPERADO } =
    await import("../../src/infra/pruebaRevocacion/destinoPrueba");

  const destino = resumenUrl("DATABASE_URL_PLATAFORMA_ADMIN", DATABASE_URL_ADMIN);
  console.log(`Modo: ${ejecutar ? "EJECUCION (--ejecutar)" : "DIAGNOSTICO (solo lectura -- agregar --ejecutar para continuar)"}`);
  console.log(`Destino: host=${destino.host} puerto=${destino.puerto} base=${destino.base} esquema=${destino.esquema} (la credencial nunca se imprime).`);
  console.log("Email objetivo: (definido via RESTABLECER_MFA_EMAIL, confirmado contra RESTABLECER_MFA_EMAIL_CONFIRMACION -- no se imprime).");
  console.log("");

  try {
    // Doble autorizacion (ronda 2), ANTES de conectarse: destino exacto
    // confirmado + autorizacion especifica de esta accion.
    exigirEntornoConfirmado(destino);
    exigirSegundaAutorizacion();
    console.log(`Destino confirmado: ${destinoConfirmado(destino)}. Autorizacion especifica de restablecimiento de MFA confirmada.`);
  } catch (err) {
    console.error(`No se pudo confirmar destino/autorizacion -- ${etiquetaSegura(err)}. No se registró el detalle crudo del error. Abortado antes de conectarse a nada.`);
    process.exitCode = 1;
    return;
  }

  const cliente = construirClientePrueba(DATABASE_URL_ADMIN, "restablecerMfaPlataformaMantenimiento");
  try {
    const veredicto = await verificarRolConexionAdministrativa(
      cliente,
      "restablecerMfaPlataformaMantenimiento",
      ROL_ADMIN_ESPERADO,
    );
    console.log(`Rol efectivo confirmado: ${veredicto.usuarioActual} (esperado: ${ROL_ADMIN_ESPERADO}).`);

    const filas: Array<{ id: string; mfaHabilitado: boolean }> = await cliente.$queryRaw`
      SELECT id, "mfaHabilitado" FROM public.usuarios_plataforma WHERE lower(btrim(email)) = ${emailNormalizado}
    `;
    if (filas.length === 0) {
      console.error("No existe ninguna cuenta de plataforma con este email -- abortado, no se escribió nada.");
      process.exitCode = 1;
      return;
    }
    if (filas.length > 1) {
      // No deberia ser posible (indice unico funcional de §8.2), pero
      // nunca se asume -- abortar explicitamente ante cualquier
      // ambiguedad en vez de elegir una fila al azar.
      console.error(`Se encontraron ${filas.length} cuentas con este email normalizado (se esperaba exactamente 1) -- abortado, no se escribió nada.`);
      process.exitCode = 1;
      return;
    }
    const objetivo = filas[0]!;
    console.log(`Cuenta localizada: id=${objetivo.id}, mfaHabilitado=${objetivo.mfaHabilitado}.`);

    if (!ejecutar) {
      console.log("");
      console.log("Modo diagnostico: no se escribió nada. Volver a correr con --ejecutar para continuar.");
      return;
    }

    try {
      await restablecerMfaPlataformaTransaccion(cliente, objetivo.id, emailNormalizado);
    } catch (err) {
      if (err instanceof ConteoInesperadoError) {
        console.error(`El UPDATE hubiera afectado ${err.cantidad} filas (se exigía exactamente 1) -- la transacción se revirtió, no quedó ningún cambio aplicado.`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    console.log("");
    console.log(`MFA restablecido para id=${objetivo.id}: mfaHabilitado=false, mfaSecret=NULL, mfaUltimoContadorUsado=NULL. sessionVersion se incrementó en 1 -- toda sesión de plataforma ya emitida para esta cuenta queda revocada de inmediato (requireSesionPlataforma() la rechaza en su próxima verificación). El usuario deberá volver a iniciar sesión y enrolar MFA de nuevo.`);
    console.log("No se tocó passwordHash, rol, activo, intentosFallidos ni bloqueadoHasta.");
  } catch (err) {
    console.error(`No se pudo restablecer MFA -- ${etiquetaSegura(err)}. No se registró el detalle crudo del error.`);
    process.exitCode = 1;
  } finally {
    await desconectarClientePrueba(cliente, "restablecerMfaPlataformaMantenimiento");
  }
}

// Guard (ronda 3, Alex): este archivo ahora exporta
// restablecerMfaPlataformaTransaccion() para las pruebas focalizadas
// (scripts/rf19/__tests__/), y un import de ES modules ejecuta el
// cuerpo del modulo entero -- sin este guard, cada prueba dispararia
// main() de verdad (pediria RESTABLECER_MFA_EMAIL/etc. por variables de
// entorno inexistentes en la corrida de pruebas y dejaria
// process.exitCode en 1, aunque todas las pruebas pasen). Vitest define
// process.env.VITEST="true" automaticamente en cualquier proceso de
// pruebas; fuera de pruebas (invocacion real con `npx tsx`) esa
// variable nunca existe, asi que el comportamiento de produccion de
// este script no cambia en nada.
if (process.env.VITEST !== "true") {
  main().catch((err) => {
    console.error(`Error inesperado -- ${etiquetaSegura(err)}. No se registró el detalle crudo del error.`);
    process.exit(1);
  });
}
