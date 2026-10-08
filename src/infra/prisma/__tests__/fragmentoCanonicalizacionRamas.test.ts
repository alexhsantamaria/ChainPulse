// Pruebas LOCALES (sin conexion real) para extraerFragmentoDeTexto()
// (fragmentoCanonicalizacionRamas.ts) -- RONDA 20, Alex 2026-10-07:
// demuestra, con texto SQL sintetico (nunca el migration.sql real ni
// una conexion), los 5 comportamientos pedidos:
//
//   1. El fragmento comienza en "-- SECCION A".
//   2. Incluye las secciones A y B completas.
//   3. No incluye la seccion C.
//   4. No comienza con texto desnudo "SECCION".
//   5. Aborta con error fijo si faltan, se duplican o estan
//      desordenados los marcadores.
//
// Corre con `npm run test` (nombre ".test.ts", no ".integration.test.ts")
// -- nunca abre una conexion, nunca lee migration.sql real.
import { describe, expect, it } from "vitest";
import { extraerFragmentoDeTexto } from "./fragmentoCanonicalizacionRamas";

// SQL sintetico minimo, con la misma forma que el fragmento real
// (marcador completo + contenido reconocible por seccion), para poder
// afirmar sobre que quedo adentro y que quedo afuera sin depender del
// contenido real de la migracion.
const SQL_SINTETICO_VALIDO = [
  "-- ENCABEZADO, nunca deberia quedar incluido",
  "SELECT 1; -- ruido antes de la seccion A",
  "",
  "-- SECCION A -- contenido de la seccion A",
  "CONTENIDO_SECCION_A_UNICO",
  "",
  "-- SECCION B -- contenido de la seccion B",
  "CONTENIDO_SECCION_B_UNICO",
  "",
  "-- SECCION C -- contenido de la seccion C, nunca deberia quedar incluido",
  "CONTENIDO_SECCION_C_UNICO",
].join("\n");

describe("extraerFragmentoDeTexto() -- marcadores completos, sin conexion real", () => {
  it("1. el fragmento comienza en el marcador completo \"-- SECCION A\" (preserva el prefijo de comentario SQL)", () => {
    const resultado = extraerFragmentoDeTexto(SQL_SINTETICO_VALIDO);

    expect(resultado.startsWith("BEGIN;\n\n-- SECCION A")).toBe(true);
  });

  it("2. incluye las secciones A y B completas", () => {
    const resultado = extraerFragmentoDeTexto(SQL_SINTETICO_VALIDO);

    expect(resultado).toContain("CONTENIDO_SECCION_A_UNICO");
    expect(resultado).toContain("CONTENIDO_SECCION_B_UNICO");
  });

  it("3. no incluye la seccion C", () => {
    const resultado = extraerFragmentoDeTexto(SQL_SINTETICO_VALIDO);

    expect(resultado).not.toContain("CONTENIDO_SECCION_C_UNICO");
    expect(resultado).not.toContain("-- SECCION C");
  });

  it('4. no comienza con texto desnudo "SECCION" -- toda aparicion de "SECCION A" esta precedida por "-- "', () => {
    const resultado = extraerFragmentoDeTexto(SQL_SINTETICO_VALIDO);

    // Si el extractor hubiera buscado "SECCION A" sin el prefijo "-- "
    // (el bug de antes de esta ronda), "SECCION A" aparaceria en el
    // resultado SIN "-- " inmediatamente antes -- indexOf("SECCION A")
    // no coincidiria con indexOf("-- SECCION A") + 3.
    const idxDesnudo = resultado.indexOf("SECCION A");
    const idxCompleto = resultado.indexOf("-- SECCION A");
    expect(idxDesnudo).toBeGreaterThan(-1);
    expect(idxDesnudo).toBe(idxCompleto + 3);
  });

  describe("5. aborta con el error fijo MARCADORES_SECCION_INVALIDOS si los marcadores faltan, se duplican o estan desordenados", () => {
    it("falta el marcador de apertura (\"-- SECCION A\")", () => {
      const sql = SQL_SINTETICO_VALIDO.replace("-- SECCION A -- contenido de la seccion A", "SECCION A SIN EL PREFIJO DE COMENTARIO");

      expect(() => extraerFragmentoDeTexto(sql)).toThrow(/MARCADORES_SECCION_INVALIDOS/);
    });

    it("falta el marcador de cierre (\"-- SECCION C\")", () => {
      const sql = SQL_SINTETICO_VALIDO.replace("-- SECCION C -- contenido de la seccion C, nunca deberia quedar incluido", "SECCION C SIN EL PREFIJO DE COMENTARIO");

      expect(() => extraerFragmentoDeTexto(sql)).toThrow(/MARCADORES_SECCION_INVALIDOS/);
    });

    it('el marcador de apertura aparece DOS VECES', () => {
      const sql = `-- SECCION A -- duplicado a proposito\n${SQL_SINTETICO_VALIDO}`;

      expect(() => extraerFragmentoDeTexto(sql)).toThrow(/MARCADORES_SECCION_INVALIDOS/);
    });

    it("el marcador de cierre aparece DOS VECES", () => {
      const sql = `${SQL_SINTETICO_VALIDO}\n-- SECCION C -- duplicado a proposito`;

      expect(() => extraerFragmentoDeTexto(sql)).toThrow(/MARCADORES_SECCION_INVALIDOS/);
    });

    it("los marcadores estan DESORDENADOS (\"-- SECCION C\" aparece ANTES de \"-- SECCION A\")", () => {
      const sql = [
        "-- SECCION C -- aparece primero, a proposito (desordenado)",
        "CONTENIDO_SECCION_C_UNICO",
        "-- SECCION A -- aparece despues",
        "CONTENIDO_SECCION_A_UNICO",
      ].join("\n");

      expect(() => extraerFragmentoDeTexto(sql)).toThrow(/MARCADORES_SECCION_INVALIDOS/);
    });
  });
});
