import { beforeAll, describe, expect, it } from "vitest";

// NEXTAUTH_SECRET tiene que existir ANTES de importar el modulo (se lee
// una sola vez por llamada, pero conviene fijarlo desde el inicio del
// archivo para no depender del orden de los tests).
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "secreto-de-pruebas-no-es-real";
});

describe("crearTokenInvitacion / verificarTokenInvitacion", () => {
  it("un token recien creado se verifica y devuelve los mismos datos", async () => {
    const { crearTokenInvitacion, verificarTokenInvitacion } = await import("../invitacion");
    const token = await crearTokenInvitacion({
      empresaId: "empresa-1",
      eslabonId: "eslabon-1",
      email: "responsable@example.com",
    });

    const payload = await verificarTokenInvitacion(token);

    expect(payload).toEqual({
      empresaId: "empresa-1",
      eslabonId: "eslabon-1",
      email: "responsable@example.com",
    });
  });

  it("un token con la firma alterada no se verifica", async () => {
    const { crearTokenInvitacion, verificarTokenInvitacion } = await import("../invitacion");
    const token = await crearTokenInvitacion({
      empresaId: "empresa-1",
      eslabonId: "eslabon-1",
      email: "responsable@example.com",
    });
    const tokenAlterado = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

    expect(await verificarTokenInvitacion(tokenAlterado)).toBeNull();
  });

  it("una cadena que no es un JWT no se verifica", async () => {
    const { verificarTokenInvitacion } = await import("../invitacion");
    expect(await verificarTokenInvitacion("no-es-un-token")).toBeNull();
  });

  it("un token firmado con otro secreto no se verifica", async () => {
    const { crearTokenInvitacion } = await import("../invitacion");
    const token = await crearTokenInvitacion({
      empresaId: "empresa-1",
      eslabonId: "eslabon-1",
      email: "responsable@example.com",
    });

    process.env.NEXTAUTH_SECRET = "otro-secreto-distinto";
    const { verificarTokenInvitacion } = await import("../invitacion");
    expect(await verificarTokenInvitacion(token)).toBeNull();
    process.env.NEXTAUTH_SECRET = "secreto-de-pruebas-no-es-real";
  });
});
