import { describe, expect, it } from "vitest";

import { generarCuid } from "../cuid";

describe("generarCuid", () => {
  it("genera CUID v1 distintos y con formato valido", () => {
    const primero = generarCuid();
    const segundo = generarCuid();

    expect(primero).toMatch(/^c[a-z0-9]{24}$/);
    expect(segundo).toMatch(/^c[a-z0-9]{24}$/);
    expect(segundo).not.toBe(primero);
  });
});
