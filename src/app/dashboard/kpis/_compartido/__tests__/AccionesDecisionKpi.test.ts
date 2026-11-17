// Pruebas (sin DB, sin jsdom) -- AccionesDecisionKpi.tsx, especificamente
// FilaAccion (el componente cliente que renderiza una fila del historial
// de acciones, con los badges de estado/prioridad/fecha objetivo).
// Mismo patron ya usado en este repo para probar un componente .tsx sin
// montarlo a un DOM real (ver DetalleObservacionKpi.test.ts en esta
// misma carpeta, y la decision de Alex del 2026-10-10 citada en
// construirMensajeError.test.ts): se llama el componente directamente
// como la funcion que es y se inspecciona con
// react-dom/server.renderToStaticMarkup() lo que devuelve. FilaAccion no
// usa useEffect (solo useState, que renderToStaticMarkup resuelve con el
// valor inicial sin problema), asi que un render estatico alcanza para
// verificar tanto el texto formateado como la separacion real entre
// badges -- no requiere simular ningun evento de usuario.
//
// Este archivo usa React.createElement en vez de sintaxis JSX: vive en
// *.test.ts (no *.test.tsx) para que vitest.config.ts lo recolecte
// (include solo lista "src/**/*.test.ts"), y el loader "ts" de esbuild
// que Vitest usa para .ts no acepta sintaxis JSX literal (jsx:
// "automatic" en esa config solo cambia COMO se transforma el JSX que
// ya existe en archivos .tsx importados, no habilita parsearlo dentro de
// un .ts).
//
// Correccion de validacion real en Windows (2026-11-16): FilaAccion y
// AccionApi se exportaron especificamente para que este archivo pudiera
// existir (antes no habia ninguna prueba de render para este
// componente).
//
// Ronda de revision (2026-11-16, Alex): el fixture por defecto de
// accionBase() estaba en un estado invalido -- estado: "COMPLETADA" con
// finalizadaEn/finalizadaPorId en null, algo que el flujo real nunca
// produce (ver AccionesDecisionKpi.tsx: una accion COMPLETADA siempre
// registra quien y cuando la finalizo). Ahora el fixture por defecto
// trae ambos campos poblados con un usuario valido de USUARIOS. Ademas,
// createdAt/finalizadaEn por defecto son instantes que CRUZAN la
// medianoche entre UTC y America/Lima (no solo una hora distinta dentro
// del mismo dia calendario) -- asi, si alguna correccion futura les
// aplicara por error timeZone: "UTC" (el campo que SI lo necesita es
// fechaObjetivo, no estos dos timestamps reales), la prueba de abajo lo
// detectaria con un dia de diferencia, no solo con una hora.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilaAccion, type AccionApi, type UsuarioCandidato } from "../AccionesDecisionKpi";
import { fijarZonaHorariaDePrueba } from "./entornoPruebaZonaHoraria";

const USUARIOS: UsuarioCandidato[] = [
  { id: "resp-1", nombre: "Responsable Uno", email: "resp1@example.com" },
  { id: "creador-1", nombre: "Creador Uno", email: "creador1@example.com" },
  { id: "finalizador-1", nombre: "Finalizador Uno", email: "finalizador1@example.com" },
];

function accionBase(overrides: Partial<AccionApi> = {}): AccionApi {
  return {
    id: "accion-1",
    observacionKpiId: "obs-1",
    importacionCsvId: null,
    ruleVersionOrigen: "v1",
    prioridadOrigen: "ALTA",
    descripcionAccion: "Contactar al proveedor por el retraso",
    responsableId: "resp-1",
    fechaObjetivo: "2026-11-20T00:00:00.000Z",
    estado: "COMPLETADA",
    creadaPorId: "creador-1",
    // 2026-01-15T02:00:00.000Z: 15 de ene en UTC, pero 14 de ene en
    // America/Lima (UTC-5) -- cruza la medianoche entre ambas zonas.
    createdAt: "2026-01-15T02:00:00.000Z",
    // 2026-12-05T03:00:00.000Z: 05 de dic en UTC, pero 04 de dic en
    // America/Lima (UTC-5) -- cruza la medianoche entre ambas zonas.
    // Una accion COMPLETADA siempre tiene finalizadaEn/finalizadaPorId
    // poblados (ver comentario de cabecera) -- nunca null en un
    // fixture valido.
    finalizadaEn: "2026-12-05T03:00:00.000Z",
    finalizadaPorId: "finalizador-1",
    ...overrides,
  };
}

async function noOp() {
  // onCambiada no se ejerce en un render estatico (no hay eventos).
}

function renderFila(accion: AccionApi): string {
  return renderToStaticMarkup(
    createElement("ul", null, createElement(FilaAccion, { accion, usuarios: USUARIOS, onCambiada: noOp })),
  );
}

describe("FilaAccion -- badges de estado/prioridad/fecha objetivo", () => {
  // Correccion de validacion real en Windows (2026-11-16, bloqueante 2):
  // los 3 <span> (estado, prioridad, "Objetivo: ...") son hermanos
  // separados solo por gap-2 de flexbox -- espaciado visual, sin nodo de
  // texto real en el DOM. Al copiar o leer el texto quedaban pegados:
  // "CompletadaPrioridad altaObjetivo: ...". Esta prueba verifica el
  // espacio real (via {" "}) entre esos 3 spans.
  it("hay un espacio real (no solo visual) entre los badges de estado, prioridad y la fecha objetivo", () => {
    const html = renderFila(accionBase());

    expect(html).not.toContain("CompletadaPrioridad alta");
    expect(html).not.toContain("altaObjetivo:");
    expect(html).toMatch(/Completada<\/span>\s+<span[^>]*>/);
    expect(html).toMatch(/Prioridad alta<\/span>\s+<span[^>]*>Objetivo:/);
  });

  // Correccion de validacion real en Windows (2026-11-16, bloqueante 1):
  // fechaObjetivo es date-only, persistida a medianoche UTC exacta.
  // America/Lima (UTC-5) es la misma zona de offset negativo ya usada en
  // este repo para esta clase de defecto, y la que reprodujo el defecto
  // original reportado por el usuario (2026-11-20 mostrado como 19/11).
  it("en America/Lima (UTC-5), 'Objetivo:' muestra el 20, no el 19 (defecto reportado)", () => {
    const restaurarTZ = fijarZonaHorariaDePrueba("America/Lima");
    try {
      const html = renderFila(accionBase());

      expect(html).toContain("Objetivo: 20 de nov de 2026");
      expect(html).not.toContain("Objetivo: 19 de nov de 2026");
    } finally {
      restaurarTZ();
    }
  });

  // Correccion de validacion real en Windows (2026-11-16, reforzada en
  // ronda de revision): createdAt y finalizadaEn son timestamps REALES
  // (no date-only) -- deben seguir mostrandose en la hora LOCAL de quien
  // mira la pantalla, nunca forzados a UTC (ese es el error que tendria
  // la correccion de fechaObjetivo si, por accidente, se le hubiera
  // aplicado tambien a estos dos campos). Se corre explicitamente bajo
  // America/Lima (UTC-5) y con instantes que CRUZAN la medianoche entre
  // UTC y Lima -- si alguna de las 2 fechas se mostrara en UTC en vez de
  // en hora local, el dia calendario seria distinto y la prueba lo
  // detectaria.
  it("createdAt y finalizadaEn siguen formateandose en hora LOCAL, nunca forzados a UTC", () => {
    const restaurarTZ = fijarZonaHorariaDePrueba("America/Lima");
    try {
      const html = renderFila(accionBase());

      // createdAt = 2026-01-15T02:00:00.000Z -- en America/Lima es 14
      // de enero (UTC seria 15 de enero).
      expect(html).toContain("14 de ene de 2026");
      expect(html).not.toContain("15 de ene de 2026");

      // finalizadaEn = 2026-12-05T03:00:00.000Z -- en America/Lima es
      // 04 de diciembre (UTC seria 05 de diciembre).
      expect(html).toContain("04 de dic de 2026");
      expect(html).not.toContain("05 de dic de 2026");
    } finally {
      restaurarTZ();
    }
  });
});
