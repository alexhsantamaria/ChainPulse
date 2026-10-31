import { describe, expect, it, vi } from "vitest";
import { publicarCuestionarioVersion, reordenarPreguntasVersion } from "../gobernanzaVersiones";

describe("wrappers de gobernanza RF20", () => {
  it("devuelve el resultado de reordenamiento sin reinterpretarlo", async () => {
    const cliente = { $queryRaw: vi.fn().mockResolvedValue([{ reordenado: false, motivo: "CONJUNTO_DE_PREGUNTAS_NO_COINCIDE" }]) };
    await expect(reordenarPreguntasVersion("v1", [{ id: "p1", orden: 1 }], cliente as never))
      .resolves.toEqual({ reordenado: false, motivo: "CONJUNTO_DE_PREGUNTAS_NO_COINCIDE" });
  });

  it("traduce solo la colisión concurrente del índice parcial", async () => {
    const cliente = { $queryRaw: vi.fn().mockRejectedValue({ code: "P2002", meta: { constraint: { fields: ["codigo"] } } }) };
    await expect(publicarCuestionarioVersion({ versionId: "v1", actorId: "u1", versionVigenteEsperadaId: null }, cliente as never))
      .resolves.toEqual({ publicada: false, motivo: "VERSION_PUBLICADA_CONCURRENTE" });
  });

  it("propaga otras restricciones únicas", async () => {
    const error = { code: "P2002", meta: { constraint: { fields: ["codigo", "numero"] } } };
    const cliente = { $queryRaw: vi.fn().mockRejectedValue(error) };
    await expect(publicarCuestionarioVersion({ versionId: "v1", actorId: "u1", versionVigenteEsperadaId: null }, cliente as never))
      .rejects.toBe(error);
  });
});
