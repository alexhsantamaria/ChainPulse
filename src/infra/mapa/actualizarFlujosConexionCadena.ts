// Infraestructura — reemplaza los Flujos de una ConexionCadena YA
// EXISTENTE (edicion desde el mapa del canvas, RF34 extension post-
// lanzamiento: Alex probo el mapa 2026-09-23 y pidio poder editar una
// conexion creada por error o que cambio de tipo, sin tener que borrarla
// y volver a crearla). Igual que agregarConexionCadenaAtomico(): dos
// escrituras que deben confirmarse o fallar juntas (borrar los
// FlujoConexionCadena viejos + crear los nuevos) -> tenantTransaction(),
// misma convencion "xxxAtomico".
//
// RF30-33/RF35 (2026-09-24): se agrega `datos`, opcional, para los 9
// campos de una conexion del mapa (requerimiento recibido, oportunidad de
// la informacion, impacto/alternativa/tiempos de RF32, estado de
// evidencia de RF33) que ya existian en el schema desde el Bloque A pero
// nunca se exponian en ningun formulario. Se actualizan en la MISMA
// transaccion que los flujos (un solo `tx.conexionCadena.update()` mas,
// misma fila) -- no son una escritura separada que pueda quedar a medio
// camino respecto de los flujos, asi que no hace falta su propio
// "xxxAtomico".
import { tenantTransaction } from "../prisma/tenantTransaction";
import { ConexionCadenaSinFlujosError, type TipoFlujoV2 } from "./agregarConexionCadena";

export type { TipoFlujoV2 };
export { ConexionCadenaSinFlujosError };

// Mismo criterio que TipoFlujoV2 -- valores del enum repetidos como union
// de strings en vez de importados de "@prisma/client" (ADR-0003, el
// cliente generado en la Mac puede quedar desactualizado).
export type DuracionCategoricaV2 = "CORTO" | "MEDIO" | "LARGO";
export type NivelImpactoV2 = "BAJO" | "MEDIO" | "ALTO" | "CRITICO";
export type EstadoEvidenciaV2Valor = "DECLARADO" | "CONFIRMADO_POR_OTROS" | "VERIFICADO_CON_DATOS";

// RF30-33 -- los 9 campos de datos de una conexion del mapa, todos
// opcionales: un campo ausente en `datos` deja el valor actual sin
// tocar (distinto de `null`, que SI borra un valor ya declarado y lo
// vuelve a "sin confirmar"). Mismo criterio de opcionalidad que el resto
// de esta funcion respecto de `flujos`.
export interface DatosConexionCadenaEntrada {
  requerimientoCantidad?: boolean;
  requerimientoFecha?: boolean;
  requerimientoEspecificacion?: boolean;
  requerimientoAprobacion?: boolean;
  requerimientoPago?: boolean;
  coincidePrioridad?: boolean | null;
  coincideCantidad?: boolean | null;
  coincideFecha?: boolean | null;
  oportunidadInformacion?: DuracionCategoricaV2 | null;
  responsableDecision?: string | null;
  impactoFalla?: NivelImpactoV2 | null;
  tieneAlternativa?: boolean | null;
  alternativaProbada?: boolean | null;
  tiempoTolerable?: DuracionCategoricaV2 | null;
  tiempoRecuperacion?: DuracionCategoricaV2 | null;
  estadoEvidencia?: EstadoEvidenciaV2Valor;
}

export interface ActualizarFlujosConexionCadenaEntrada {
  cadenaId: string;
  conexionCadenaId: string;
  // RF29 -- al menos un flujo es obligatorio, mismo criterio que crear.
  flujos: TipoFlujoV2[];
  // RF30-33, opcional -- ver comentario de cabecera.
  datos?: DatosConexionCadenaEntrada;
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

    // RF30-33 -- misma fila (ConexionCadena) que ya se confirmo arriba,
    // sin necesidad de volver a validar cadenaId/tenant.
    if (entrada.datos) {
      await tx.conexionCadena.update({
        where: { id: entrada.conexionCadenaId },
        data: entrada.datos,
      });
    }
  });
}
