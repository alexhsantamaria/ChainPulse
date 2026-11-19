// Pruebas focalizadas (Incremento 5 PR4, ronda de revision 2 de Alex,
// 2026-11-19, punto 1: "crear usuarios sinteticos... eliminar usuarios,
// sesiones y demas fixtures durante la limpieza; documentar y probar el
// ciclo completo de preparacion y revocacion").
//
// Solo prueban crearUsuariosSinteticosParaCarga()/
// revocarUsuariosSinteticosDeCarga() -- las 2 funciones PURAS respecto
// a la conexion, con un cliente FALSO en memoria (mismo patron ya
// establecido en scripts/rf20/__tests__ y
// scripts/perf/__tests__/explicarConsultas.test.ts: cliente inyectado,
// nunca pg/Prisma mockeado globalmente). Nunca ejecuta main(),
// sembrar() ni limpiar() completos, que exigen variables de entorno
// reales, confirmacion de destino y una conexion Postgres real -- fuera
// de alcance de una prueba unitaria, y expresamente prohibido en esta
// ronda ("Sigue detenido antes de... Neon").
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  crearUsuariosSinteticosParaCarga,
  revocarUsuariosSinteticosDeCarga,
  construirFilasHallazgoCadenaSintetico,
  DIMENSIONES_HALLAZGO_CADENA,
  MAX_HALLAZGOS_POR_ALCANCE,
  type ClienteUsuariosSinteticos,
  type FilaHallazgoCadenaSintetico,
} from "../semillaSinteticaConsultas";
import {
  emailUsuarioSinteticoCarga,
  sufijoEmailUsuariosSinteticosCarga,
  type FilaUsuarioSinteticoCarga,
} from "../../../src/infra/queries/rendimiento/sesionSinteticaHelpers";

const RUTA_MIGRACION_HALLAZGOS_UNICOS = join(
  __dirname,
  "../../../prisma/migrations/20260924010000_hallazgos_cadena_unique/migration.sql",
);
const RUTA_SCHEMA = join(__dirname, "../../../prisma/schema.prisma");

/**
 * Cliente falso: una tabla `usuario` en memoria (array), con
 * createMany/deleteMany que imitan la semantica real de Prisma lo
 * suficiente para estas pruebas (createMany agrega filas y devuelve
 * {count}; deleteMany({where:{email:{endsWith}}}) borra por sufijo y
 * devuelve {count}).
 */
function clienteFalsoUsuarios(): { cliente: ClienteUsuariosSinteticos; filas: FilaUsuarioSinteticoCarga[] } {
  const filas: FilaUsuarioSinteticoCarga[] = [];
  const cliente: ClienteUsuariosSinteticos = {
    usuario: {
      async createMany(args) {
        filas.push(...args.data);
        return { count: args.data.length };
      },
      async deleteMany(args) {
        const sufijo = args.where.email.endsWith;
        const antes = filas.length;
        for (let i = filas.length - 1; i >= 0; i -= 1) {
          if (filas[i]!.email.endsWith(sufijo)) filas.splice(i, 1);
        }
        return { count: antes - filas.length };
      },
    },
  };
  return { cliente, filas };
}

describe("crearUsuariosSinteticosParaCarga", () => {
  it("crea exactamente `cantidad` filas, con los emails reproducibles de esa escala, bajo el empresaId dado", async () => {
    const { cliente, filas } = clienteFalsoUsuarios();

    const resultado = await crearUsuariosSinteticosParaCarga(cliente, "empresa-rendimiento-1", 1_000, 26);

    expect(resultado.cantidadCreada).toBe(26);
    expect(filas).toHaveLength(26);
    filas.forEach((fila, indice) => {
      expect(fila.email).toBe(emailUsuarioSinteticoCarga(1_000, indice));
      expect(fila.empresaId).toBe("empresa-rendimiento-1");
      expect(fila.rol).toBe("ADMINISTRADOR");
      expect(fila.mfaHabilitado).toBe(false);
      expect(fila.sessionVersion).toBe(1);
    });
  });

  it("cada usuario recibe un passwordHash DISTINTO (nunca la misma contraseña/hash reutilizado entre usuarios)", async () => {
    const { cliente, filas } = clienteFalsoUsuarios();
    await crearUsuariosSinteticosParaCarga(cliente, "empresa-rendimiento-1", 100, 5);
    const hashes = filas.map((f) => f.passwordHash);
    expect(new Set(hashes).size).toBe(5);
  });

  it("nunca incluye ninguna cookie ni token en las filas creadas -- solo datos de Usuario", async () => {
    const { cliente, filas } = clienteFalsoUsuarios();
    await crearUsuariosSinteticosParaCarga(cliente, "empresa-rendimiento-1", 100, 2);
    for (const fila of filas) {
      expect(Object.keys(fila).sort()).toEqual(
        ["email", "empresaId", "mfaHabilitado", "nombre", "passwordHash", "rol", "sessionVersion"].sort(),
      );
    }
  });

  it("--usuarios=0 (cantidad=0) no crea ninguna fila ni llama a createMany", async () => {
    const { cliente, filas } = clienteFalsoUsuarios();
    let seLlamoCreateMany = false;
    const clienteVigilado: ClienteUsuariosSinteticos = {
      usuario: {
        createMany: async (args) => {
          seLlamoCreateMany = true;
          return cliente.usuario.createMany(args);
        },
        deleteMany: cliente.usuario.deleteMany,
      },
    };

    const resultado = await crearUsuariosSinteticosParaCarga(clienteVigilado, "empresa-rendimiento-1", 100, 0);

    expect(resultado.cantidadCreada).toBe(0);
    expect(filas).toHaveLength(0);
    expect(seLlamoCreateMany).toBe(false);
  });
});

describe("revocarUsuariosSinteticosDeCarga", () => {
  it("borra EXCLUSIVAMENTE los usuarios de la escala pedida -- nunca los de otra escala", async () => {
    const { cliente, filas } = clienteFalsoUsuarios();
    await crearUsuariosSinteticosParaCarga(cliente, "empresa-escala-100", 100, 3);
    await crearUsuariosSinteticosParaCarga(cliente, "empresa-escala-1000", 1_000, 3);
    expect(filas).toHaveLength(6);

    const resultado = await revocarUsuariosSinteticosDeCarga(cliente, 100);

    expect(resultado.cantidadRevocada).toBe(3);
    expect(filas).toHaveLength(3);
    for (const fila of filas) {
      expect(fila.email.endsWith(sufijoEmailUsuariosSinteticosCarga(1_000))).toBe(true);
    }
  });

  it("el ciclo completo preparacion -> revocacion deja la tabla exactamente como estaba antes (cero filas sinteticas de esa escala)", async () => {
    const { cliente, filas } = clienteFalsoUsuarios();
    await crearUsuariosSinteticosParaCarga(cliente, "empresa-rendimiento-1", 10_000, 26);
    expect(filas).toHaveLength(26);

    const resultado = await revocarUsuariosSinteticosDeCarga(cliente, 10_000);

    expect(resultado.cantidadRevocada).toBe(26);
    expect(filas).toHaveLength(0);
  });

  it("revocar una escala sin usuarios creados es un no-op seguro (cantidadRevocada=0, nunca lanza)", async () => {
    const { cliente, filas } = clienteFalsoUsuarios();
    const resultado = await revocarUsuariosSinteticosDeCarga(cliente, 50_000);
    expect(resultado.cantidadRevocada).toBe(0);
    expect(filas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// construirFilasHallazgoCadenaSintetico() -- BLOQUEO CORREGIDO (Alex,
// 2026-11-19): la version anterior ponia TODAS las filas en el alcance
// "cadena completa" (conexionCadenaId=null) ciclando las 6 dimensiones,
// lo que colisionaba con el indice unico parcial
// hallazgos_cadena_cadena_dimension_key desde la septima fila en
// adelante, en CUALQUIER escala >6 (1.000/10.000/50.000 incluidas) --
// `createMany` hubiera lanzado un error de restriccion unica de
// Postgres. Las pruebas de abajo demuestran, SIN tocar Neon, que la
// correccion: siembra validamente en las 3 escalas pedidas; nunca
// colisiona con ninguno de los 2 indices unicos parciales reales; y
// sigue produciendo datos utiles (mismo cadenaId, createdAt disperso)
// para la consulta que la motiva (CAMBIOS_ULTIMO_PULSO, I5-06).
// ---------------------------------------------------------------------
function agruparPorConexion(filas: readonly FilaHallazgoCadenaSintetico[]): Map<string, FilaHallazgoCadenaSintetico[]> {
  const grupos = new Map<string, FilaHallazgoCadenaSintetico[]>();
  for (const fila of filas) {
    if (fila.conexionCadenaId === null) continue;
    const grupo = grupos.get(fila.conexionCadenaId) ?? [];
    grupo.push(fila);
    grupos.set(fila.conexionCadenaId, grupo);
  }
  return grupos;
}

describe("construirFilasHallazgoCadenaSintetico()", () => {
  it("MAX_HALLAZGOS_POR_ALCANCE es exactamente 6 -- una por cada dimension real (nunca un numero elegido a mano)", () => {
    expect(MAX_HALLAZGOS_POR_ALCANCE).toBe(6);
    expect(DIMENSIONES_HALLAZGO_CADENA).toHaveLength(6);
  });

  it.each([1_000, 10_000, 50_000] as const)(
    "siembra validamente la escala=%i pedida -- exactamente `cantidad` filas, sin lanzar, con tantas conexiones disponibles como la propia escala (plan.conexionCadena de configuracionRendimiento.ts)",
    (escala) => {
      const idsConexionesDisponibles = Array.from({ length: escala }, (_, i) => `conexion-${i}`);
      const filas = construirFilasHallazgoCadenaSintetico({
        empresaId: "empresa-rendimiento-1",
        cadenaId: "cadena-rendimiento-1",
        idsConexionesDisponibles,
        cantidad: escala,
        ahoraMs: Date.UTC(2026, 10, 19),
      });
      expect(filas).toHaveLength(escala);
    },
  );

  it.each([1_000, 10_000, 50_000] as const)(
    "escala=%i: AUSENCIA de colision con hallazgos_cadena_conexion_dimension_key -- dentro de cada conexion, la dimension nunca se repite, y nunca excede MAX_HALLAZGOS_POR_ALCANCE",
    (escala) => {
      const idsConexionesDisponibles = Array.from({ length: escala }, (_, i) => `conexion-${i}`);
      const filas = construirFilasHallazgoCadenaSintetico({
        empresaId: "empresa-rendimiento-1",
        cadenaId: "cadena-rendimiento-1",
        idsConexionesDisponibles,
        cantidad: escala,
        ahoraMs: Date.UTC(2026, 10, 19),
      });
      const grupos = agruparPorConexion(filas);
      for (const [, filasDeEstaConexion] of grupos) {
        expect(filasDeEstaConexion.length).toBeLessThanOrEqual(MAX_HALLAZGOS_POR_ALCANCE);
        const dimensionesDeEstaConexion = filasDeEstaConexion.map((f) => f.dimension);
        expect(new Set(dimensionesDeEstaConexion).size).toBe(dimensionesDeEstaConexion.length);
      }
    },
  );

  it.each([1_000, 10_000, 50_000] as const)(
    "escala=%i: AUSENCIA de colision con hallazgos_cadena_cadena_dimension_key -- las filas del alcance 'cadena completa' (conexionCadenaId=null) nunca repiten dimension y nunca exceden MAX_HALLAZGOS_POR_ALCANCE",
    (escala) => {
      const idsConexionesDisponibles = Array.from({ length: escala }, (_, i) => `conexion-${i}`);
      const filas = construirFilasHallazgoCadenaSintetico({
        empresaId: "empresa-rendimiento-1",
        cadenaId: "cadena-rendimiento-1",
        idsConexionesDisponibles,
        cantidad: escala,
        ahoraMs: Date.UTC(2026, 10, 19),
      });
      const filasCadenaCompleta = filas.filter((f) => f.conexionCadenaId === null);
      expect(filasCadenaCompleta.length).toBeLessThanOrEqual(MAX_HALLAZGOS_POR_ALCANCE);
      const dimensiones = filasCadenaCompleta.map((f) => f.dimension);
      expect(new Set(dimensiones).size).toBe(dimensiones.length);
    },
  );

  it.each([1_000, 10_000, 50_000] as const)(
    "escala=%i: ninguna fila repite la combinacion (alcance, dimension) de NINGUNA otra -- la union de todas las claves (conexionCadenaId ?? 'CADENA_COMPLETA')+dimension es unica",
    (escala) => {
      const idsConexionesDisponibles = Array.from({ length: escala }, (_, i) => `conexion-${i}`);
      const filas = construirFilasHallazgoCadenaSintetico({
        empresaId: "empresa-rendimiento-1",
        cadenaId: "cadena-rendimiento-1",
        idsConexionesDisponibles,
        cantidad: escala,
        ahoraMs: Date.UTC(2026, 10, 19),
      });
      const claves = filas.map((f) => `${f.conexionCadenaId ?? "CADENA_COMPLETA"}::${f.dimension}`);
      expect(new Set(claves).size).toBe(claves.length);
    },
  );

  it.each([1_000, 10_000, 50_000] as const)(
    "escala=%i: datos utiles para CAMBIOS_ULTIMO_PULSO (I5-06) -- mismo cadenaId/empresaId en TODA fila, y createdAt disperso de forma que exista al menos una fila antes y otra despues de un corte intermedio",
    (escala) => {
      const idsConexionesDisponibles = Array.from({ length: escala }, (_, i) => `conexion-${i}`);
      const ahoraMs = Date.UTC(2026, 10, 19);
      const filas = construirFilasHallazgoCadenaSintetico({
        empresaId: "empresa-rendimiento-1",
        cadenaId: "cadena-rendimiento-1",
        idsConexionesDisponibles,
        cantidad: escala,
        ahoraMs,
      });

      // El ejecutor real (cargarYEjecutarCambiosUltimoPulso, src/infra/
      // queries/ejecutores/cambiosUltimoPulso.ts) filtra EXCLUSIVAMENTE
      // por cadenaId -- nunca le importa el alcance (conexionCadenaId).
      for (const fila of filas) {
        expect(fila.empresaId).toBe("empresa-rendimiento-1");
        expect(fila.cadenaId).toBe("cadena-rendimiento-1");
        expect(fila.resultado).toBe("DIFERENCIA");
      }

      const tiempos = filas.map((f) => f.createdAt.getTime());
      const minimo = Math.min(...tiempos);
      const maximo = Math.max(...tiempos);
      expect(maximo).toBeGreaterThan(minimo); // dispersion real, nunca todas con el mismo createdAt
      expect(maximo).toBeLessThanOrEqual(ahoraMs); // nunca en el futuro respecto a ahoraMs

      const corte = new Date((minimo + maximo) / 2);
      const antesDelCorte = filas.filter((f) => f.createdAt.getTime() < corte.getTime());
      const desdeElCorte = filas.filter((f) => f.createdAt.getTime() >= corte.getTime());
      expect(antesDelCorte.length).toBeGreaterThan(0);
      expect(desdeElCorte.length).toBeGreaterThan(0);
    },
  );

  it("lanza HALLAZGOS_SINTETICOS_EXCEDEN_CAPACIDAD_SIN_COLISION -- NUNCA trunca en silencio -- cuando no hay suficientes conexiones disponibles para la cantidad pedida sin colisionar", () => {
    expect(() =>
      construirFilasHallazgoCadenaSintetico({
        empresaId: "empresa-rendimiento-1",
        cadenaId: "cadena-rendimiento-1",
        idsConexionesDisponibles: [], // 0 conexiones -- capacidad de alcance-conexion = 0
        cantidad: 20, // 6 van a cadena completa, los 14 restantes no tienen donde ir sin colisionar
        ahoraMs: Date.UTC(2026, 10, 19),
      }),
    ).toThrow("HALLAZGOS_SINTETICOS_EXCEDEN_CAPACIDAD_SIN_COLISION");
  });

  it("cantidad=0 devuelve un arreglo vacio, sin lanzar", () => {
    const filas = construirFilasHallazgoCadenaSintetico({
      empresaId: "empresa-rendimiento-1",
      cadenaId: "cadena-rendimiento-1",
      idsConexionesDisponibles: [],
      cantidad: 0,
      ahoraMs: Date.UTC(2026, 10, 19),
    });
    expect(filas).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN])("cantidad=%p (invalida: negativa o no entera) lanza CANTIDAD_HALLAZGOS_INVALIDA, nunca silenciosamente", (cantidadInvalida) => {
    expect(() =>
      construirFilasHallazgoCadenaSintetico({
        empresaId: "empresa-rendimiento-1",
        cadenaId: "cadena-rendimiento-1",
        idsConexionesDisponibles: ["conexion-0"],
        cantidad: cantidadInvalida,
        ahoraMs: Date.UTC(2026, 10, 19),
      }),
    ).toThrow("CANTIDAD_HALLAZGOS_INVALIDA");
  });

  it("caso pequeno exacto -- verifica la asignacion determinista byte a byte (6 filas al alcance cadena completa, una por dimension en orden; el resto a la unica conexion disponible, siguiendo dimension)", () => {
    const filas = construirFilasHallazgoCadenaSintetico({
      empresaId: "empresa-X",
      cadenaId: "cadena-Y",
      idsConexionesDisponibles: ["conexion-A"],
      cantidad: 8,
      ahoraMs: Date.UTC(2026, 10, 19),
    });

    expect(filas).toHaveLength(8);
    for (let i = 0; i < 6; i += 1) {
      expect(filas[i]!.conexionCadenaId).toBeNull();
      expect(filas[i]!.dimension).toBe(DIMENSIONES_HALLAZGO_CADENA[i]);
    }
    expect(filas[6]!.conexionCadenaId).toBe("conexion-A");
    expect(filas[6]!.dimension).toBe(DIMENSIONES_HALLAZGO_CADENA[0]);
    expect(filas[7]!.conexionCadenaId).toBe("conexion-A");
    expect(filas[7]!.dimension).toBe(DIMENSIONES_HALLAZGO_CADENA[1]);
  });
});

// ---------------------------------------------------------------------
// Verificacion ESTATICA (sin base, sin red, sin conexion -- mismo patron
// que src/infra/rateLimit/__tests__/migracionBucketConsultaEjecutar.test.ts)
// de que los supuestos sobre los que se basa la correccion de arriba
// siguen siendo ciertos en el schema/migracion REALES -- evita el drift
// silencioso mas peligroso: que alguien cambie la migracion o el schema
// y esta correccion quede validando una restriccion que ya no existe.
// ---------------------------------------------------------------------
describe("contrato real de HallazgoCadena (verificacion estatica de schema.prisma + la migracion, sin Postgres)", () => {
  it("la migracion 20260924010000_hallazgos_cadena_unique sigue declarando EXACTAMENTE los 2 indices unicos parciales en los que se basa construirFilasHallazgoCadenaSintetico()", () => {
    const sql = readFileSync(RUTA_MIGRACION_HALLAZGOS_UNICOS, "utf8");
    expect(sql).toContain('CREATE UNIQUE INDEX "hallazgos_cadena_cadena_dimension_key"');
    expect(sql).toContain('ON "hallazgos_cadena" ("cadenaId", "dimension")');
    expect(sql).toContain('WHERE "conexionCadenaId" IS NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX "hallazgos_cadena_conexion_dimension_key"');
    expect(sql).toContain('ON "hallazgos_cadena" ("conexionCadenaId", "dimension")');
    expect(sql).toContain('WHERE "conexionCadenaId" IS NOT NULL');
  });

  it("DIMENSIONES_HALLAZGO_CADENA (este script) coincide EXACTAMENTE, en contenido, con el enum real DimensionComparacionCadena de schema.prisma -- nunca una copia que pueda desincronizarse en silencio", () => {
    const schema = readFileSync(RUTA_SCHEMA, "utf8");
    const bloqueEnum = schema.match(/enum DimensionComparacionCadena \{([^}]*)\}/);
    expect(bloqueEnum).not.toBeNull();
    const valoresReales = bloqueEnum![1]!
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(new Set(valoresReales)).toEqual(new Set(DIMENSIONES_HALLAZGO_CADENA));
    expect(valoresReales).toHaveLength(6);
  });

  it("HallazgoCadena.empresa sigue siendo onDelete:Cascade -- la limpieza selectiva de limpiar() (deleteMany por Empresa.nombre exacto) sigue arrastrando TODAS las filas de HallazgoCadena, incluidas las nuevas filas con alcance de conexion (conexionCadenaId no-null), sin importar que su FK a ConexionCadena sea SetNull", () => {
    const schema = readFileSync(RUTA_SCHEMA, "utf8");
    const bloqueModelo = schema.match(/model HallazgoCadena \{([\s\S]*?)\n\}/);
    expect(bloqueModelo).not.toBeNull();
    expect(bloqueModelo![1]).toMatch(/empresa\s+Empresa\s+@relation\([^)]*onDelete:\s*Cascade\)/);
  });
});
