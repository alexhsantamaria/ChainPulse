// Infraestructura — reemplaza los Flujos de una ConexionCadena YA
// EXISTENTE (edicion desde el mapa del canvas, RF34 extension post-
// lanzamiento: Alex probo el mapa 2026-09-23 y pidio poder editar una
// conexion creada por error o que cambio de tipo, sin tener que borrarla
// y volver a crearla). Igual que agregarConexionCadenaAtomico(): dos
// escrituras que deben confirmarse o fallar juntas (borrar los
// FlujoConexionCadena viejos + crear los nuevos) -> tenantTransaction(),
// misma convencion "xxxAtomico".
import { tenantTransaction } from "../prisma/tenantTransaction";
import { ConexionCadenaSinFlujosError, type TipoFlujoV2 } from "./agregarConexionCadena";

export type { TipoFlujoV2 };
export { ConexionCadenaSinFlujosError };

export interface ActualizarFlujosConexionCadenaEntrada {
  cadenaId: string;
  conexionCadenaId: string;
  // RF29 -- al menos un flujo es obligatorio, mismo criterio que crear.
  flujos: TipoFlujoV2[];
}

// Se lanza si conexionCadenaId no existe, o existe pero pertenece a otra
// Cadena (o a otro tenant -- tenantTransaction() ya lo filtraria a "no
// existe" antes de llegar aca, RNF1) que la indicada en `cadenaId`.
export class ConexionCadenaInexistenteError extends Error {
  constructor() {
    super("CONEXION_CADENA_INEXISTENTE: la conexion no existe o no pertenece a esta cadena");
  }
}

export async function actualizarFlujosConexionCadenaAtomico(
  empresaId: string,
  entrada: ActualizarFlujosConexionCadenaEntrada,
): Promise<void> {
  // Validacion de forma antes de abrir la transaccion, mismo criterio que
  // agregarConexionCadenaAtomico() -- el endpoint ya valida con Zod, pero
  // esta funcion no confia en eso a ciegas.
  if (entrada.flujos.length === 0) {
    throw new ConexionCadenaSinFlujosError();
  }

  await tenantTransaction(empresaId, async (tx) => {
    // Confirma que la conexion existe Y pertenece a esta Cadena --
    // tenantTransaction() ya filtra por tenant (RNF1), pero una conexion
    // de OTRA Cadena de la misma empresa pasaria ese filtro igual; hay
    // que chequear cadenaId a mano, mismo criterio que la ruta de nodos.
    const conexion = await tx.conexionCadena.findUnique({ where: { id: entrada.conexionCadenaId } });
    if (!conexion || conexion.cadenaId !== entrada.cadenaId) {
      throw new ConexionCadenaInexistenteError();
    }

    // FlujoConexionCadena no esta en TENANT_SCOPED_MODELS (tabla hija sin
    // empresaId propio) -- tx.flujoConexionCadena pasa sin filtro
    // inyectado, protegida solo por la politica RLS de subconsulta de la
    // migracion (capa 2), mismo comentario que agregarConexionCadena.ts.
    await tx.flujoConexionCadena.deleteMany({ where: { conexionCadenaId: entrada.conexionCadenaId } });
    for (const tipo of entrada.flujos) {
      await tx.flujoConexionCadena.create({
        data: { conexionCadenaId: entrada.conexionCadenaId, tipo },
      });
    }
  });
}
