import { describe, expect, it } from "vitest";
import { normalizarSslPostgres } from "../normalizarSsl";

describe("normalizarSslPostgres", () => {
  it.each(["require", "prefer", "verify-ca"])("convierte %s a verify-full", (modo) => {
    const resultado = normalizarSslPostgres(`postgresql://usuario:secreto@host/base?sslmode=${modo}`);
    expect(new URL(resultado!).searchParams.get("sslmode")).toBe("verify-full");
  });

  it("conserva verify-full", () => {
    const original = "postgresql://usuario:secreto@host/base?sslmode=verify-full";
    expect(normalizarSslPostgres(original)).toBe(original);
  });

  it("no inventa sslmode cuando no existe", () => {
    const resultado = normalizarSslPostgres("postgresql://usuario:secreto@host/base");
    expect(new URL(resultado!).searchParams.has("sslmode")).toBe(false);
  });

  it("deja que el consumidor diagnostique una URL invalida sin exponerla", () => {
    expect(normalizarSslPostgres("no-es-url")).toBe("no-es-url");
  });
});
