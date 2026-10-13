// Infraestructura SOLO para
// __tests__/proteccionConcurrente.integration.test.ts (Alex, 2026-10-04,
// revision de la version d, punto 1): "guardas explícitas para cada
// identificador, borrados por IDs exactos efectivamente creados y
// preparación transaccional cuando corresponda. No silencies los
// fallos de limpieza como si todo hubiera quedado eliminado. Agregá
// pruebas de fallo parcial, incluido fallo antes de crear la empresa."
//
// EL BUG REAL que esto corrige (version d): la fixture se creaba paso a
// paso, cada create() como su PROPIA operacion (nunca una transaccion),
// asignando cada id a una variable de MODULO (empresaId, usuarioId, ...)
// a medida que cada create() resolvia. Si CUALQUIER create() fallaba a
// mitad de camino -- incluso el primero, antes de que empresaId
// tuviera valor -- las variables de las fixtures siguientes (y en el
// peor caso TODAS) quedaban en `undefined`. afterAll() corria igual
// (vitest llama afterAll aunque beforeAll haya lanzado) y hacia
// `admin.importacionCsv.deleteMany({ where: { empresaId } })` -- con
// empresaId: undefined, Prisma DESCARTA esa clave del where en vez de
// no encontrar nada: la consulta generada termina siendo `DELETE FROM
// importaciones_csv` SIN WHERE, sobre TODA la tabla, nunca limitada a
// esta corrida. El `.catch(() => undefined)` de cada linea ademas
// convertia cualquier fallo real (de ESE borrado amplio o de cualquier
// otro) en silencio total -- la prueba reportaria "limpieza terminada"
// sin que nadie se entere de que, en los hechos, podria haber borrado
// datos ajenos a esta corrida.
//
// LA CORRECCION:
//   1. Creacion TRANSACCIONAL (una sola admin.$transaction(...)): o se
//      crean las 5 filas (empresa/usuario/cadena/definicionKpi/
//      importacionCsv) completas, o NINGUNA queda en la base. Si la
//      transaccion falla, esta funcion LANZA y no devuelve nada -- el
//      llamador nunca recibe un objeto con ids parciales/undefined.
//   2. El RESULTADO de la creacion es la UNICA fuente de ids para el
//      borrado -- nunca variables de modulo reasignadas paso a paso. Si
//      la creacion nunca completo (la funcion lanzo), no existe ningun
//      `FixturesPruebaConcurrencia` que borrar: quien llama (el
//      afterAll de la prueba de integracion) guarda con
//      `if (!fixtures) return;` antes de intentar nada -- nunca un
//      identificador individual sin verificar.
//   3. Borrado por IDS EXACTOS (nunca `where: { empresaId }` ancho),
//      tambien dentro de UNA transaccion (para que un fallo a mitad de
//      camino no deje huerfanos), y SIN silenciar el resultado: salvo
//      el usuario (que el propio cuerpo de la prueba puede haber
//      borrado de verdad -- es justamente lo que ejercita), cualquier
//      otra fila de la fixture que falte al momento de limpiar es un
//      fallo real que esta funcion reporta y relanza, nunca que
//      absorbe en silencio.
import { logError } from "../log";
import type { ClientePrueba } from "./clientePrueba";

export interface FixturesPruebaConcurrencia {
  empresaId: string;
  usuarioId: string;
  cadenaId: string;
  definicionKpiId: string;
  importacionBaseId: string;
}

// Dos interfaces NO genericas a proposito (en vez de una sola con
// $transaction<T>) -- mismo criterio que ClienteEliminarUsuarioProtegido
// en eliminarUsuarioProtegido.ts: evita problemas de varianza al tipar
// los mocks de las pruebas, y cada funcion de este archivo solo
// necesita UN tipo de retorno concreto para su propia transaccion.
export interface ClienteCrearFixturesConcurrencia {
  $transaction(fn: (tx: ClientePrueba) => Promise<FixturesPruebaConcurrencia>): Promise<FixturesPruebaConcurrencia>;
}

export interface ClienteBorrarFixturesConcurrencia {
  $transaction(
    fn: (tx: ClientePrueba) => Promise<ResultadoBorradoFixturesConcurrencia>,
  ): Promise<ResultadoBorradoFixturesConcurrencia>;
}

/**
 * Crea las 5 filas descartables de esta prueba (prefijo
 * ZZ_PRUEBA_CONCURRENCIA) como UNA transaccion atomica -- ver el punto 1
 * del comentario de cabecera. Devuelve los ids EXACTOS creados solo si
 * los 5 create() tuvieron exito; si cualquiera falla (incluido el
 * primero, antes de crear la empresa), lanza y no devuelve nada.
 */
export async function crearFixturesPruebaConcurrencia(
  admin: ClienteCrearFixturesConcurrencia,
  prefijo: string,
  sufijoUnico: string,
  contexto: string,
): Promise<FixturesPruebaConcurrencia> {
  try {
    return await admin.$transaction(async (tx) => {
      const empresa = await tx.empresa.create({ data: { nombre: `${prefijo}_EMPRESA_${sufijoUnico}` } });

      const usuario = await tx.usuario.create({
        data: {
          empresaId: empresa.id,
          email: `${prefijo.toLowerCase()}-${sufijoUnico}@chainpulse.invalid`,
          nombre: `${prefijo}_USUARIO`,
          rol: "RESPONSABLE",
          // Placeholder -- esta prueba nunca autentica a este usuario,
          // solo lo lee/borra por id. Nunca un hash real.
          passwordHash: "NO_SE_USA_EN_ESTA_PRUEBA",
        },
      });

      const cadena = await tx.cadena.create({
        data: {
          empresaId: empresa.id,
          nombre: `${prefijo}_CADENA_${sufijoUnico}`,
          productoServicio: "prueba",
          periodoInicio: new Date("2026-01-01"),
          periodoFin: new Date("2026-12-31"),
          tipoOperacion: "otra",
        },
      });

      const definicionKpi = await tx.definicionKpi.create({
        data: {
          codigo: `${prefijo}_${sufijoUnico}`,
          numero: Number(sufijoUnico.replace(/[^0-9]/g, "").slice(0, 6) || "999999"),
          nombre: `${prefijo}_KPI`,
          descripcion: "prueba de integracion -- proteccion concurrente",
          formula: "n/a",
          unidad: "n/a",
          periodoDefecto: "mensual",
        },
      });

      // La importacion que el escenario concurrente va a "confirmar"
      // (escribir confirmadaPorId) -- empieza sin confirmar.
      const importacionBase = await tx.importacionCsv.create({
        data: {
          empresaId: empresa.id,
          cadenaId: cadena.id,
          definicionKpiId: definicionKpi.id,
          objetoStorageKey: `${prefijo}/objeto-de-prueba-${sufijoUnico}`,
        },
      });

      return {
        empresaId: empresa.id,
        usuarioId: usuario.id,
        cadenaId: cadena.id,
        definicionKpiId: definicionKpi.id,
        importacionBaseId: importacionBase.id,
      };
    });
  } catch {
    // catch SIN binding -- nunca reenvia el error real de Postgres.
    // La transaccion de arriba garantiza que, si esto se alcanza, la
    // base quedo EXACTAMENTE como antes de llamar a esta funcion (nada
    // a medio crear) -- no hay nada que este catch necesite revertir.
    logError(contexto, "ERROR_CREACION_FIXTURES_CONCURRENCIA");
    throw new Error("ERROR_CREACION_FIXTURES_CONCURRENCIA");
  }
}

export interface ResultadoBorradoFixturesConcurrencia {
  // true cuando el propio cuerpo de la prueba ya habia borrado al
  // usuario (el camino feliz de ejercitar eliminarUsuarioConProteccion
  // Concurrente) -- un count:0 aca es un resultado ESPERADO, nunca un
  // fallo de limpieza.
  usuarioYaNoEstaba: boolean;
}

/**
 * Borra EXACTAMENTE las 5 filas identificadas por `fixtures` (nunca un
 * filtro por empresaId solo) dentro de UNA transaccion -- ver el punto
 * 3 del comentario de cabecera. A diferencia del resto de las
 * herramientas de pruebaRevocacion/ (que colapsan cualquier fallo en un
 * codigo fijo y siguen), esta funcion SI relanza: quien la llama (el
 * afterAll de una prueba) necesita saber de verdad si la limpieza
 * fallo, nunca asumir en silencio que ya quedo todo borrado. Solo el
 * usuario tolera un count:0 -- cualquier otra fila ausente es un fallo
 * real (otra cosa la borro, o nunca se creo como se esperaba).
 */
export async function borrarFixturesPruebaConcurrencia(
  admin: ClienteBorrarFixturesConcurrencia,
  fixtures: FixturesPruebaConcurrencia,
  contexto: string,
): Promise<ResultadoBorradoFixturesConcurrencia> {
  try {
    return await admin.$transaction(async (tx) => {
      // La importacion NUNCA deberia faltar -- ningun escenario de esta
      // prueba la borra, solo la muta (confirmadaPorId puede terminar
      // en null).
      const borradoImportacion = await tx.importacionCsv.deleteMany({ where: { id: fixtures.importacionBaseId } });
      if (borradoImportacion.count !== 1) {
        throw new Error("IMPORTACION_BASE_FALTANTE_AL_LIMPIAR");
      }

      // El usuario SI puede faltar de verdad -- es justamente lo que el
      // cuerpo de la prueba intenta borrar (eliminarUsuarioConProteccion
      // Concurrente). count 0 aca es el resultado esperado del camino
      // feliz, nunca un fallo.
      const borradoUsuario = await tx.usuario.deleteMany({ where: { id: fixtures.usuarioId } });

      const borradoCadena = await tx.cadena.deleteMany({ where: { id: fixtures.cadenaId } });
      if (borradoCadena.count !== 1) {
        throw new Error("CADENA_FALTANTE_AL_LIMPIAR");
      }

      const borradoDefinicion = await tx.definicionKpi.deleteMany({ where: { id: fixtures.definicionKpiId } });
      if (borradoDefinicion.count !== 1) {
        throw new Error("DEFINICION_KPI_FALTANTE_AL_LIMPIAR");
      }

      const borradoEmpresa = await tx.empresa.deleteMany({ where: { id: fixtures.empresaId } });
      if (borradoEmpresa.count !== 1) {
        throw new Error("EMPRESA_FALTANTE_AL_LIMPIAR");
      }

      return { usuarioYaNoEstaba: borradoUsuario.count === 0 };
    });
  } catch {
    // catch SIN binding -- pero, a diferencia de orquestarLimpieza.ts,
    // esto SI relanza (ver el comentario de la funcion): un fallo de
    // limpieza en una prueba tiene que ser visible para quien la corre,
    // nunca quedar implicito como "listo, se borro todo".
    logError(contexto, "ERROR_BORRADO_FIXTURES_CONCURRENCIA");
    throw new Error("ERROR_BORRADO_FIXTURES_CONCURRENCIA");
  }
}

// --- Fixtures CRUZADAS (otra empresa) -------------------------------
//
// Punto 2 (revision de la version d): "incluido el caso de referencias
// desde otra empresa que RLS podría ocultar al rol de aplicación" --
// esto crea una SEGUNDA empresa, con su propia Cadena, y una
// ImportacionCsv de ESA otra empresa cuyo confirmadaPorId puede
// apuntar (segun la prueba) al usuario de la fixture principal. Separado
// de crearFixturesPruebaConcurrencia/borrarFixturesPruebaConcurrencia
// (en vez de fusionarlo en una sola fixture "de 8 filas") para que cada
// prueba de proteccionConcurrente.integration.test.ts pueda componer
// solo lo que necesita, y para no tener que re-probar la fixture
// principal (ya cubierta arriba) cada vez que esto cambie. Comparte el
// mismo DefinicionKpi de la fixture principal (recibido por parametro)
// -- DefinicionKpi no tiene empresaId, es catalogo global, nunca hace
// falta uno por empresa.

export interface FixturaCruzadaPruebaConcurrencia {
  otraEmpresaId: string;
  otraCadenaId: string;
  importacionCruzadaId: string;
}

export interface ClienteCrearFixturaCruzadaPruebaConcurrencia {
  $transaction(
    fn: (tx: ClientePrueba) => Promise<FixturaCruzadaPruebaConcurrencia>,
  ): Promise<FixturaCruzadaPruebaConcurrencia>;
}

export interface ClienteBorrarFixturaCruzadaPruebaConcurrencia {
  $transaction(fn: (tx: ClientePrueba) => Promise<void>): Promise<void>;
}

/**
 * Crea la empresa/cadena/importacion de la OTRA empresa (prefijo +
 * "_CRUZADA"), transaccional (mismo criterio que crearFixturesPrueba
 * Concurrencia). `importacionCruzadaId.confirmadaPorId` arranca en
 * null SIEMPRE -- cada prueba decide, como su propio paso de arrange,
 * si lo fija antes o durante el escenario que ejercita.
 */
export async function crearFixturaCruzadaPruebaConcurrencia(
  admin: ClienteCrearFixturaCruzadaPruebaConcurrencia,
  prefijo: string,
  sufijoUnico: string,
  definicionKpiId: string,
  contexto: string,
): Promise<FixturaCruzadaPruebaConcurrencia> {
  try {
    return await admin.$transaction(async (tx) => {
      const otraEmpresa = await tx.empresa.create({ data: { nombre: `${prefijo}_CRUZADA_EMPRESA_${sufijoUnico}` } });
      const otraCadena = await tx.cadena.create({
        data: {
          empresaId: otraEmpresa.id,
          nombre: `${prefijo}_CRUZADA_CADENA_${sufijoUnico}`,
          productoServicio: "prueba",
          periodoInicio: new Date("2026-01-01"),
          periodoFin: new Date("2026-12-31"),
          tipoOperacion: "otra",
        },
      });
      const importacionCruzada = await tx.importacionCsv.create({
        data: {
          empresaId: otraEmpresa.id,
          cadenaId: otraCadena.id,
          definicionKpiId,
          objetoStorageKey: `${prefijo}/objeto-cruzado-de-prueba-${sufijoUnico}`,
          // confirmadaPorId: nunca se fija aca -- ver el comentario de
          // la funcion.
        },
      });
      return { otraEmpresaId: otraEmpresa.id, otraCadenaId: otraCadena.id, importacionCruzadaId: importacionCruzada.id };
    });
  } catch {
    logError(contexto, "ERROR_CREACION_FIXTURA_CRUZADA_CONCURRENCIA");
    throw new Error("ERROR_CREACION_FIXTURA_CRUZADA_CONCURRENCIA");
  }
}

/**
 * Borra la importacion/cadena/empresa cruzadas por ID EXACTO, dentro de
 * UNA transaccion -- mismo criterio de "nunca silenciar" que
 * borrarFixturesPruebaConcurrencia. Sin tolerancia de count:0 en NADA
 * aca: a diferencia del usuario de la fixture principal, ningun
 * escenario de esta prueba borra la importacion/cadena/empresa
 * cruzadas -- solo mutan confirmadaPorId.
 */
export async function borrarFixturaCruzadaPruebaConcurrencia(
  admin: ClienteBorrarFixturaCruzadaPruebaConcurrencia,
  fixtura: FixturaCruzadaPruebaConcurrencia,
  contexto: string,
): Promise<void> {
  try {
    await admin.$transaction(async (tx) => {
      const borradoImportacion = await tx.importacionCsv.deleteMany({ where: { id: fixtura.importacionCruzadaId } });
      if (borradoImportacion.count !== 1) {
        throw new Error("IMPORTACION_CRUZADA_FALTANTE_AL_LIMPIAR");
      }
      const borradoCadena = await tx.cadena.deleteMany({ where: { id: fixtura.otraCadenaId } });
      if (borradoCadena.count !== 1) {
        throw new Error("CADENA_CRUZADA_FALTANTE_AL_LIMPIAR");
      }
      const borradoEmpresa = await tx.empresa.deleteMany({ where: { id: fixtura.otraEmpresaId } });
      if (borradoEmpresa.count !== 1) {
        throw new Error("EMPRESA_CRUZADA_FALTANTE_AL_LIMPIAR");
      }
    });
  } catch {
    logError(contexto, "ERROR_BORRADO_FIXTURA_CRUZADA_CONCURRENCIA");
    throw new Error("ERROR_BORRADO_FIXTURA_CRUZADA_CONCURRENCIA");
  }
}
