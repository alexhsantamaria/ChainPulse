// Orquestacion de scripts/sembrarPruebaRevocacionAislada.ts (Alex,
// 2026-10-04, punto 2 de la segunda correccion: extraido para poder
// probarlo con vitest, y para que el script en si SIEMPRE termine con
// un manejador final -- "La siembra termina con main() sin manejador
// final: corregilo". El script delega todo a orquestarSiembra() y
// envuelve esa llamada en main().catch(), nunca en un "main();" suelto).
import { hashPassword } from "../auth/password";
import { logError } from "../log";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "./clientePrueba";
import {
  ROL_ADMIN_ESPERADO,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexionAdministrativa,
} from "./destinoPrueba";
import { escribirManifiesto } from "./manifiestoIO";
import {
  SUFIJOS_USUARIO,
  USO_POR_SUFIJO,
  emailUsuario,
  nombreEmpresa,
  nuevoRunId,
  type ManifiestoPrueba,
} from "./manifiesto";

export interface DependenciasSiembra {
  seedDatabaseUrl: string | undefined;
  construirAdmin(cadenaConexion: string): ClientePrueba;
  desconectar(cliente: ClientePrueba): Promise<void>;
  hashPassword(valor: string): Promise<string>;
  nuevoRunId(): string;
  escribirManifiesto(runId: string, manifiesto: ManifiestoPrueba): string;
}

export function dependenciasRealesSiembra(): DependenciasSiembra {
  return {
    seedDatabaseUrl: process.env.SEED_DATABASE_URL,
    construirAdmin: (cs) => construirClientePrueba(cs, "siembra"),
    desconectar: (c) => desconectarClientePrueba(c, "siembra:desconexion"),
    hashPassword: (v) => hashPassword(v),
    nuevoRunId: () => nuevoRunId(),
    escribirManifiesto: (runId, manifiesto) => escribirManifiesto(runId, manifiesto, "siembra:manifiesto"),
  };
}

export type ResultadoSiembra =
  | { ok: true; manifiesto: ManifiestoPrueba; rutaManifiesto: string }
  | { ok: false; motivo: "ERROR_TRANSACCION_SIEMBRA" }
  | { ok: false; motivo: "ERROR_ESCRITURA_MANIFIESTO"; manifiestoParaRecuperar: ManifiestoPrueba };

export async function orquestarSiembra(
  deps: DependenciasSiembra = dependenciasRealesSiembra(),
): Promise<ResultadoSiembra> {
  const destino = resumenUrl("SEED_DATABASE_URL", deps.seedDatabaseUrl);
  exigirEntornoConfirmado(destino);

  const prisma = deps.construirAdmin(deps.seedDatabaseUrl as string);
  const runId = deps.nuevoRunId();

  // El rechazo del destino/rol NUNCA se convierte en el resultado suave
  // de mas abajo (ERROR_TRANSACCION_SIEMBRA) -- se relanza tal cual, para
  // que quien llama distinga "la conexion no es la que se confirmo" de
  // "la transaccion de siembra en si fallo".
  try {
    const rol = await verificarRolConexionAdministrativa(prisma, "siembra", ROL_ADMIN_ESPERADO);
    verificarDestinoEfectivo(rol, destino, "siembra");
  } catch (e) {
    await deps.desconectar(prisma);
    throw e;
  }

  let manifiesto: ManifiestoPrueba;
  try {
    // Password de prueba fija por corrida, nunca usada para un login
    // real -- las validaciones llaman directo a
    // verificarSesionVigente()/leerSessionVersionParaLogin(), no pasan
    // por el formulario de login.
    const passwordHash = await deps.hashPassword(`no-se-usa-para-login-real-${runId}`);

    manifiesto = await prisma.$transaction(async (tx: ClientePrueba) => {
      const empresa = await tx.empresa.create({ data: { nombre: nombreEmpresa(runId) } });

      const usuarios = {} as ManifiestoPrueba["usuarios"];
      for (const sufijo of SUFIJOS_USUARIO) {
        const usuario = await tx.usuario.create({
          data: {
            empresaId: empresa.id,
            email: emailUsuario(runId, sufijo),
            nombre: `Prueba revocacion ${sufijo} (${runId})`,
            rol: "ADMINISTRADOR",
            passwordHash,
          },
        });
        usuarios[sufijo] = { id: usuario.id, email: usuario.email, uso: USO_POR_SUFIJO[sufijo] };
      }

      return {
        version: 1,
        runId,
        creadoEn: new Date().toISOString(),
        destino: { host: destino.host, base: destino.base },
        empresaId: empresa.id,
        usuarios,
      } satisfies ManifiestoPrueba;
    });
  } catch {
    // catch SIN binding -- nunca reenvia el error real de Postgres. Si
    // la transaccion fallo, NO se creo nada (atomica).
    logError("siembra:transaccion", "ERROR_TRANSACCION_SIEMBRA");
    await deps.desconectar(prisma);
    return { ok: false, motivo: "ERROR_TRANSACCION_SIEMBRA" };
  }

  let rutaManifiesto: string;
  try {
    rutaManifiesto = deps.escribirManifiesto(runId, manifiesto);
  } catch {
    // Los datos YA fueron creados (la transaccion de arriba tuvo exito)
    // -- perder el manifiesto seria perder el rastro de que filas son de
    // prueba. Se devuelve el manifiesto completo (ids reales incluidos,
    // no son un secreto) para que el script lo imprima y la persona lo
    // guarde a mano.
    await deps.desconectar(prisma);
    return { ok: false, motivo: "ERROR_ESCRITURA_MANIFIESTO", manifiestoParaRecuperar: manifiesto };
  }

  await deps.desconectar(prisma);
  return { ok: true, manifiesto, rutaManifiesto };
}
