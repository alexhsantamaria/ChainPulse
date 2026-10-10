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
  const codigoFuente = readFileSync(RUTA_PANEL, "utf-8");

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
