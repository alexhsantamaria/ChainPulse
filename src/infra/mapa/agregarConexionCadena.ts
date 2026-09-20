// Infraestructura — agrega una ConexionCadena (con sus Flujos) a una
// Cadena YA EXISTENTE (RF29, requirements.md Seccion 14; siguiente paso
// de Bloque B despues de crearCadenaCompleta.ts, que solo cubre el
// conjunto inicial atomico). Dos escrituras que deben confirmarse o
// fallar juntas (ConexionCadena + al menos un FlujoConexionCadena) ->
// tenantTransaction(), mismo criterio que crearCadenaCompleta.ts y la
// convencion de nombre "xxxAtomico" (ver el comentario de cabecera de
// tenantTransaction.ts).
import { tenantTransaction } from "../prisma/tenantTransaction";

// Valores del enum TipoFlujoV2 (prisma/schema.prisma) repetidos aqui como
// union de strings, mismo criterio que crearCadenaCompleta.ts (el cliente
// generado en este entorno puede quedar desactualizado hasta correr
// `prisma generate` con red real, ver ADR-0003).
export type TipoFlujoV2 = "PRODUCTO_SERVICIO" | "INFORMACION" | "DINERO" | "DECISION" | "DEVOLUCION";

export interface ConexionCadenaEntrada {
  cadenaId: string;
  origenNodoId: string;
  destinoNodoId: string;
  // RF29 -- al menos un flujo es obligatorio, mismo criterio que
  // crearCadenaCompleta.ts.
  flujos: TipoFlujoV2[];
}

export interface ConexionCadenaAgregadaResultado {
  conexionCadenaId: string;
}

export class ConexionCadenaAutoReferenciaError extends Error {
  constructor() {
    super("CONEXION_CADENA_AUTO_REFERENCIA: origen y destino no pueden ser el mismo nodo");
  }
}

export class ConexionCadenaSinFlujosError extends Error {
  constructor() {
    super("CONEXION_CADENA_SIN_FLUJOS: una conexion necesita al menos un flujo");
  }
}

// Se lanza si origenNodoId/destinoNodoId no existen, o existen pero
// pertenecen a otra Cadena (o a otro tenant -- tenantTransaction() ya lo
// filtraria a "no existe" antes de llegar aca, RNF1) que la indicada en
// `cadenaId`. Nunca crear una ConexionCadena que mezcle nodos de dos
// Cadena distintas.
export class ConexionCadenaNodoInvalidoError extends Error {
  constructor() {
    super("CONEXION_CADENA_NODO_INVALIDO: origen o destino no existen o no pertenecen a esta cadena");
  }
}

// P2002 -- @@unique([origenNodoId, destinoNodoId]) en ConexionCadena.
export class ConexionCadenaDuplicadaError extends Error {
  constructor() {
    super("CONEXION_CADENA_DUPLICADA: ya existe una conexion entre ese origen y ese destino");
  }
}

export async function agregarConexionCadenaAtomico(
  empresaId: string,
  entrada: ConexionCadenaEntrada,
): Promise<ConexionCadenaAgregadaResultado> {
  // Validacion de forma antes de abrir la transaccion, mismo criterio que
  // crearCadenaCompleta.ts -- el endpoint que llama a esta funcion ya
  // valida con Zod (auto-referencia incluida via .refine()), pero esta
  // funcion no confia en eso a ciegas ("cinturon y tirantes").
  if (entrada.origenNodoId === entrada.destinoNodoId) {
    throw new ConexionCadenaAutoReferenciaError();
  }
  if (entrada.flujos.length === 0) {
    throw new ConexionCadenaSinFlujosError();
  }

  try {
    return await tenantTransaction(empresaId, async (tx) => {
      // Confirma que ambos nodos existen Y pertenecen a esta Cadena --
      // tenantTransaction() ya filtra por tenant (RNF1), pero un nodo de
      // OTRA Cadena de la misma empresa pasaria ese filtro igual; hay que
      // chequear cadenaId a mano.
      const [origen, destino] = await Promise.all([
        tx.nodo.findUnique({ where: { id: entrada.origenNodoId } }),
        tx.nodo.findUnique({ where: { id: entrada.destinoNodoId } }),
      ]);
      if (!origen || !destino || origen.cadenaId !== entrada.cadenaId || destino.cadenaId !== entrada.cadenaId) {
        throw new ConexionCadenaNodoInvalidoError();
      }

      const conexionCreada = await tx.conexionCadena.create({
        data: {
          cadenaId: entrada.cadenaId,
          origenNodoId: entrada.origenNodoId,
          destinoNodoId: entrada.destinoNodoId,
        },
      });

      // FlujoConexionCadena no esta en TENANT_SCOPED_MODELS (tabla hija
      // sin empresaId propio) -- tx.flujoConexionCadena pasa sin filtro
      // inyectado, protegida solo por la politica RLS de subconsulta de
      // la migracion (capa 2), mismo comentario que crearCadenaCompleta.ts.
      for (const tipo of entrada.flujos) {
        await tx.flujoConexionCadena.create({
          data: { conexionCadenaId: conexionCreada.id, tipo },
        });
      }

      return { conexionCadenaId: conexionCreada.id };
    });
  } catch (err) {
    if (err instanceof ConexionCadenaNodoInvalidoError) {
      throw err;
    }
    // Duck-typing del codigo de error Prisma, mismo criterio que
    // crearCadenaCompleta.ts / errores.ts.
    const codigo = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (codigo === "P2002") {
      throw new ConexionCadenaDuplicadaError();
    }
    throw err;
  }
}
