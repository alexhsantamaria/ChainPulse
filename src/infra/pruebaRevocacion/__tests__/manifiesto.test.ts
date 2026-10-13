// Pruebas — manifiesto de una corrida de prueba de revocacion y su
// validacion ESTRUCTURAL (Alex, 2026-10-04, punto 4). Sin mocks -- las
// funciones de este archivo no tocan la base ni el filesystem real
// (carpetaManifiestos()/rutaManifiesto() solo construyen rutas, no
// crean nada).
import { describe, expect, it } from "vitest";
import { sep } from "node:path";
import {
  SUFIJOS_USUARIO,
  carpetaManifiestos,
  emailUsuario,
  nombreEmpresa,
  nuevoRunId,
  rutaManifiesto,
  validarEstructuraManifiesto,
  type ManifiestoPrueba,
} from "../manifiesto";

function manifiestoValido(runId: string): ManifiestoPrueba {
  return {
    version: 1,
    runId,
    creadoEn: new Date().toISOString(),
    destino: { host: "host-de-prueba.neon.tech", base: "chainpulse_prueba" },
    empresaId: "empresa-1",
    usuarios: {
      a1: { id: "usuario-a1", email: emailUsuario(runId, "a1"), uso: "x" },
      a2: { id: "usuario-a2", email: emailUsuario(runId, "a2"), uso: "x" },
      a3: { id: "usuario-a3", email: emailUsuario(runId, "a3"), uso: "x" },
      a4: { id: "usuario-a4", email: emailUsuario(runId, "a4"), uso: "x" },
    },
  };
}

describe("nuevoRunId / rutaManifiesto / carpetaManifiestos", () => {
  it("cada llamada a nuevoRunId() devuelve un id distinto", () => {
    expect(nuevoRunId()).not.toBe(nuevoRunId());
  });

  it("carpetaManifiestos() queda FUERA del repositorio (directorio temporal del sistema, no scripts/)", () => {
    const carpeta = carpetaManifiestos();
    expect(carpeta).not.toContain("BigDevelopment");
    expect(carpeta).not.toContain("ChainPulse");
    expect(carpeta.toLowerCase()).not.toContain(`${sep}scripts${sep}`);
  });

  it("rutaManifiesto() incluye el runId -- dos corridas nunca comparten archivo", () => {
    const id1 = nuevoRunId();
    const id2 = nuevoRunId();
    expect(rutaManifiesto(id1)).not.toBe(rutaManifiesto(id2));
    expect(rutaManifiesto(id1)).toContain(id1);
  });
});

describe("validarEstructuraManifiesto", () => {
  it("manifiesto bien formado -- pasa y devuelve el mismo objeto", () => {
    const m = manifiestoValido("run-1");
    expect(validarEstructuraManifiesto(m)).toEqual(m);
  });

  it.each([
    ["no es un objeto", "esto-no-es-un-objeto"],
    ["null", null],
    ["version distinta de 1", { ...manifiestoValido("run-1"), version: 2 }],
    ["sin runId", { ...manifiestoValido("run-1"), runId: "" }],
    ["sin empresaId", { ...manifiestoValido("run-1"), empresaId: "" }],
    ["sin destino", { ...manifiestoValido("run-1"), destino: undefined }],
    ["destino sin host", { ...manifiestoValido("run-1"), destino: { base: "x" } }],
    ["sin usuarios", { ...manifiestoValido("run-1"), usuarios: undefined }],
    [
      "falta un usuario (a4)",
      (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture deliberadamente invalido (bypassa el tipo de ManifiestoPrueba a proposito, solo para alimentar validarEstructuraManifiesto() con una forma corrupta)
        const m = manifiestoValido("run-1") as any;
        delete m.usuarios.a4;
        return m;
      })(),
    ],
    [
      "un usuario sin id",
      (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture deliberadamente invalido (bypassa el tipo de ManifiestoPrueba a proposito, solo para alimentar validarEstructuraManifiesto() con una forma corrupta)
        const m = manifiestoValido("run-1") as any;
        m.usuarios.a1.id = "";
        return m;
      })(),
    ],
  ])("rechaza: %s", (_nombre, valor) => {
    expect(() => validarEstructuraManifiesto(valor)).toThrow();
  });

  it("email que no corresponde al runId declarado -- MANIFIESTO_INCONSISTENTE (editado a mano o mezclado entre corridas)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture deliberadamente invalido (bypassa el tipo de ManifiestoPrueba a proposito, solo para alimentar validarEstructuraManifiesto() con una forma corrupta)
    const m = manifiestoValido("run-1") as any;
    m.usuarios.a1.email = emailUsuario("run-DISTINTO", "a1");
    expect(() => validarEstructuraManifiesto(m)).toThrow("MANIFIESTO_INCONSISTENTE");
  });

  it("dos usuarios con el mismo id -- MANIFIESTO_INCONSISTENTE", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture deliberadamente invalido (bypassa el tipo de ManifiestoPrueba a proposito, solo para alimentar validarEstructuraManifiesto() con una forma corrupta)
    const m = manifiestoValido("run-1") as any;
    m.usuarios.a2.id = m.usuarios.a1.id;
    expect(() => validarEstructuraManifiesto(m)).toThrow("MANIFIESTO_INCONSISTENTE");
  });

  it("un usuario con el mismo id que la empresa -- MANIFIESTO_INCONSISTENTE", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture deliberadamente invalido (bypassa el tipo de ManifiestoPrueba a proposito, solo para alimentar validarEstructuraManifiesto() con una forma corrupta)
    const m = manifiestoValido("run-1") as any;
    m.usuarios.a1.id = m.empresaId;
    expect(() => validarEstructuraManifiesto(m)).toThrow("MANIFIESTO_INCONSISTENTE");
  });
});

describe("nombreEmpresa / emailUsuario -- deterministas por runId", () => {
  it("mismo runId -- mismo nombre/email siempre", () => {
    expect(nombreEmpresa("run-1")).toBe(nombreEmpresa("run-1"));
    expect(emailUsuario("run-1", "a1")).toBe(emailUsuario("run-1", "a1"));
  });

  it("runId distinto -- nombre/email distintos (nunca colisionan entre corridas)", () => {
    expect(nombreEmpresa("run-1")).not.toBe(nombreEmpresa("run-2"));
    for (const s of SUFIJOS_USUARIO) {
      expect(emailUsuario("run-1", s)).not.toBe(emailUsuario("run-2", s));
    }
  });
});
