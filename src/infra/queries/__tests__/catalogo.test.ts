// Pruebas -- catalogo cerrado de Incremento 5 (I5-08). Pura (sin Prisma),
// no necesita ningun mock.
import { describe, expect, it } from "vitest";
import { CATALOGO_CONSULTA_IDS } from "@/domain/queries/tipos";
import { esCatalogoConsultaId, listarCatalogoConsultas, obtenerMetadatosCatalogo, RULE_VERSION_CONSULTAS } from "../catalogo";

describe("esCatalogoConsultaId", () => {
  it("acepta cada uno de los 6 literales del catalogo", () => {
    for (const id of CATALOGO_CONSULTA_IDS) {
      expect(esCatalogoConsultaId(id)).toBe(true);
    }
  });

  it.each([
    "SELECT * FROM usuarios",
    "otif_caida", // minusculas -- nunca case-insensitive
    "",
    "OTIF_CAIDA ", // con espacio
    "cualquier_cosa",
  ])("rechaza %j -- nunca un string arbitrario de red, I5-08", (valor) => {
    expect(esCatalogoConsultaId(valor)).toBe(false);
  });
});

describe("obtenerMetadatosCatalogo", () => {
  it("devuelve metadata completa para cada uno de los 6 IDs validos", () => {
    for (const id of CATALOGO_CONSULTA_IDS) {
      const metadatos = obtenerMetadatosCatalogo(id);
      expect(metadatos).not.toBeNull();
      expect(metadatos?.id).toBe(id);
      expect(metadatos?.ruleVersion).toBe(RULE_VERSION_CONSULTAS);
      expect(metadatos?.permisos.length).toBeGreaterThan(0);
    }
  });

  it("devuelve null para un ID que no existe en el catalogo, sin lanzar", () => {
    expect(obtenerMetadatosCatalogo("NO_EXISTE")).toBeNull();
  });
});

describe("listarCatalogoConsultas", () => {
  it("devuelve exactamente las 6 entradas, en el orden de CATALOGO_CONSULTA_IDS", () => {
    const catalogo = listarCatalogoConsultas();
    expect(catalogo.map((m) => m.id)).toEqual(CATALOGO_CONSULTA_IDS);
  });

  it("cada entrada expone solo metadata -- nunca una funcion ejecutora ni referencia a Prisma", () => {
    for (const metadatos of listarCatalogoConsultas()) {
      for (const valor of Object.values(metadatos)) {
        expect(typeof valor).not.toBe("function");
      }
    }
  });

  it("CAMBIOS_ULTIMO_PULSO requiere periodo (usa periodo.inicio como el corte, ver ejecutarConsultaPermitida.ts)", () => {
    expect(obtenerMetadatosCatalogo("CAMBIOS_ULTIMO_PULSO")?.requierePeriodo).toBe(true);
  });

  it("DEPENDENCIA_CRITICA y ACCION_PRIORITARIA no requieren periodo", () => {
    expect(obtenerMetadatosCatalogo("DEPENDENCIA_CRITICA")?.requierePeriodo).toBe(false);
    expect(obtenerMetadatosCatalogo("ACCION_PRIORITARIA")?.requierePeriodo).toBe(false);
  });
});
