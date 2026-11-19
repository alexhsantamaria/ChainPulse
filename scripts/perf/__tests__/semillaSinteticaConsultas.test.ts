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
import {
  crearUsuariosSinteticosParaCarga,
  revocarUsuariosSinteticosDeCarga,
  type ClienteUsuariosSinteticos,
} from "../semillaSinteticaConsultas";
import {
  emailUsuarioSinteticoCarga,
  sufijoEmailUsuariosSinteticosCarga,
  type FilaUsuarioSinteticoCarga,
} from "../../../src/infra/queries/rendimiento/sesionSinteticaHelpers";

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
