// Infraestructura — creacion atomica de una Cadena con sus Nodos y
// ConexionCadena iniciales (RF27-RF29, requirements.md Seccion 14;
// PLAN-DE-TRABAJO.md Seccion 0.1 -- primer uso real de
// tenantTransaction() fuera de auth/, el caso que motivo construirlo).
//
// Por que una sola operacion atomica: si la creacion de una ConexionCadena
// fallara a mitad de camino (por ejemplo, el ultimo Flujo de la lista
// viola una restriccion), no debe quedar una Cadena huerfana sin ninguna
// conexion, ni Nodos sueltos sin las conexiones que el usuario pidio crear
// junto con ellos -- todo o nada, misma logica que registrarEmpresaYAdmin()
// (src/infra/auth/registro.ts), el otro precedente de tenantTransaction().
//
// No usa tenantClient(): esa capa abre una transaccion nueva por cada
// llamada (Cadena, cada Nodo y cada ConexionCadena en trasacciones
// separadas), exactamente el problema que tenantTransaction() resuelve.
//
// Los Nodos y ConexionCadena se referencian por indice dentro del array de
// entrada (no por id real, que todavia no existe antes de crear el Nodo) --
// el mismo patron que un formulario de alta con filas relacionadas entre
// si necesita resolver del lado del servidor.
import { tenantTransaction } from "../prisma/tenantTransaction";

// Valores del enum TipoNodo (prisma/schema.prisma) repetidos aqui como
// union de strings, no importados de "@prisma/client": el cliente
// generado en este entorno (Mac, sin motor Rust real -- ver README) puede
// quedar desactualizado respecto del schema hasta que se corra
// `prisma generate` con red real (Windows) — mismo criterio ya usado en
// src/infra/auth/registro.ts (`rol: "ADMINISTRADOR"` como literal, no
// enum importado).
export type TipoNodo = "ORGANIZACION" | "AREA" | "INSTALACION" | "PROCESO" | "PERSONA_DECISORA" | "SISTEMA";

// Valores del enum TipoFlujoV2.
export type TipoFlujoV2 = "PRODUCTO_SERVICIO" | "INFORMACION" | "DINERO" | "DECISION" | "DEVOLUCION";

export interface NodoEntrada {
  nombre: string;
  tipo: TipoNodo;
  // RF28 -- puente opcional a un Eslabon ya existente de la misma
  // empresa, nunca exigido para poder crear el Nodo.
  eslabonRefId?: string | null;
}

export interface ConexionEntrada {
  // Indices dentro del array `nodos` de CadenaEntrada -- no ids reales.
  origenIndex: number;
  destinoIndex: number;
  // RF29 -- una conexion soporta multiples flujos simultaneos; al menos
  // uno es obligatorio (una conexion sin ningun flujo no representa nada
  // todavia declarado entre esos dos nodos).
  flujos: TipoFlujoV2[];
}

export interface CadenaEntrada {
  nombre: string;
  productoServicio: string;
  periodoInicio: Date;
  periodoFin: Date;
  tipoOperacion: string;
  nodos: NodoEntrada[];
  conexiones: ConexionEntrada[];
}

export interface CadenaCompletaResultado {
  cadenaId: string;
  // Ids reales de los Nodos creados, en el mismo orden que `nodos` en la
  // entrada -- para que el llamador pueda mapear indice -> id real.
  nodoIds: string[];
}

export class ConexionCadenaIndiceInvalidoError extends Error {
  constructor(indice: number) {
    super(`CONEXION_CADENA_INDICE_INVALIDO: no existe un nodo en la posicion ${indice}`);
  }
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

// P2002 (restriccion unica de Postgres, via Prisma) -- se lanza si la
// entrada pide dos conexiones con el mismo par (origenIndex, destinoIndex)
// (@@unique([origenNodoId, destinoNodoId]) en ConexionCadena).
export class ConexionCadenaDuplicadaError extends Error {
  constructor() {
    super("CONEXION_CADENA_DUPLICADA: ya existe una conexion entre ese origen y ese destino");
  }
}

export async function crearCadenaCompleta(
  empresaId: string,
  entrada: CadenaEntrada,
): Promise<CadenaCompletaResultado> {
  // Validacion de forma (indices/auto-referencia/flujos vacios) antes de
  // abrir la transaccion -- fallar rapido sin gastar una conexion a la
  // base por un error que ya se puede detectar con los datos en memoria.
  // La validacion de tipos/formato (Zod) es responsabilidad del endpoint
  // que llame a esta funcion (Bloque B, "Zod al borde") -- esta funcion
  // asume que `entrada` ya tiene la forma correcta y valida solo las
  // reglas que dependen de la relacion entre nodos y conexiones.
  for (const conexion of entrada.conexiones) {
    if (conexion.origenIndex < 0 || conexion.origenIndex >= entrada.nodos.length) {
      throw new ConexionCadenaIndiceInvalidoError(conexion.origenIndex);
    }
    if (conexion.destinoIndex < 0 || conexion.destinoIndex >= entrada.nodos.length) {
      throw new ConexionCadenaIndiceInvalidoError(conexion.destinoIndex);
    }
    if (conexion.origenIndex === conexion.destinoIndex) {
      throw new ConexionCadenaAutoReferenciaError();
    }
    if (conexion.flujos.length === 0) {
      throw new ConexionCadenaSinFlujosError();
    }
  }

  try {
    return await tenantTransaction(empresaId, async (tx) => {
      const cadena = await tx.cadena.create({
        data: {
          nombre: entrada.nombre,
          productoServicio: entrada.productoServicio,
          periodoInicio: entrada.periodoInicio,
          periodoFin: entrada.periodoFin,
          tipoOperacion: entrada.tipoOperacion,
        },
      });

      const nodoIds: string[] = [];
      for (const nodo of entrada.nodos) {
        const creado = await tx.nodo.create({
          data: {
            cadenaId: cadena.id,
            nombre: nodo.nombre,
            tipo: nodo.tipo,
            eslabonRefId: nodo.eslabonRefId ?? null,
          },
        });
        nodoIds.push(creado.id);
      }

      for (const conexion of entrada.conexiones) {
        const conexionCreada = await tx.conexionCadena.create({
          data: {
            cadenaId: cadena.id,
            origenNodoId: nodoIds[conexion.origenIndex],
            destinoNodoId: nodoIds[conexion.destinoIndex],
          },
        });
        // FlujoConexionCadena no esta en TENANT_SCOPED_MODELS (tabla hija
        // sin empresaId propio, PATRONES.md Seccion 5) -- tx.flujoConexionCadena
        // pasa sin filtro inyectado, protegida solo por la politica RLS de
        // subconsulta de la migracion (capa 2). No hace falta empresaId
        // aca: la FK a conexionCadena.id ya la ata al tenant correcto.
        for (const tipo of conexion.flujos) {
          await tx.flujoConexionCadena.create({
            data: { conexionCadenaId: conexionCreada.id, tipo },
          });
        }
      }

      return { cadenaId: cadena.id, nodoIds };
    });
  } catch (err) {
    // Duck-typing del codigo de error Prisma, mismo criterio que
    // registro.ts (P2002 = violacion de restriccion unica) -- en modo
    // engineType="client" el tipo Prisma.PrismaClientKnownRequestError no
    // queda re-exportado desde "@prisma/client" en este entorno.
    const codigo = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (codigo === "P2002") {
      throw new ConexionCadenaDuplicadaError();
    }
    throw err;
  }
}
