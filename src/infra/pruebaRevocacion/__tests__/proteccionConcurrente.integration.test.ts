// Prueba de INTEGRACION -- proteccion concurrente de
// eliminarUsuarioConProteccionConcurrente()/orquestarLimpieza() contra
// Postgres real (Alex, 2026-10-04, revision de la version d: dos
// bloqueos).
//
// BLOQUEO 1 -- afterAll() podia llegar a
// admin.importacionCsv.deleteMany({ where: { empresaId } }) con
// empresaId TODAVIA undefined si beforeAll() fallaba antes de asignarlo
// (y vitest llama afterAll() igual aunque beforeAll() haya lanzado):
// Prisma descarta una clave `undefined` del where en vez de no
// encontrar nada, asi que esa consulta se volvia un DELETE sin filtro,
// sobre TODA la tabla. El `.catch(() => undefined)` de cada linea
// ademas convertia cualquier fallo real en silencio total.
//
// CORREGIDO reemplazando toda la creacion/borrado de fixtures por
// crearFixturesPruebaConcurrencia()/borrarFixturesPruebaConcurrencia()
// y crearFixturaCruzadaPruebaConcurrencia()/borrarFixturaCruzadaPrueba
// Concurrencia() (ver fixturesPruebaConcurrencia.ts y sus 22 pruebas
// unitarias, que cubren especificamente los fallos parciales -- incluido
// fallo antes de crear la empresa): creacion TRANSACCIONAL (o se crean
// todas las filas, o ninguna), borrado por IDS EXACTOS devueltos por esa
// creacion (nunca una variable de modulo reasignada paso a paso), y cada
// `afterEach` de este archivo guarda con `if (!fixtures) return` antes
// de intentar nada -- y NUNCA silencia un fallo de limpieza real (ver
// mas abajo: se acumulan y se relanzan al final del afterEach, nunca un
// `.catch(() => undefined)`).
//
// BLOQUEO 2 -- la prueba concurrente anterior reproducia SQL
// independiente con dos conexiones propias (ambas con el rol OWNER,
// ambas SERIALIZABLE): nunca llamaba a eliminarUsuarioConProteccion
// Concurrente() ni a orquestarLimpieza(), asi que nunca pudo haber
// detectado que la primera, en la version anterior, usaba el rol
// EQUIVOCADO (chainpulse_app, sujeto a RLS) para un chequeo que
// necesita ver referencias de OTRA empresa -- ver eliminarUsuarioProtegido.ts,
// PARTE 1, para la evidencia completa de ese bug real.
//
// CORREGIDO: los describe() de mas abajo llaman a las funciones REALES
// (eliminarUsuarioConProteccionConcurrente()/orquestarLimpieza()), con
// el rol ADMIN real (unico corregido en esta revision) y, para el
// escenario concurrente, una operacion representativa de trafico real:
// tenantTransaction() REAL (rol chainpulse_app, READ COMMITTED -- el
// mismo mecanismo que usa de verdad
// src/app/api/kpis/cobertura/importaciones/[id]/confirmar/route.ts para
// confirmar una importacion), nunca una reimplementacion propia del
// camino de produccion.
//
// Se conserva, ADEMAS (no en lugar de lo anterior), una demostracion del
// MECANISMO DE AISLAMIENTO EN SI (dos conexiones crudas, ambas
// SERIALIZABLE, con el orden de los awaits armado a mano para una
// interleaving determinista) -- pero relabeled: esto prueba que SSI de
// Postgres aborta de verdad un ciclo de dos transacciones SERIALIZABLE
// en conflicto, NUNCA que las funciones reales de esta herramienta estan
// protegidas end-to-end (eso lo prueban, con las funciones reales, los
// otros dos describe() de abajo). "No declares acreditada la proteccion
// concurrente mediante esa prueba generica" (Alex) -- por eso esta
// demostracion ya no es la UNICA evidencia de proteccion de este
// archivo.
//
// La prueba de la operacion concurrente REPRESENTATIVA (dentro del
// describe de eliminarUsuarioConProteccionConcurrente) es
// deliberadamente PROBABILISTICA, no determinista -- ver su comentario
// propio para la explicacion completa de por que (las funciones reales
// no exponen ningun punto para pausar su transaccion desde afuera) y
// que es exactamente lo que verifica en cada rama posible, sin afirmar
// una garantia que Postgres no da. Eso es la correccion al punto de
// Alex sobre la afirmacion de SSI: ver tambien eliminarUsuarioProtegido.ts,
// PARTE 2, para el alcance real (y el limite real) de esa garantia.
//
// *** NO EJECUTADA COMO PARTE DE ESTA ENTREGA ***
// Este archivo termina en ".integration.test.ts" (excluido de
// `npx vitest run`/`npm run test` por vitest.config.ts) -- solo corre
// con `npm run test:integration`, a mano, con DATABASE_URL,
// SEED_DATABASE_URL y ENTORNO_PRUEBA_CONFIRMADO reales apuntando al
// entorno de prueba (ver destinoPrueba.ts) -- igual criterio que el
// resto de las *.integration.test.ts de este repo. Esta sesion no corrio
// ese comando ni tiene esas variables seteadas -- el mecanismo nunca se
// ejercito de verdad contra Postgres en esta entrega, solo se preparo
// para revision.
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { construirClientePrueba, desconectarClientePrueba, type ClientePrueba } from "../clientePrueba";
import {
  crearFixturesPruebaConcurrencia,
  borrarFixturesPruebaConcurrencia,
  crearFixturaCruzadaPruebaConcurrencia,
  borrarFixturaCruzadaPruebaConcurrencia,
  type FixturesPruebaConcurrencia,
  type FixturaCruzadaPruebaConcurrencia,
} from "../fixturesPruebaConcurrencia";
import { eliminarUsuarioConProteccionConcurrente } from "../eliminarUsuarioProtegido";
import { orquestarLimpieza } from "../orquestarLimpieza";
import { tenantTransaction } from "../../prisma/tenantTransaction";
import { nuevoRunId, nombreEmpresa, emailUsuario, SUFIJOS_USUARIO, USO_POR_SUFIJO, type ManifiestoPrueba } from "../manifiesto";

const PREFIJO = "ZZ_PRUEBA_CONCURRENCIA";

// Un sufijo nuevo por cada invocacion (no solo por corrida de archivo) --
// cada describe/it de abajo crea y borra su PROPIA fixture, nunca
// comparte una entre pruebas, para que ninguna quede acoplada al orden
// de las demas.
function sufijoUnico(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let admin: ClientePrueba;

beforeAll(() => {
  // Guardias explicitas, mismo criterio que el resto de las
  // *.integration.test.ts de este repo: fallar con un mensaje claro
  // ANTES de intentar nada, en vez de un error criptico de conexion.
  if (!process.env.SEED_DATABASE_URL) {
    throw new Error(
      "Esta prueba necesita SEED_DATABASE_URL (rol neondb_owner) -- para las fixtures descartables Y porque " +
        "eliminarUsuarioConProteccionConcurrente()/orquestarLimpieza() deben correr por el rol ADMIN real (ver " +
        "eliminarUsuarioProtegido.ts, PARTE 1). No se corrio -- ver el comentario de cabecera de este archivo.",
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Falta DATABASE_URL -- necesaria para tenantTransaction() (la operacion concurrente representativa corre " +
        "por el rol chainpulse_app real, igual que en produccion). Ver el comentario de cabecera de este archivo.",
    );
  }
  if (!process.env.ENTORNO_PRUEBA_CONFIRMADO) {
    // orquestarLimpieza() exige esto por su cuenta (exigirEntornoConfirmado,
    // ver destinoPrueba.ts) -- esta guardia solo adelanta un mensaje claro
    // en vez de dejar que la prueba de orquestarLimpieza() falle con un
    // error generico mas abajo.
    throw new Error(
      "Falta ENTORNO_PRUEBA_CONFIRMADO (destino EXACTO confirmado, ver destinoPrueba.ts) -- orquestarLimpieza() " +
        "lo exige el mismo. Ver el comentario de cabecera de este archivo.",
    );
  }

  admin = construirClientePrueba(process.env.SEED_DATABASE_URL, "integracion:concurrencia:admin");
});

afterAll(async () => {
  if (!admin) return;
  await desconectarClientePrueba(admin, "integracion:concurrencia:desconexion-admin");
});

// =====================================================================
// 1. MECANISMO SERIALIZABLE EN AISLAMIENTO -- ver el comentario de
//    cabecera: demuestra que Postgres SSI aborta de verdad un ciclo de
//    dos transacciones SERIALIZABLE en conflicto. NUNCA se declara aca
//    (ni en ningun otro lugar de este archivo) que esto por si solo
//    acredita la proteccion de las funciones reales -- eso lo hacen los
//    describe() 2 y 3, con las funciones reales.
// =====================================================================
describe("mecanismo de aislamiento SERIALIZABLE, EN AISLAMIENTO (dos conexiones crudas, ambas SERIALIZABLE)", () => {
  let fixtures: FixturesPruebaConcurrencia | undefined;

  beforeEach(async () => {
    fixtures = await crearFixturesPruebaConcurrencia(admin, PREFIJO, sufijoUnico(), "integracion:mecanismo:setup");
  }, 30000);

  afterEach(async () => {
    if (!fixtures) return;
    const fixturesLocal = fixtures;
    fixtures = undefined;
    // Nunca silenciado -- si esto falla, el afterEach falla, visible
    // para quien corra la prueba (ver el comentario de cabecera, bloqueo 1).
    await borrarFixturesPruebaConcurrencia(admin, fixturesLocal, "integracion:mecanismo:teardown");
  }, 30000);

  it(
    "dos transacciones SERIALIZABLE con un ciclo read-write (A lee importaciones_csv, B lee usuarios; B escribe " +
      "importaciones_csv, A intenta borrar usuarios) -- Postgres aborta una con serialization_failure (40001)",
    async () => {
      const usuarioId = fixtures!.usuarioId;
      const importacionBaseId = fixtures!.importacionBaseId;

      const clienteA = new Client({ connectionString: process.env.SEED_DATABASE_URL });
      const clienteB = new Client({ connectionString: process.env.SEED_DATABASE_URL });
      await clienteA.connect();
      await clienteB.connect();

      try {
        await clienteA.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await clienteB.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

        // A: "¿hay alguna importacion que referencia a este usuario?"
        // (el chequeo de cascada real) -- responde 0, nadie lo
        // referencia todavia.
        const lecturaA = await clienteA.query(
          'SELECT count(*)::int AS cantidad FROM importaciones_csv WHERE "confirmadaPorId" = $1',
          [usuarioId],
        );
        expect(lecturaA.rows[0].cantidad).toBe(0);

        // B: lee al mismo usuario (igual que la ruta de confirmar real,
        // que valida al usuario que confirma ANTES de guardar su id).
        const lecturaB = await clienteB.query('SELECT id FROM usuarios WHERE id = $1', [usuarioId]);
        expect(lecturaB.rows).toHaveLength(1);

        // B escribe DENTRO del predicado que A ya leyo -- confirma la
        // importacion base con este usuario, y COMMITEA primero.
        await clienteB.query('UPDATE importaciones_csv SET "confirmadaPorId" = $1 WHERE id = $2', [
          usuarioId,
          importacionBaseId,
        ]);
        await clienteB.query("COMMIT");

        // A escribe DENTRO del predicado que B ya leyo -- intenta borrar
        // al usuario que B acaba de confirmar como referenciado. Esto
        // cierra el ciclo (A -rw-> B via importaciones_csv, B -rw-> A via
        // usuarios): Postgres SSI tiene que abortar una de las dos. El
        // DELETE en si, o el COMMIT que sigue, puede ser el punto donde
        // Postgres lo detecta -- por eso el expect cubre ambos, sin
        // asumir cual de los dos.
        let fallo: unknown;
        try {
          await clienteA.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
          await clienteA.query("COMMIT");
        } catch (e) {
          fallo = e;
        }

        expect(fallo).toBeDefined();
        // SQLSTATE 40001 = serialization_failure -- nunca el mensaje
        // crudo (que puede variar de redaccion entre versiones de
        // Postgres), siempre el codigo.
        expect((fallo as { code?: string } | undefined)?.code).toBe("40001");

        // A quedo abortada por Postgres -- limpiar su lado de la conexion
        // antes de cerrarla (mejor esfuerzo, Postgres ya la trata como
        // revertida).
        await clienteA.query("ROLLBACK").catch(() => undefined);

        // La importacion SI quedo confirmada por el usuario (B commiteo
        // antes del conflicto) -- y el usuario SIGUE existiendo (A, que
        // intentaba borrarlo, fue la abortada o nunca commiteo). Esto es
        // exactamente el punto: sin SERIALIZABLE, nada hubiera impedido
        // que A borrara al usuario de todas formas, dejando
        // confirmadaPorId en un SET NULL silencioso.
        const importacionFinal = await admin.importacionCsv.findUnique({ where: { id: importacionBaseId } });
        expect(importacionFinal?.confirmadaPorId).toBe(usuarioId);
        const usuarioFinal = await admin.usuario.findUnique({ where: { id: usuarioId } });
        expect(usuarioFinal).not.toBeNull();
      } finally {
        await clienteA.end().catch(() => undefined);
        await clienteB.end().catch(() => undefined);
      }
    },
    30000,
  );
});

// =====================================================================
// 2. eliminarUsuarioConProteccionConcurrente() -- LA FUNCION REAL, con
//    el rol ADMIN real. Fixture principal + fixture CRUZADA (otra
//    empresa) -- ver fixturesPruebaConcurrencia.ts.
// =====================================================================
describe("eliminarUsuarioConProteccionConcurrente() -- funcion REAL, rol ADMIN real", () => {
  let fixtures: FixturesPruebaConcurrencia | undefined;
  let cruzada: FixturaCruzadaPruebaConcurrencia | undefined;

  beforeEach(async () => {
    fixtures = await crearFixturesPruebaConcurrencia(admin, PREFIJO, sufijoUnico(), "integracion:real:setup");
    cruzada = await crearFixturaCruzadaPruebaConcurrencia(
      admin,
      PREFIJO,
      sufijoUnico(),
      fixtures.definicionKpiId,
      "integracion:real:setup-cruzada",
    );
  }, 30000);

  afterEach(async () => {
    // Las DOS fixtures se intentan SIEMPRE, cada una con su propia
    // guarda -- un fallo en una nunca debe impedir el intento de borrar
    // la otra, y ningun fallo se descarta en silencio (se acumulan y se
    // relanzan al final, ver el comentario de cabecera, bloqueo 1).
    const errores: unknown[] = [];
    if (cruzada) {
      const cruzadaLocal = cruzada;
      cruzada = undefined;
      try {
        await borrarFixturaCruzadaPruebaConcurrencia(admin, cruzadaLocal, "integracion:real:teardown-cruzada");
      } catch (e) {
        errores.push(e);
      }
    }
    if (fixtures) {
      const fixturesLocal = fixtures;
      fixtures = undefined;
      try {
        await borrarFixturesPruebaConcurrencia(admin, fixturesLocal, "integracion:real:teardown");
      } catch (e) {
        errores.push(e);
      }
    }
    if (errores.length > 0) {
      throw new Error(
        `Fallo la limpieza de esta prueba (${errores.length} error(es) -- ver los logs de ` +
          "integracion:real:teardown*/ERROR_BORRADO_* de arriba). Revisar a mano antes de confiar en que " +
          "esta corrida no dejo basura.",
      );
    }
  }, 30000);

  it(
    "la referencia cruzada (otra empresa, ImportacionCsv.confirmadaPorId) YA existe ANTES de llamar -- " +
      "bloquea el borrado real (prueba el fix de rol/RLS: con el rol app anterior, esta referencia era invisible)",
    async () => {
      await admin.importacionCsv.update({
        where: { id: cruzada!.importacionCruzadaId },
        data: { confirmadaPorId: fixtures!.usuarioId },
      });

      await expect(
        eliminarUsuarioConProteccionConcurrente(admin, fixtures!.empresaId, fixtures!.usuarioId, "integracion:real:prueba1"),
      ).rejects.toThrow("ERROR_ELIMINACION_PROTEGIDA_ESCENARIO_C");

      const usuarioFinal = await admin.usuario.findUnique({ where: { id: fixtures!.usuarioId } });
      expect(usuarioFinal).not.toBeNull();
      const importacionFinal = await admin.importacionCsv.findUnique({ where: { id: cruzada!.importacionCruzadaId } });
      expect(importacionFinal?.confirmadaPorId).toBe(fixtures!.usuarioId);
    },
    30000,
  );

  it(
    "operacion concurrente REPRESENTATIVA (tenantTransaction() real, rol chainpulse_app, READ COMMITTED -- el " +
      "mismo mecanismo que confirmar/route.ts) corriendo A LA VEZ que eliminarUsuarioConProteccionConcurrente() " +
      "(rol admin, SERIALIZABLE) -- probabilistica a proposito, ver el comentario de abajo",
    async () => {
      // HONESTO sobre lo que esto puede y no puede garantizar (Alex,
      // revision de la version d: "No declares acreditada la proteccion
      // concurrente mediante esa prueba generica" + la afirmacion de SSI
      // "necesita justificacion y validacion especifica"):
      //
      // A diferencia de la demostracion EN AISLAMIENTO de mas arriba
      // (dos conexiones crudas, orden de awaits armado a mano -> 100%
      // determinista), aca las DOS operaciones son las funciones/rutas
      // REALES -- ninguna expone un punto para pausar su transaccion
      // desde afuera. No hay forma de garantizar en que momento EXACTO
      // cae la escritura de B relativo a los ~17 SELECT secuenciales del
      // chequeo de cascada de A (ver relacionesCascada.ts) antes de su
      // DELETE, sin instrumentar codigo de produccion solo para esta
      // prueba -- lo que evitamos a proposito (contaminaria produccion
      // con un concern de test). Lanzar ambas sin esperar una a la otra
      // (Promise.allSettled) es lo mas realista que se puede hacer.
      //
      // Por eso esta prueba NO afirma "A siempre gana" ni "B siempre
      // gana": verifica el INVARIANTE logico que SI se puede garantizar
      // sin importar como haya caido la carrera esta corrida en
      // particular --
      //
      //   Si el usuario SIGUE existiendo al final: eliminarUsuarioCon
      //   ProteccionConcurrente() tiene que haber rechazado (la unica
      //   forma de que resuelva con exito es habiendo borrado) -- caso
      //   SEGURO, sea que B haya ganado la carrera (A vio la referencia y
      //   aborto) o que algo mas haya fallado.
      //
      //   Si el usuario NO existe mas (A si borro) Y la escritura de B
      //   FALLO: seguro tambien -- B se entera por un error (viola la FK
      //   hacia un usuario que ya no existe), nunca en silencio.
      //
      //   Si el usuario NO existe mas Y la escritura de B TUVO EXITO:
      //   este es el CASO DE RIESGO REAL documentado en
      //   eliminarUsuarioProtegido.ts, PARTE 2 -- A leyo "0 referencias"
      //   (antes de que B escribiera), B commiteo DESPUES de esa lectura
      //   pero ANTES del borrado de A, y A borro igual: Postgres aplica
      //   el SET NULL del lado de B en silencio (confirmadaPorId queda en
      //   null), sin que NINGUNO de los dos lados reciba un error --
      //   porque B corre READ COMMITTED (tenantTransaction() real, igual
      //   que en produccion) y nunca deja el SIReadLock que SSI necesita
      //   para cerrar el ciclo. Esta prueba NO PUEDE FORZAR este caso de
      //   forma determinista (ver arriba) -- pero SI lo detecta y lo
      //   deja constancia explicita (console.warn + la aserciones de
      //   abajo) si ocurre esta corrida, en vez de fallar en silencio o
      //   de afirmar que "no paso nunca".
      //
      // Un resultado del primer o segundo tipo en ESTA corrida NO
      // significa que el riesgo del tercer tipo este cerrado -- solo que
      // esta corrida en particular no lo disparo. La prueba de MAS
      // ARRIBA (referencia YA existente antes de llamar) es la que
      // prueba, de forma determinista, que el fix de rol/RLS funciona;
      // esta prueba documenta el patron de riesgo restante CON las
      // funciones reales, sin fingir una garantia que Postgres no da.
      const promesaA = eliminarUsuarioConProteccionConcurrente(
        admin,
        fixtures!.empresaId,
        fixtures!.usuarioId,
        "integracion:real:prueba2:A",
      );
      const promesaB = tenantTransaction(cruzada!.otraEmpresaId, async (tx: ClientePrueba) => {
        await tx.importacionCsv.update({
          where: { id: cruzada!.importacionCruzadaId },
          data: { confirmadaPorId: fixtures!.usuarioId, estado: "CONFIRMADA", confirmadaEn: new Date() },
        });
      });

      const [resultadoA, resultadoB] = await Promise.allSettled([promesaA, promesaB]);

      const usuarioFinal = await admin.usuario.findUnique({ where: { id: fixtures!.usuarioId } });
      const importacionFinal = await admin.importacionCsv.findUnique({ where: { id: cruzada!.importacionCruzadaId } });

      if (usuarioFinal !== null) {
        // A no borro -- la unica forma de que eso pase es que su propia
        // promesa haya rechazado (ver el comentario de arriba).
        expect(resultadoA.status).toBe("rejected");
      } else if (resultadoB.status === "rejected") {
        // A borro, B fallo -- caso SEGURO: B nunca llego a confirmar.
        expect(importacionFinal?.confirmadaPorId).toBeNull();
      } else {
        // A borro, B tuvo exito -- CASO DE RIESGO (c), reproducido esta
        // corrida. Se documenta explicitamente en vez de fallar en
        // silencio: Postgres garantiza que confirmadaPorId termino en
        // null (SET NULL del lado del borrado), nunca un id huerfano --
        // pero NINGUN lado recibio un error avisando de la perdida.
        expect(importacionFinal?.confirmadaPorId).toBeNull();
        // eslint-disable-next-line no-console -- constancia deliberada, no un error de la prueba en si.
        console.warn(
          "[integracion:real:prueba2] CASO DE RIESGO reproducido esta corrida: la confirmacion (B, READ " +
            "COMMITTED) commiteo y el borrado (A, SERIALIZABLE) igual se aplico -- confirmadaPorId quedo en " +
            "null sin que ningun lado recibiera un error. Ver eliminarUsuarioProtegido.ts, PARTE 2.",
        );
      }
    },
    30000,
  );
});

// =====================================================================
// 3. orquestarLimpieza() -- LA FUNCION REAL, rol ADMIN. Nunca tuvo el
//    bug de rol de esta revision (siempre uso prismaAdmin -- confirmado
//    leyendo orquestarLimpieza.ts), pero nunca se habia ejercitado EN
//    ESTA PRUEBA con una referencia cruzada real -- "ni orquestarLimpieza()"
//    (Alex). Fixture propia (no reutiliza crearFixturesPruebaConcurrencia(),
//    que crea 1 solo usuario: orquestarLimpieza() exige el manifiesto
//    completo de 4 usuarios, ver manifiesto.ts/SUFIJOS_USUARIO) --
//    transaccional y con el mismo criterio de "nunca silenciar" que
//    fixturesPruebaConcurrencia.ts, pero deliberadamente inline (sin una
//    libreria/pruebas unitarias aparte): es un unico uso en todo este
//    archivo, y ya reutiliza crearFixturaCruzadaPruebaConcurrencia()/
//    borrarFixturaCruzadaPruebaConcurrencia() (esas SI probadas por
//    separado) para la mitad cruzada.
// =====================================================================
describe("orquestarLimpieza() -- funcion REAL, rol ADMIN", () => {
  let manifiesto: ManifiestoPrueba | undefined;
  let definicionKpiId: string | undefined;
  let cruzada: FixturaCruzadaPruebaConcurrencia | undefined;

  beforeEach(async () => {
    const runId = nuevoRunId();
    const sufijoDefinicion = sufijoUnico();

    const creado = await admin.$transaction(async (tx: ClientePrueba) => {
      const empresa = await tx.empresa.create({ data: { nombre: nombreEmpresa(runId) } });
      const definicion = await tx.definicionKpi.create({
        data: {
          codigo: `${PREFIJO}_LIMPIEZA_${sufijoDefinicion}`,
          numero: Number(sufijoDefinicion.replace(/[^0-9]/g, "").slice(0, 6) || "888888"),
          nombre: `${PREFIJO}_LIMPIEZA_KPI`,
          descripcion: "prueba de integracion -- orquestarLimpieza con referencia cruzada",
          formula: "n/a",
          unidad: "n/a",
          periodoDefecto: "mensual",
        },
      });
      const usuarios = {} as ManifiestoPrueba["usuarios"];
      for (const sufijo of SUFIJOS_USUARIO) {
        const usuario = await tx.usuario.create({
          data: {
            empresaId: empresa.id,
            email: emailUsuario(runId, sufijo),
            nombre: `${PREFIJO}_${sufijo}`,
            rol: "RESPONSABLE",
            // Placeholder -- esta prueba nunca autentica a estos
            // usuarios, solo los lee/borra por id. Nunca un hash real.
            passwordHash: "NO_SE_USA_EN_ESTA_PRUEBA",
          },
        });
        usuarios[sufijo] = { id: usuario.id, email: usuario.email, uso: USO_POR_SUFIJO[sufijo] };
      }
      return { empresaId: empresa.id, definicionKpiId: definicion.id, usuarios };
    });

    definicionKpiId = creado.definicionKpiId;
    manifiesto = {
      version: 1,
      runId,
      creadoEn: new Date().toISOString(),
      destino: {
        host: new URL(process.env.SEED_DATABASE_URL as string).hostname,
        base: new URL(process.env.SEED_DATABASE_URL as string).pathname.slice(1),
      },
      empresaId: creado.empresaId,
      usuarios: creado.usuarios,
    };

    cruzada = await crearFixturaCruzadaPruebaConcurrencia(
      admin,
      PREFIJO,
      sufijoUnico(),
      creado.definicionKpiId,
      "integracion:limpieza:setup-cruzada",
    );
  }, 30000);

  afterEach(async () => {
    const errores: unknown[] = [];
    if (cruzada) {
      const cruzadaLocal = cruzada;
      cruzada = undefined;
      try {
        await borrarFixturaCruzadaPruebaConcurrencia(admin, cruzadaLocal, "integracion:limpieza:teardown-cruzada");
      } catch (e) {
        errores.push(e);
      }
    }
    // orquestarLimpieza(), en la prueba de abajo, SIEMPRE aborta (la
    // referencia cruzada bloquea su transaccion) -- la empresa/usuarios/
    // definicion de este manifiesto quedan intactos y hay que borrarlos
    // aca, por ID EXACTO (nunca por nombre o por un empresaId ancho).
    if (manifiesto) {
      const manifiestoLocal = manifiesto;
      const definicionLocal = definicionKpiId;
      manifiesto = undefined;
      definicionKpiId = undefined;
      try {
        await admin.$transaction(async (tx: ClientePrueba) => {
          for (const sufijo of SUFIJOS_USUARIO) {
            await tx.usuario.deleteMany({ where: { id: manifiestoLocal.usuarios[sufijo].id } });
          }
          if (definicionLocal) {
            await tx.definicionKpi.deleteMany({ where: { id: definicionLocal } });
          }
          await tx.empresa.deleteMany({ where: { id: manifiestoLocal.empresaId } });
        });
      } catch (e) {
        errores.push(e);
      }
    }
    if (errores.length > 0) {
      throw new Error(
        `Fallo la limpieza de esta prueba (${errores.length} error(es) -- ver los logs de ` +
          "integracion:limpieza:teardown*/ERROR_BORRADO_* de arriba). Revisar a mano antes de confiar en que " +
          "esta corrida no dejo basura.",
      );
    }
  }, 30000);

  it(
    "referencia cruzada (otra empresa) hacia A3 -- orquestarLimpieza() real aborta, nunca borra nada (mismo " +
      "chequeo de relacionesCascada.ts que eliminarUsuarioConProteccionConcurrente, ya con el rol admin que " +
      "orquestarLimpieza() siempre uso)",
    async () => {
      await admin.importacionCsv.update({
        where: { id: cruzada!.importacionCruzadaId },
        data: { confirmadaPorId: manifiesto!.usuarios.a3.id },
      });

      // rutaManifiesto/desconectar nunca se usan de verdad -- leerManifiesto
      // y construirAdmin estan inyectados; el `admin` de este archivo se
      // desconecta en su propio afterAll de archivo, nunca aca.
      const resultado = await orquestarLimpieza("/integracion/no-se-lee-del-disco", {
        seedDatabaseUrl: process.env.SEED_DATABASE_URL,
        construirAdmin: () => admin,
        desconectar: async () => undefined,
        leerManifiesto: () => manifiesto!,
        borrarManifiesto: () => true,
      });

      expect(resultado).toEqual({ ok: false, motivo: "ERROR_TRANSACCION_LIMPIEZA" });

      const usuarioA3Final = await admin.usuario.findUnique({ where: { id: manifiesto!.usuarios.a3.id } });
      expect(usuarioA3Final).not.toBeNull();
      const importacionFinal = await admin.importacionCsv.findUnique({ where: { id: cruzada!.importacionCruzadaId } });
      expect(importacionFinal?.confirmadaPorId).toBe(manifiesto!.usuarios.a3.id);
    },
    30000,
  );
});
