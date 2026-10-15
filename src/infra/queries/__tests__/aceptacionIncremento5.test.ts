// Pruebas de aceptacion -- Incremento 5, Fase G (I5-26 determinismo,
// I5-27 respuesta honesta sin datos, I5-29 separacion estructural
// hecho/interpretacion/accion + ausencia de SQL libre/proveedor de IA).
// Mismo arnes que ejecutarConsultaPermitida.test.ts (tenantClient()
// mockeado con un cliente FALSO en memoria, nunca Postgres real --
// "prisma generate" bloqueado en este entorno, ver README) -- separado en
// su propio archivo porque cubre una categoria de requisito distinta
// (aceptacion end-to-end del catalogo completo) a la de ese archivo
// (dispatcher: permisos, errores, auditoria).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CATALOGO_CONSULTA_IDS, type CatalogoConsultaId, type RespuestaConsulta } from "@/domain/queries/tipos";

const tenantClientMock = vi.fn();
vi.mock("@/infra/prisma/tenantClient", () => ({ tenantClient: (...args: unknown[]) => tenantClientMock(...args) }));

import { ejecutarConsultaPermitida, type ResultadoEjecutarConsulta } from "../ejecutarConsultaPermitida";

const CONTEXTO = { empresaId: "empresa-1", usuarioId: "usuario-1", rol: "ADMINISTRADOR" as const };
const CADENA_ID = "cadena-1";
const PERIODO = { inicio: new Date("2026-09-01"), fin: new Date("2026-09-30") };

const CATALOGOS_CON_PERIODO: ReadonlySet<CatalogoConsultaId> = new Set([
  "OTIF_CAIDA",
  "OTIF_PROVEEDOR_RETRASOS",
  "FALTANTES_FILL_RATE",
  "CAMBIOS_ULTIMO_PULSO",
]);

function entradaPara(catalogoId: CatalogoConsultaId) {
  return { catalogoId, cadenaId: CADENA_ID, periodo: CATALOGOS_CON_PERIODO.has(catalogoId) ? PERIODO : null };
}

function clienteBase() {
  return {
    cadena: { findUnique: vi.fn().mockResolvedValue({ id: CADENA_ID }) },
    definicionKpi: { findFirst: vi.fn().mockResolvedValue(null) },
    observacionKpi: { findFirst: vi.fn().mockResolvedValue(null) },
    conexionCadena: { findMany: vi.fn().mockResolvedValue([]) },
    hallazgoCadena: { findMany: vi.fn().mockResolvedValue([]) },
    consultaLog: { create: vi.fn().mockResolvedValue({ id: "log-1" }) },
  };
}

type ClienteFalso = ReturnType<typeof clienteBase>;

// Configura un cliente falso con datos suficientes para que la pregunta
// responda con su camino "hay datos". OTIF_PROVEEDOR_RETRASOS es la
// excepcion deliberada: HOY siempre responde SIN_DATOS_SUFICIENTES (ver
// la nota de cabecera de engine/queries/otifProveedorRetrasos.ts --
// ObservacionKpi no tiene columna de proveedor) -- ninguna configuracion
// de cliente cambia eso, asi que no hay rama para ese caso aca.
function configurarConDatos(cliente: ClienteFalso, catalogoId: CatalogoConsultaId): void {
  switch (catalogoId) {
    case "OTIF_CAIDA": {
      cliente.definicionKpi.findFirst.mockResolvedValue({ id: "def-otif" });
      cliente.observacionKpi.findFirst.mockImplementation((args: { where: { periodoInicio?: Date } }) =>
        Promise.resolve(
          args.where.periodoInicio !== undefined
            ? { valor: 0.9, numerador: 90, denominador: 100, periodoInicio: PERIODO.inicio, periodoFin: PERIODO.fin, ruleVersion: "otif-v1" }
            : { valor: 0.85, numerador: 85, denominador: 100, periodoInicio: new Date("2026-08-01"), periodoFin: new Date("2026-08-31"), ruleVersion: "otif-v1" },
        ),
      );
      break;
    }
    case "OTIF_PROVEEDOR_RETRASOS":
      break;
    case "DEPENDENCIA_CRITICA": {
      cliente.conexionCadena.findMany.mockResolvedValue([
        {
          id: "cx-1",
          impactoFalla: "ALTO",
          tieneAlternativa: false,
          alternativaProbada: null,
          origenNodo: { nombre: "Compras" },
          destinoNodo: { nombre: "Producción" },
        },
      ]);
      break;
    }
    case "FALTANTES_FILL_RATE": {
      cliente.definicionKpi.findFirst.mockResolvedValue({ id: "def-fr" });
      cliente.observacionKpi.findFirst.mockResolvedValue({ valor: 0.95, ruleVersion: "fillrate-v1" });
      break;
    }
    case "ACCION_PRIORITARIA": {
      cliente.hallazgoCadena.findMany.mockResolvedValue([
        { id: "h-1", dimension: "NODO_CRITICO", resultado: "DIFERENCIA", createdAt: new Date("2026-09-15") },
      ]);
      break;
    }
    case "CAMBIOS_ULTIMO_PULSO": {
      cliente.hallazgoCadena.findMany.mockImplementation((args: { where: { createdAt?: { lt?: Date; gte?: Date } } }) =>
        Promise.resolve(
          args.where.createdAt?.lt
            ? [{ id: "h-antes", dimension: "NODO_CRITICO", resultado: "ACUERDO", createdAt: new Date("2026-08-01") }]
            : [{ id: "h-desde", dimension: "NODO_CRITICO", resultado: "DIFERENCIA", createdAt: new Date("2026-09-10") }],
        ),
      );
      break;
    }
  }
}

/** Angosta un ResultadoEjecutarConsulta a RespuestaConsulta -- descarta
 * los 6 arms de error exclusivos del dispatcher (CATALOGO_ID_INVALIDO,
 * CADENA_INEXISTENTE, etc.), que nunca llevan `catalogoId`. */
function comoRespuestaConsulta(resultado: ResultadoEjecutarConsulta): RespuestaConsulta {
  if (!("catalogoId" in resultado)) {
    throw new Error(`se esperaba una RespuestaConsulta, se obtuvo: ${JSON.stringify(resultado)}`);
  }
  return resultado;
}

beforeEach(() => {
  tenantClientMock.mockReset();
});

describe("I5-26 -- determinismo: misma entrada y mismos datos producen la misma respuesta, byte a byte", () => {
  it.each(CATALOGO_CONSULTA_IDS)("%s -- dos ejecuciones independientes con datos identicos son JSON-identicas", async (catalogoId) => {
    const clienteUno = clienteBase();
    configurarConDatos(clienteUno, catalogoId);
    tenantClientMock.mockReturnValue(clienteUno);
    const resultadoUno = await ejecutarConsultaPermitida(entradaPara(catalogoId), CONTEXTO);

    const clienteDos = clienteBase();
    configurarConDatos(clienteDos, catalogoId);
    tenantClientMock.mockReturnValue(clienteDos);
    const resultadoDos = await ejecutarConsultaPermitida(entradaPara(catalogoId), CONTEXTO);

    expect(JSON.stringify(resultadoDos)).toBe(JSON.stringify(resultadoUno));
  });
});

describe("I5-27 -- respuesta honesta cuando no hay datos suficientes (nunca un numero inventado)", () => {
  it("OTIF_PROVEEDOR_RETRASOS responde SIN_DATOS_SUFICIENTES (limite de esquema documentado en el motor)", async () => {
    const cliente = clienteBase();
    tenantClientMock.mockReturnValue(cliente);
    const resultado = comoRespuestaConsulta(await ejecutarConsultaPermitida(entradaPara("OTIF_PROVEEDOR_RETRASOS"), CONTEXTO));

    if (resultado.ok) throw new Error("se esperaba SIN_DATOS_SUFICIENTES");
    expect(resultado.error).toBe("SIN_DATOS_SUFICIENTES");
    expect(resultado.mensaje).not.toMatch(/\d/);
    expect(resultado.camposFaltantes.length).toBeGreaterThan(0);
    // El tipo discriminado ya garantiza esto a nivel de compilador
    // (RespuestaConsultaSinDatos no declara numerador/denominador) --
    // esta aserción runtime lo refuerza sobre el objeto real.
    expect(resultado).not.toHaveProperty("numerador");
    expect(resultado).not.toHaveProperty("denominador");
  });

  it("OTIF_CAIDA sin observación actual ni anterior responde SIN_DATOS_SUFICIENTES, nunca un OTIF inventado", async () => {
    const cliente = clienteBase();
    cliente.definicionKpi.findFirst.mockResolvedValue({ id: "def-otif" });
    cliente.observacionKpi.findFirst.mockResolvedValue(null);
    tenantClientMock.mockReturnValue(cliente);
    const resultado = comoRespuestaConsulta(await ejecutarConsultaPermitida(entradaPara("OTIF_CAIDA"), CONTEXTO));

    if (resultado.ok) throw new Error("se esperaba SIN_DATOS_SUFICIENTES");
    expect(resultado.error).toBe("SIN_DATOS_SUFICIENTES");
  });
});

describe("I5-29 -- separación estructural hecho/interpretación/acción, sin SQL libre ni proveedor de IA", () => {
  const CON_CAMINO_OK = ["OTIF_CAIDA", "DEPENDENCIA_CRITICA", "FALTANTES_FILL_RATE", "ACCION_PRIORITARIA", "CAMBIOS_ULTIMO_PULSO"] as const;

  it.each(CON_CAMINO_OK)("%s con datos suficientes -- hecho/interpretación/acción son 3 strings no vacíos y DISTINTOS entre sí", async (catalogoId) => {
    const cliente = clienteBase();
    configurarConDatos(cliente, catalogoId);
    tenantClientMock.mockReturnValue(cliente);
    const resultado = comoRespuestaConsulta(await ejecutarConsultaPermitida(entradaPara(catalogoId), CONTEXTO));

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error(`se esperaba ok:true para ${catalogoId}`);
    expect(resultado.hecho.length).toBeGreaterThan(0);
    expect(resultado.interpretacion.length).toBeGreaterThan(0);
    expect(resultado.accion.length).toBeGreaterThan(0);
    expect(resultado.interpretacion).not.toBe(resultado.hecho);
    expect(resultado.accion).not.toBe(resultado.hecho);
    expect(resultado.accion).not.toBe(resultado.interpretacion);
  });

  function listarArchivosTs(dir: string): string[] {
    const resultado: string[] = [];
    for (const nombre of readdirSync(dir)) {
      if (nombre === "__tests__") continue;
      const ruta = path.join(dir, nombre);
      if (statSync(ruta).isDirectory()) {
        resultado.push(...listarArchivosTs(ruta));
      } else if (nombre.endsWith(".ts")) {
        resultado.push(ruta);
      }
    }
    return resultado;
  }

  it("ningún archivo de Incremento 5 (domain/engine/infra de consultas) contiene SQL libre ni referencia a un proveedor de IA (I5-07, verificación estática del código fuente)", () => {
    const raiz = path.join(__dirname, "..", "..", "..");
    const directorios = [path.join(raiz, "domain", "queries"), path.join(raiz, "engine", "queries"), path.join(__dirname, "..")];
    const archivos = directorios.flatMap((dir) => listarArchivosTs(dir));
    archivos.push(path.join(raiz, "domain", "limitesConsultas.ts"));

    const patronesProhibidos = [/\$queryRaw/i, /\$executeRaw/i, /openai/i, /anthropic/i, /chatgpt/i, /langchain/i, /\bgpt-\d/i];

    expect(archivos.length).toBeGreaterThan(10);
    for (const archivo of archivos) {
      const contenido = readFileSync(archivo, "utf-8");
      for (const patron of patronesProhibidos) {
        expect(
          !patron.test(contenido),
          `${archivo} contiene un patrón prohibido (${patron}) -- Incremento 5 es determinista por catálogo cerrado, nunca SQL libre ni un proveedor de IA`,
        ).toBe(true);
      }
    }
  });
});
