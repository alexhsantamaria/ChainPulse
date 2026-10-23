// Pruebas -- decidirModoMigracionesRf24() (flujo resumible RF24, punto 2 de
// la tercera correccion de Alex: "Modo A -- aplicar" / "Modo B -- continuar"
// con exactamente esos dos estados permitidos y bloqueo de cualquier mezcla
// -- generalizado en la Ronda 8 para reconocer, ADEMAS, un PREFIJO continuo
// aplicado/resuelto seguido de un SUFIJO continuo pendiente dentro del
// propio conjunto RF24: escenario real una vez que existe una 4a migracion,
// correctiva de privilegios, mientras las primeras 3 ya estan aplicadas).
// Funcion 100% pura (no toca Prisma, Postgres ni el disco): estas pruebas
// construyen el EstadoMigraciones a mano, nunca via evaluarEstadoMigraciones
// (eso ya esta cubierto en destinoPrueba.test.ts), para aislar unicamente la
// logica de decision.
import { describe, expect, it } from "vitest";
import { decidirModoMigracionesRf24, evaluarDefinicionesMigracion5 } from "../orquestarValidacionRamaTemporal";
import type { EstadoMigraciones } from "../../pruebaRevocacion/destinoPrueba";
import type { FilaDefinicionFuncionMigracion5 } from "../orquestarValidacionRamaTemporal";

const RF24 = ["rf24_a", "rf24_b", "rf24_c"];
// Ronda 8: mismo conjunto pero con una 4a migracion -- espejo exacto del
// caso real de produccion (3 migraciones originales ya aplicadas + 1
// correctiva de privilegios pendiente).
const RF24_4 = [...RF24, "rf24_d"];

function estado(parcial: Partial<EstadoMigraciones>): EstadoMigraciones {
  return {
    aplicadas: [],
    reversionesResueltas: [],
    anomaliasActivas: [],
    reversionesSinResolucion: [],
    pendientes: [],
    fallidasOInconclusas: [],
    ...parcial,
  };
}

describe("decidirModoMigracionesRf24", () => {
  it("Modo A -- las 3 de RF24 son EXACTAMENTE las unicas pendientes, en orden", () => {
    const resultado = decidirModoMigracionesRf24(estado({ pendientes: [...RF24] }), RF24);
    expect(resultado).toEqual({ modo: "aplicar" });
  });

  it("Modo B -- las 3 de RF24 estan en aplicadas, cero pendientes en total", () => {
    const resultado = decidirModoMigracionesRf24(estado({ aplicadas: [...RF24] }), RF24);
    expect(resultado).toEqual({ modo: "continuar" });
  });

  it("Modo B -- las 3 de RF24 estan en reversionesResueltas, cero pendientes en total", () => {
    const resultado = decidirModoMigracionesRf24(estado({ reversionesResueltas: [...RF24] }), RF24);
    expect(resultado).toEqual({ modo: "continuar" });
  });

  it("Modo B -- mezcla permitida entre aplicada y reversion resuelta dentro de las 3 de RF24", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a", "rf24_c"], reversionesResueltas: ["rf24_b"] }),
      RF24,
    );
    expect(resultado).toEqual({ modo: "continuar" });
  });

  // Ronda 8: estos 2 casos ANTES bloqueaban (eran el catch-all "estado
  // mixto") -- ahora son EXACTAMENTE el patron que la generalizacion
  // reconoce como "aplicar": un prefijo continuo aplicado seguido de un
  // sufijo continuo pendiente, sin huecos ni migraciones ajenas a RF24.
  it("Modo A (Ronda 8, generalizacion) -- prefijo aplicado + sufijo pendiente: dos aplicadas, una todavia pendiente al final", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a", "rf24_b"], pendientes: ["rf24_c"] }),
      RF24,
    );
    expect(resultado).toEqual({ modo: "aplicar" });
  });

  it("Modo A (Ronda 8, generalizacion) -- prefijo aplicado + sufijo pendiente: una aplicada, dos todavia pendientes al final", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a"], pendientes: ["rf24_b", "rf24_c"] }),
      RF24,
    );
    expect(resultado).toEqual({ modo: "aplicar" });
  });

  it("Modo A (Ronda 8, generalizacion) -- caso real de produccion: las 3 migraciones originales aplicadas, la 4a (correctiva de privilegios) pendiente", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a", "rf24_b", "rf24_c"], pendientes: ["rf24_d"] }),
      RF24_4,
    );
    expect(resultado).toEqual({ modo: "aplicar" });
  });

  it("Modo A (Ronda 8, generalizacion) -- mezcla aplicada/resuelta permitida en el prefijo, antes del sufijo pendiente", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a"], reversionesResueltas: ["rf24_b"], pendientes: ["rf24_c"] }),
      RF24,
    );
    expect(resultado).toEqual({ modo: "aplicar" });
  });

  it("bloqueado (Ronda 8) -- un hueco real: aplicada, pendiente, aplicada -- no es un prefijo/sufijo continuo valido", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a", "rf24_c"], pendientes: ["rf24_b"] }),
      RF24,
    );
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toBeTruthy();
  });

  it("bloqueado (Ronda 8) -- el prefijo aplicado es valido, pero las pendientes globales no coinciden con el sufijo esperado (orden incorrecto)", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a"], pendientes: ["rf24_c", "rf24_b"] }),
      RF24,
    );
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toContain("sufijo esperado");
  });

  it("bloqueado (Ronda 8) -- el prefijo aplicado + sufijo pendiente seria valido, pero hay ademas una migracion pendiente ajena a RF24", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a"], pendientes: ["rf24_b", "rf24_c", "otra_migracion"] }),
      RF24,
    );
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toContain("otra_migracion");
  });

  it("bloqueado -- una de las 3 de RF24 tiene una anomalia activa", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: ["rf24_a", "rf24_c"], anomaliasActivas: ["rf24_b"] }),
      RF24,
    );
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toContain("rf24_b");
  });

  it("bloqueado -- una de las 3 de RF24 tiene una reversion sin resolucion", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ pendientes: ["rf24_a", "rf24_c"], reversionesSinResolucion: ["rf24_b"] }),
      RF24,
    );
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toContain("rf24_b");
  });

  it("bloqueado -- las 3 de RF24 estan pendientes, pero hay otra migracion pendiente ajena a RF24", () => {
    const resultado = decidirModoMigracionesRf24(estado({ pendientes: [...RF24, "otra_migracion"] }), RF24);
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toContain("otra_migracion");
  });

  it("bloqueado -- una de las 3 de RF24 esta ausente de toda categoria (ni aplicada, resuelta, pendiente, anomalia o reversion sin resolver)", () => {
    const resultado = decidirModoMigracionesRf24(estado({ pendientes: ["rf24_a", "rf24_c"] }), RF24);
    expect(resultado.modo).toBe("bloqueado");
  });

  it("bloqueado -- las 3 de RF24 ya estan aplicadas/resueltas, pero queda OTRA migracion pendiente ajena a RF24", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: [...RF24], pendientes: ["otra_migracion_pendiente"] }),
      RF24,
    );
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toContain("otra_migracion_pendiente");
  });

  it("bloqueado -- las 3 de RF24 estarian en modo aplicar, pero hay una anomalia activa FUERA del conjunto RF24", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ pendientes: [...RF24], anomaliasActivas: ["otra_migracion_con_anomalia"] }),
      RF24,
    );
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toContain("otra_migracion_con_anomalia");
  });

  it("bloqueado -- las 3 de RF24 estarian en modo continuar, pero hay una reversion sin resolucion FUERA del conjunto RF24", () => {
    const resultado = decidirModoMigracionesRf24(
      estado({ aplicadas: [...RF24], reversionesSinResolucion: ["otra_migracion_sin_resolver"] }),
      RF24,
    );
    expect(resultado.modo).toBe("bloqueado");
    expect(resultado.motivo).toContain("otra_migracion_sin_resolver");
  });

  it("bloqueado -- las pendientes de RF24 NO estan en el orden exacto esperado", () => {
    const resultado = decidirModoMigracionesRf24(estado({ pendientes: ["rf24_b", "rf24_a", "rf24_c"] }), RF24);
    expect(resultado.modo).toBe("bloqueado");
  });
});

// Pruebas -- evaluarDefinicionesMigracion5() (Ronda 9, Alex: verificacion
// BLOQUEANTE post-migracion-5 -- firma/SECURITY DEFINER/propietario/
// search_path exactos de crear_solicitud_derechos y
// aplicar_efecto_solicitud_derechos). Funcion 100% pura (nunca toca
// Prisma, Postgres ni el disco): estas pruebas construyen las filas de
// catalogo a mano, nunca via consultarCatalogoRf24 (eso requiere conexion
// real y queda cubierto por las pruebas de integracion), para aislar
// unicamente la logica de comparacion.
describe("evaluarDefinicionesMigracion5", () => {
  const IDENTIDAD_CREAR_SOLICITUD =
    "p_evaluacion_id text, p_correo_hash_entrante text, p_tipo text, p_alcance_retiro text, p_huella_hash text";
  const IDENTIDAD_APLICAR_EFECTO = "p_evaluacion_id text, p_tipo text, p_alcance_retiro text, p_metodo_retiro text";

  function filaCrearSolicitud(parcial: Partial<FilaDefinicionFuncionMigracion5> = {}): FilaDefinicionFuncionMigracion5 {
    return {
      proname: "crear_solicitud_derechos",
      identidad_argumentos: IDENTIDAD_CREAR_SOLICITUD,
      prosecdef: true,
      propietario: "neondb_owner",
      search_path: "public, pg_temp",
      ...parcial,
    };
  }

  function filaAplicarEfecto(parcial: Partial<FilaDefinicionFuncionMigracion5> = {}): FilaDefinicionFuncionMigracion5 {
    return {
      proname: "aplicar_efecto_solicitud_derechos",
      identidad_argumentos: IDENTIDAD_APLICAR_EFECTO,
      prosecdef: false,
      propietario: "neondb_owner",
      search_path: "public, pg_temp",
      ...parcial,
    };
  }

  it("coincide -- las 2 filas reales coinciden EXACTAMENTE con lo esperado (firma, SECURITY DEFINER asimetrico, propietario, search_path)", () => {
    const resultado = evaluarDefinicionesMigracion5([filaCrearSolicitud(), filaAplicarEfecto()]);
    expect(resultado).toEqual({ coincide: true, discrepancias: [] });
  });

  it("discrepancia -- crear_solicitud_derechos ausente por completo en pg_proc", () => {
    const resultado = evaluarDefinicionesMigracion5([filaAplicarEfecto()]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toEqual([
      { proname: "crear_solicitud_derechos", motivo: "funcion ausente en pg_proc (esquema public)" },
    ]);
  });

  it("discrepancia -- aplicar_efecto_solicitud_derechos ausente por completo en pg_proc", () => {
    const resultado = evaluarDefinicionesMigracion5([filaCrearSolicitud()]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toEqual([
      { proname: "aplicar_efecto_solicitud_derechos", motivo: "funcion ausente en pg_proc (esquema public)" },
    ]);
  });

  it("discrepancia -- ambas funciones ausentes (filas vacias)", () => {
    const resultado = evaluarDefinicionesMigracion5([]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias.map((d) => d.proname)).toEqual([
      "crear_solicitud_derechos",
      "aplicar_efecto_solicitud_derechos",
    ]);
  });

  it("discrepancia -- firma inesperada (identidad_argumentos distinta) en crear_solicitud_derechos", () => {
    const resultado = evaluarDefinicionesMigracion5([
      filaCrearSolicitud({ identidad_argumentos: "p_evaluacion_id text" }),
      filaAplicarEfecto(),
    ]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toHaveLength(1);
    expect(resultado.discrepancias[0]?.proname).toBe("crear_solicitud_derechos");
    expect(resultado.discrepancias[0]?.motivo).toContain("firma inesperada");
    expect(resultado.discrepancias[0]?.motivo).toContain(IDENTIDAD_CREAR_SOLICITUD);
  });

  it("discrepancia -- SECURITY DEFINER inesperado: crear_solicitud_derechos SIN SECURITY DEFINER (deberia tenerlo)", () => {
    const resultado = evaluarDefinicionesMigracion5([filaCrearSolicitud({ prosecdef: false }), filaAplicarEfecto()]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toEqual([
      {
        proname: "crear_solicitud_derechos",
        motivo: "SECURITY DEFINER inesperado: esperado=true real=false",
      },
    ]);
  });

  it("discrepancia -- SECURITY DEFINER inesperado: aplicar_efecto_solicitud_derechos CON SECURITY DEFINER (nunca deberia tenerlo -- asimetria por diseno)", () => {
    const resultado = evaluarDefinicionesMigracion5([filaCrearSolicitud(), filaAplicarEfecto({ prosecdef: true })]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toEqual([
      {
        proname: "aplicar_efecto_solicitud_derechos",
        motivo: "SECURITY DEFINER inesperado: esperado=false real=true",
      },
    ]);
  });

  it("discrepancia -- propietario inesperado (no es neondb_owner)", () => {
    const resultado = evaluarDefinicionesMigracion5([
      filaCrearSolicitud({ propietario: "chainpulse_app" }),
      filaAplicarEfecto(),
    ]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toEqual([
      {
        proname: "crear_solicitud_derechos",
        motivo: "propietario inesperado: esperado=neondb_owner real=chainpulse_app",
      },
    ]);
  });

  it("discrepancia -- search_path inesperado (valor distinto)", () => {
    const resultado = evaluarDefinicionesMigracion5([
      filaCrearSolicitud({ search_path: "public" }),
      filaAplicarEfecto(),
    ]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toEqual([
      {
        proname: "crear_solicitud_derechos",
        motivo: 'search_path inesperado: esperado="public, pg_temp" real=public',
      },
    ]);
  });

  it("discrepancia -- search_path NULL (sin ninguna entrada search_path en proconfig) se reporta como NULL, nunca se asume", () => {
    const resultado = evaluarDefinicionesMigracion5([
      filaCrearSolicitud({ search_path: null }),
      filaAplicarEfecto(),
    ]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toEqual([
      {
        proname: "crear_solicitud_derechos",
        motivo: 'search_path inesperado: esperado="public, pg_temp" real=NULL',
      },
    ]);
  });

  it("acumula TODAS las discrepancias de una misma funcion -- nunca se detiene en la primera (misma funcion con 4 campos mal a la vez)", () => {
    const resultado = evaluarDefinicionesMigracion5([
      filaCrearSolicitud({
        identidad_argumentos: "x text",
        prosecdef: false,
        propietario: "chainpulse_app",
        search_path: null,
      }),
      filaAplicarEfecto(),
    ]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toHaveLength(4);
    expect(resultado.discrepancias.every((d) => d.proname === "crear_solicitud_derechos")).toBe(true);
    const motivos = resultado.discrepancias.map((d) => d.motivo);
    expect(motivos.some((m) => m.includes("firma inesperada"))).toBe(true);
    expect(motivos.some((m) => m.includes("SECURITY DEFINER inesperado"))).toBe(true);
    expect(motivos.some((m) => m.includes("propietario inesperado"))).toBe(true);
    expect(motivos.some((m) => m.includes("search_path inesperado"))).toBe(true);
  });

  it("acumula discrepancias de AMBAS funciones a la vez cuando ambas fallan", () => {
    const resultado = evaluarDefinicionesMigracion5([
      filaCrearSolicitud({ prosecdef: false }),
      filaAplicarEfecto({ propietario: "otro_rol" }),
    ]);
    expect(resultado.coincide).toBe(false);
    expect(resultado.discrepancias).toHaveLength(2);
    expect(resultado.discrepancias.map((d) => d.proname).sort()).toEqual([
      "aplicar_efecto_solicitud_derechos",
      "crear_solicitud_derechos",
    ]);
  });

  it("ignora filas de catalogo adicionales que no correspondan a ninguna de las 2 funciones esperadas", () => {
    const resultado = evaluarDefinicionesMigracion5([
      filaCrearSolicitud(),
      filaAplicarEfecto(),
      filaCrearSolicitud({ proname: "otra_funcion_cualquiera" }),
    ]);
    expect(resultado).toEqual({ coincide: true, discrepancias: [] });
  });
});
