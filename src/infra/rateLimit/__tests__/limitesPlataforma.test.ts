import { describe, expect, it } from "vitest";

import {
  calcularRetryAfterSegundos,
  LIMITE_LOGIN_PLATAFORMA_POR_HUELLA,
  LIMITE_MFA_PLATAFORMA_POR_HUELLA,
  VENTANA_PLATAFORMA_EN_BUCKETS,
} from "../limitesPlataforma";

describe("limitesPlataforma", () => {
  it("mantiene umbrales independientes para login y MFA", () => {
    expect(LIMITE_LOGIN_PLATAFORMA_POR_HUELLA).toBe(10);
    expect(LIMITE_MFA_PLATAFORMA_POR_HUELLA).toBe(5);
    expect(VENTANA_PLATAFORMA_EN_BUCKETS).toBe(1);
  });

  it("calcula Retry-After hasta el final del bucket de 15 minutos", () => {
    expect(calcularRetryAfterSegundos(new Date("2026-10-29T12:00:00.000Z"))).toBe(900);
    expect(calcularRetryAfterSegundos(new Date("2026-10-29T12:14:59.001Z"))).toBe(1);
  });
});
