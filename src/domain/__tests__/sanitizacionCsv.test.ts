// Pruebas -- sanitizacion de inyeccion de formulas CSV (Incremento 4,
// Bloque B, preparacion). Corregido 2026-09-24 tras revision de Alex:
// separa deteccion (pura, nunca muta) de neutralizacion de exportacion
// (aplica solo al escribir un archivo de salida, nunca sobre un valor
// usado como identidad de negocio) -- ver el comentario de cabecera de
// sanitizacionCsv.ts.
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import {
  esFormulaPeligrosa,
  neutralizarCeldaParaHojaDeCalculo,
  neutralizarFilaParaExportacion,
} from "../sanitizacionCsv";

describe("esFormulaPeligrosa", () => {
  it("detecta los 4 caracteres marcados por Alex al inicio de la celda", () => {
    expect(esFormulaPeligrosa("=cmd|'/c calc'!A1")).toBe(true);
    expect(esFormulaPeligrosa("+1+1")).toBe(true);
    expect(esFormulaPeligrosa("-2+3")).toBe(true);
    expect(esFormulaPeligrosa("@SUM(A1:A9)")).toBe(true);
  });

  it("detecta tab y retorno de carro al inicio (OWASP, no en la lista original de Alex)", () => {
    expect(esFormulaPeligrosa("\t=cmd")).toBe(true);
    expect(esFormulaPeligrosa("\rcmd")).toBe(true);
  });

  it("ignora espacios en blanco iniciales antes de mirar el primer caracter", () => {
    expect(esFormulaPeligrosa("   =cmd")).toBe(true);
  });

  it("no marca texto normal, ni un caracter peligroso que no esta al inicio", () => {
    expect(esFormulaPeligrosa("SKU-001")).toBe(false);
    expect(esFormulaPeligrosa("Almacen Lima")).toBe(false);
    expect(esFormulaPeligrosa("Pedido con - guion en el medio")).toBe(false);
  });

  it("cadena vacia no es peligrosa", () => {
    expect(esFormulaPeligrosa("")).toBe(false);
    expect(esFormulaPeligrosa("   ")).toBe(false);
  });
});

describe("neutralizarCeldaParaHojaDeCalculo", () => {
  it("prefija con apostrofo cuando la celda es peligrosa, preservando el valor original", () => {
    expect(neutralizarCeldaParaHojaDeCalculo("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(neutralizarCeldaParaHojaDeCalculo("+1+1")).toBe("'+1+1");
    expect(neutralizarCeldaParaHojaDeCalculo("-2+3")).toBe("'-2+3");
    expect(neutralizarCeldaParaHojaDeCalculo("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
  });

  it("no toca texto seguro", () => {
    expect(neutralizarCeldaParaHojaDeCalculo("SKU-001")).toBe("SKU-001");
    expect(neutralizarCeldaParaHojaDeCalculo("Almacen Lima")).toBe("Almacen Lima");
  });

  it("es idempotente -- no duplica el apostrofo si ya esta neutralizada", () => {
    const neutralizada = neutralizarCeldaParaHojaDeCalculo("=cmd");
    expect(neutralizarCeldaParaHojaDeCalculo(neutralizada)).toBe(neutralizada);
  });
});

describe("neutralizarFilaParaExportacion", () => {
  it("neutraliza solo los campos declarados, para uso EXCLUSIVO en filas de exportacion", () => {
    const filaExportacion = {
      sku: "=cmd|'/c calc'!A1",
      ubicacion: "Almacen Lima",
      coberturaDias: "5", // string ya formateada para el archivo de salida
    };
    const resultado = neutralizarFilaParaExportacion(filaExportacion, ["sku", "ubicacion"]);
    expect(resultado.sku).toBe("'=cmd|'/c calc'!A1");
    expect(resultado.ubicacion).toBe("Almacen Lima");
    expect(resultado.coberturaDias).toBe("5");
  });

  it("no muta la fila original (funcion pura)", () => {
    const fila = { sku: "=cmd" };
    const original = { ...fila };
    neutralizarFilaParaExportacion(fila, ["sku"]);
    expect(fila).toEqual(original);
  });

  it("deja sin tocar valores que no son string, aunque el campo este en la lista", () => {
    const fila = { sku: "=cmd", cantidad: 5 as unknown };
    const resultado = neutralizarFilaParaExportacion(fila, ["sku", "cantidad"]);
    expect(resultado.cantidad).toBe(5);
  });

  it("NUNCA debe aplicarse a un valor que todavia se vaya a usar como clave de deduplicacion -- documentado, no forzable en tipos: la prueba deja constancia del caso de uso correcto", () => {
    // Ejemplo real del proyecto: engine/kpis/stockout.ts deduplica por
    // sku+ubicacion+fecha (claveFila). Si se neutralizara el SKU ANTES de
    // deduplicar, "=SKU" y su version neutralizada "'=SKU" competirian
    // como si fueran identidades distintas -- exactamente el bug que
    // motivo esta reescritura. La regla es de uso (dónde se llama esta
    // funcion), no algo que el tipo pueda impedir: se deja este test como
    // documentacion ejecutable del caso de uso correcto (exportacion) vs.
    // el incorrecto (identidad).
    const skuOriginal = "=SKU-PELIGROSO";
    const claveDedupOriginal = skuOriginal; // lo que engine/kpis/*.ts usaria para deduplicar
    const skuNeutralizado = neutralizarCeldaParaHojaDeCalculo(skuOriginal); // solo para un archivo de exportacion
    expect(claveDedupOriginal).not.toBe(skuNeutralizado);
    expect(claveDedupOriginal).toBe(skuOriginal);
  });
});

describe("integracion real con PapaParse (estructura del CSV, no solo la funcion aislada)", () => {
  it("PapaParse.unparse escapa automaticamente delimitador/comillas/saltos de linea -- no es responsabilidad de este modulo", () => {
    const filas = [
      { sku: "SKU,CON-COMA", ubicacion: 'Almacen "Lima Norte"', nota: "linea 1\nlinea 2" },
    ];
    const csv = Papa.unparse(filas);
    // El campo con coma queda citado -- PapaParse decide el criterio de
    // citado (RFC4180: solo si hace falta), no este modulo.
    expect(csv).toContain('"SKU,CON-COMA"');
    // Las comillas internas se escapan duplicandolas, RFC4180.
    expect(csv).toContain('"Almacen ""Lima Norte"""');
    // Re-parsear el CSV generado debe recuperar los valores originales
    // exactos -- prueba de ida y vuelta contra la libreria real.
    const reparsed = Papa.parse<Record<string, string>>(csv, { header: true });
    expect(reparsed.data[0]).toEqual(filas[0]);
  });

  it("una celda neutralizada con apostrofo sobrevive intacta un ciclo completo de unparse/parse", () => {
    const filaExportacion = neutralizarFilaParaExportacion(
      { sku: "=cmd|'/c calc'!A1", ubicacion: "Lima" },
      ["sku", "ubicacion"],
    );
    const csv = Papa.unparse([filaExportacion]);
    const reparsed = Papa.parse<Record<string, string>>(csv, { header: true });
    // El valor que queda en el archivo es el neutralizado (con
    // apostrofo) -- exactamente lo que Excel/Sheets necesitan ver para
    // tratarlo como texto literal en vez de ejecutar la formula.
    expect(reparsed.data[0]?.sku).toBe("'=cmd|'/c calc'!A1");
  });
});
