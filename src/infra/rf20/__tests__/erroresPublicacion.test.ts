import { describe, expect, it } from "vitest";
import { esViolacionIndiceParcialPublicacion } from "../erroresPublicacion";

describe("esViolacionIndiceParcialPublicacion", () => {
  it("reconoce únicamente el P2002 del índice parcial por codigo", () => {
    expect(esViolacionIndiceParcialPublicacion({ code: "P2002", meta: { constraint: { fields: ["codigo"] } } })).toBe(true);
    expect(esViolacionIndiceParcialPublicacion({ code: "P2002", meta: { constraint: { fields: ["codigo", "numero"] } } })).toBe(false);
    expect(esViolacionIndiceParcialPublicacion({ code: "P2003", meta: { constraint: { fields: ["codigo"] } } })).toBe(false);
  });
});
