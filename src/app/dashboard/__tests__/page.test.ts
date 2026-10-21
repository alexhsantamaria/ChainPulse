// Pruebas — verificacion ESTATICA (sin render, sin base, sin red) del
// panel principal (src/app/dashboard/page.tsx). Este proyecto no tiene
// infraestructura de pruebas de componentes (vitest.config.ts corre en
// "environment: node", sin jsdom ni testing-library -- ver tambien el
// comentario de cabecera de construirMensajeError.test.ts, que aisla
// logica pura por la misma razon) y DashboardPage() es un Server
// Component async que abre conexion real via tenantClient(), asi que
// renderizarlo de verdad exigiria mockear sesion + Prisma sin ganar
// cobertura real. En su lugar, mismo patron que
// reconstruccionRlsAuthGrants.test.ts: se lee el archivo como TEXTO y se
// verifica con aserciones de texto que el enlace de navegacion exista --
// guardia de regresion minima para el defecto de navegabilidad que Alex
// encontro en el Preview del commit dab005f (2026-10-10): /dashboard/kpis/otif
// funcionaba, pero no habia ningun enlace visible hacia esa ruta desde el
// panel ni desde /dashboard/metricas.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUTA_PANEL = join(__dirname, "../page.tsx");

describe("DashboardPage -- navegabilidad hacia OTIF (piloto)", () => {
  // Normaliza CRLF/CR a LF antes de comparar: el contenido y la estructura
  // esperada no cambian, solo se vuelve insensible al estilo de fin de linea
  // del checkout (Git en Windows puede materializar el archivo con CRLF sin
  // que exista ninguna regla de normalizacion en el repositorio).
  const codigoFuente = readFileSync(RUTA_PANEL, "utf-8").replace(/\r\n?/g, "\n");

  it("existe un enlace visible hacia /dashboard/kpis/otif desde el panel", () => {
    expect(codigoFuente).toContain('href="/dashboard/kpis/otif"');
  });

  it("el enlace tiene una etiqueta clara para declarar OTIF", () => {
    expect(codigoFuente).toContain("Declarar OTIF (piloto)");
  });

  it("el enlace a OTIF, igual que el de Cobertura, queda reservado a ADMINISTRADOR (mismo patron de permisos de los otros accesos a KPIs)", () => {
    // Verbatim: la guardia de rol envuelve directamente al <Link> de OTIF,
    // igual que ya ocurre con el de Cobertura un bloque antes -- no un
    // enlace sin proteger agregado despues de la guardia.
    expect(codigoFuente).toContain(
      '{sesion.rol === "ADMINISTRADOR" && (\n          <Link\n            href="/dashboard/kpis/otif"',
    );
  });
});

describe("DashboardPage -- navegabilidad hacia Fill Rate (piloto, Incremento 4 Bloque B, Alex 2026-10-14)", () => {
  // Mismo patron exacto que el bloque de OTIF arriba -- guardia de
  // regresion para el mismo defecto de navegabilidad (Preview del commit
  // dab005f, 2026-10-10), ahora aplicado al siguiente KPI.
  const codigoFuente = readFileSync(RUTA_PANEL, "utf-8").replace(/\r\n?/g, "\n");

  it("existe un enlace visible hacia /dashboard/kpis/fill-rate desde el panel", () => {
    expect(codigoFuente).toContain('href="/dashboard/kpis/fill-rate"');
  });

  it("el enlace tiene una etiqueta clara para declarar Fill Rate", () => {
    expect(codigoFuente).toContain("Declarar Fill Rate (piloto)");
  });

  it("el enlace a Fill Rate, igual que el de OTIF y Cobertura, queda reservado a ADMINISTRADOR", () => {
    // Verbatim: la guardia de rol envuelve directamente al <Link> de Fill
    // Rate, igual que ya ocurre con el de OTIF un bloque antes -- no un
    // enlace sin proteger agregado despues de la guardia.
    expect(codigoFuente).toContain(
      '{sesion.rol === "ADMINISTRADOR" && (\n          <Link\n            href="/dashboard/kpis/fill-rate"',
    );
  });

  it("el enlace a Fill Rate aparece DESPUES del bloque de OTIF (orden de incrementos, nunca antes)", () => {
    const indiceOtif = codigoFuente.indexOf('href="/dashboard/kpis/otif"');
    const indiceFillRate = codigoFuente.indexOf('href="/dashboard/kpis/fill-rate"');
    expect(indiceOtif).toBeGreaterThan(-1);
    expect(indiceFillRate).toBeGreaterThan(indiceOtif);
  });
});


describe("DashboardPage -- navegabilidad hacia Consultas (Incremento 5, catálogo cerrado)", () => {
  // Mismo patron de guardia de regresion que los bloques de arriba, con
  // una diferencia deliberada: Consultas NO esta reservado a
  // ADMINISTRADOR (catalogo.ts: "disponible para ADMINISTRADOR y
  // RESPONSABLE" -- una consulta es de solo lectura, sin el riesgo de
  // corromper datos que tiene declarar un KPI).
  const codigoFuente = readFileSync(RUTA_PANEL, "utf-8").replace(/\r\n?/g, "\n");

  it("existe un enlace visible hacia /dashboard/consultas desde el panel", () => {
    expect(codigoFuente).toContain('href="/dashboard/consultas"');
  });

  it("el enlace tiene una etiqueta clara (Consultas)", () => {
    expect(codigoFuente).toContain("Consultas");
  });

  it("el enlace a Consultas NO esta envuelto en la guardia de ADMINISTRADOR (disponible para ambos roles)", () => {
    const indiceEnlace = codigoFuente.indexOf('href="/dashboard/consultas"');
    expect(indiceEnlace).toBeGreaterThan(-1);
    // Busca hacia atras, desde el enlace, el ultimo "{sesion.rol ===" que
    // lo precede y el ultimo "</Link>" que cierra un bloque anterior --
    // si el cierre de Link queda MAS CERCA que la guardia de rol, el
    // enlace no esta anidado dentro de ella.
    const textoAntes = codigoFuente.slice(0, indiceEnlace);
    const ultimaGuardiaRol = textoAntes.lastIndexOf('{sesion.rol === "ADMINISTRADOR" && (');
    const ultimoCierreLink = textoAntes.lastIndexOf("</Link>");
    expect(ultimoCierreLink).toBeGreaterThan(ultimaGuardiaRol);
  });
});
