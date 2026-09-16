// Pruebas — injectTenantFilter (Ronda 5, R5-6; movida a tenantScope.ts en el
// mismo cierre de brechas para no depender de Prisma). Puras: no tocan
// Prisma ni la base, solo verifican la forma de los args que arma cada
// operacion.
import { describe, expect, it } from "vitest";
import { injectTenantFilter } from "./tenantScope";

describe("injectTenantFilter", () => {
  it("create -- inyecta el campo de tenant en data", () => {
    const args = injectTenantFilter("Eslabon", "create", { data: { nombre: "Acopio" } }, "emp1");
    expect(args).toEqual({ data: { nombre: "Acopio", empresaId: "emp1" } });
  });

  it("createMany -- inyecta el campo de tenant en cada elemento de data", () => {
    const args = injectTenantFilter(
      "Eslabon",
      "createMany",
      { data: [{ nombre: "Acopio" }, { nombre: "Transporte" }] },
      "emp1",
    );
    expect(args).toEqual({
      data: [
        { nombre: "Acopio", empresaId: "emp1" },
        { nombre: "Transporte", empresaId: "emp1" },
      ],
    });
  });

  it("findMany -- inyecta el campo de tenant en where, preservando el resto del where", () => {
    const args = injectTenantFilter("Eslabon", "findMany", { where: { nombre: "Acopio" } }, "emp1");
    expect(args).toEqual({ where: { nombre: "Acopio", empresaId: "emp1" } });
  });

  it("Empresa -- usa 'id' como campo de tenant, no 'empresaId'", () => {
    const args = injectTenantFilter("Empresa", "findUnique", { where: { id: "otra-cosa" } }, "emp1");
    // El id del where original se pisa: el tenant siempre gana, nunca lo
    // que haya pedido el codigo de aplicacion.
    expect(args).toEqual({ where: { id: "emp1" } });
  });

  it("upsert -- inyecta el campo de tenant en where Y en create (R5-6)", () => {
    const args = injectTenantFilter(
      "Eslabon",
      "upsert",
      {
        where: { id: "esl1" },
        create: { id: "esl1", nombre: "Acopio" },
        update: { nombre: "Acopio renombrado" },
      },
      "emp1",
    );
    expect(args).toEqual({
      where: { id: "esl1", empresaId: "emp1" },
      create: { id: "esl1", nombre: "Acopio", empresaId: "emp1" },
      update: { nombre: "Acopio renombrado" },
    });
  });

  it("upsert -- no inyecta el campo de tenant en update (no se cambia de tenant)", () => {
    const args = injectTenantFilter(
      "Eslabon",
      "upsert",
      { where: { id: "esl1" }, create: { id: "esl1" }, update: { nombre: "Nuevo" } },
      "emp1",
    );
    expect(args.update).toEqual({ nombre: "Nuevo" });
  });

  it("sin args -- no revienta, construye la forma minima", () => {
    const args = injectTenantFilter("Eslabon", "findMany", undefined, "emp1");
    expect(args).toEqual({ where: { empresaId: "emp1" } });
  });
});
