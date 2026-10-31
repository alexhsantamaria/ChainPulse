import { describe, expect, it, vi } from "vitest";

// El parametro por defecto de cada funcion es `cliente = prisma` (el
// singleton real de src/infra/prisma/client.ts) -- estas pruebas siempre
// pasan un cliente falso explicito, pero el solo hecho de importar
// consultas.ts ya evalua ese modulo. Se mockea aqui (mismo patron que el
// resto del repo, ver route.test.ts de /api/plataforma/mfa/verificar y
// /api/plataforma/login) para no construir el PrismaClient real -- que
// en este entorno de pruebas no esta generado -- solo para descartarlo
// de inmediato.
vi.mock("@/infra/prisma/client", () => ({ prisma: {} }));

import { listarCuestionarios, listarVersionesPorCodigo, obtenerDetalleVersion } from "../consultas";

function clienteFalso(overrides: {
  cuestionarioVersionFindMany?: unknown[];
  cuestionarioVersionFindUnique?: unknown;
  preguntaVersionFindMany?: unknown[];
}) {
  return {
    cuestionarioVersion: {
      findMany: vi.fn().mockResolvedValue(overrides.cuestionarioVersionFindMany ?? []),
      findUnique: vi.fn().mockResolvedValue(overrides.cuestionarioVersionFindUnique ?? null),
    },
    preguntaVersion: {
      findMany: vi.fn().mockResolvedValue(overrides.preguntaVersionFindMany ?? []),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake minimo del facade Prisma solo para estas pruebas
  } as any;
}

describe("listarCuestionarios", () => {
  it("agrupa por codigo, cuenta versiones y detecta la publicada vigente", async () => {
    const cliente = clienteFalso({
      cuestionarioVersionFindMany: [
        { id: "v3", codigo: "c1", numero: 3, estado: "BORRADOR" },
        { id: "v2", codigo: "c1", numero: 2, estado: "PUBLICADA" },
        { id: "v1", codigo: "c1", numero: 1, estado: "RETIRADA" },
        { id: "vA", codigo: "c2", numero: 1, estado: "BORRADOR" },
      ],
    });

    const resultado = await listarCuestionarios(cliente);

    expect(resultado).toEqual([
      {
        codigo: "c1",
        totalVersiones: 3,
        versionPublicada: { id: "v2", codigo: "c1", numero: 2, estado: "PUBLICADA" },
        ultimaVersion: { id: "v3", codigo: "c1", numero: 3, estado: "BORRADOR" },
      },
      {
        codigo: "c2",
        totalVersiones: 1,
        versionPublicada: null,
        ultimaVersion: { id: "vA", codigo: "c2", numero: 1, estado: "BORRADOR" },
      },
    ]);
  });

  it("sin ninguna version devuelve lista vacia", async () => {
    expect(await listarCuestionarios(clienteFalso({}))).toEqual([]);
  });
});

describe("listarVersionesPorCodigo", () => {
  it("aplana _count.preguntas a totalPreguntas", async () => {
    const cliente = clienteFalso({
      cuestionarioVersionFindMany: [
        {
          id: "v1",
          numero: 1,
          estado: "BORRADOR",
          publicadaEn: null,
          retiradaEn: null,
          notasCambio: null,
          curadorId: "u1",
          _count: { preguntas: 5 },
        },
      ],
    });

    const resultado = await listarVersionesPorCodigo("c1", cliente);
    expect(resultado).toEqual([
      {
        id: "v1",
        numero: 1,
        estado: "BORRADOR",
        publicadaEn: null,
        retiradaEn: null,
        notasCambio: null,
        curadorId: "u1",
        totalPreguntas: 5,
      },
    ]);
    expect(cliente.cuestionarioVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { codigo: "c1" } }),
    );
  });
});

describe("obtenerDetalleVersion", () => {
  it("devuelve null sin consultar preguntas cuando la version no existe", async () => {
    const cliente = clienteFalso({ cuestionarioVersionFindUnique: null });
    expect(await obtenerDetalleVersion("noexiste", cliente)).toBeNull();
    expect(cliente.preguntaVersion.findMany).not.toHaveBeenCalled();
  });

  it("devuelve metadata + preguntas en orden cuando existe", async () => {
    const cliente = clienteFalso({
      cuestionarioVersionFindUnique: {
        id: "v1",
        codigo: "c1",
        numero: 1,
        estado: "BORRADOR",
        publicadaEn: null,
        retiradaEn: null,
        notasCambio: null,
        curadorId: "u1",
      },
      preguntaVersionFindMany: [
        { id: "p1", codigo: "Q1", orden: 1, texto: "t", dimension: "ALINEACION", opciones: [], esNoPuntuable: false },
      ],
    });

    const resultado = await obtenerDetalleVersion("v1", cliente);
    expect(resultado?.preguntas).toHaveLength(1);
    expect(cliente.preguntaVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cuestionarioVersionId: "v1" }, orderBy: { orden: "asc" } }),
    );
  });
});
