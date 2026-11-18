// @vitest-environment jsdom
//
// Pruebas de RENDER REAL (Incremento 5 PR1, ronda 2 de revision --
// correccion obligatoria de Alex, 2026-11-18: "no afirmar que el boton
// Reintentar esta probado si solo se prueba la funcion pura que decide
// si debe mostrarse"). Primera prueba de render+interaccion de un
// componente cliente en este repositorio -- @testing-library/react,
// @testing-library/user-event y jsdom se agregaron como devDependencies
// UNICAMENTE para esto, con autorizacion explicita de Alex.
//
// Alcance de la configuracion nueva (minimo, nada global de mas):
//   1. vitest.config.ts: se agrego "src/**/*.test.tsx" al arreglo
//      `include` -- sin esto, Vitest ni siquiera recolecta este
//      archivo (el resto de la suite sigue siendo *.test.ts). Es el
//      UNICO cambio de alcance global.
//   2. El pragma "@vitest-environment jsdom" en la primera linea de
//      ESTE archivo cambia el entorno SOLO para este archivo -- el
//      resto de la suite (incluido el resto de dashboard/consultas/)
//      sigue corriendo en "node" (vitest.config.ts, sin tocar).
//
// No se agrego @testing-library/jest-dom (no estaba en la lista
// autorizada) -- las aserciones de presencia/disabled usan DOM/Vitest
// puro (queryBy*/getBy* + .disabled), nunca matchers de jest-dom.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CatalogoConsultaId, MetadatosCatalogoConsulta } from "@/domain/queries/tipos";
import ConsultasPanel from "../ConsultasPanel";

const fetchJsonSeguroMock = vi.fn();
vi.mock("@/infra/http/fetchJsonSeguro", () => ({
  fetchJsonSeguro: (...args: unknown[]) => fetchJsonSeguroMock(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CADENAS = [{ id: "cadena-1", nombre: "Cadena Uno" }];
const CATALOGO: MetadatosCatalogoConsulta[] = [
  {
    id: "OTIF_CAIDA" as CatalogoConsultaId,
    titulo: "¿Por qué cayó mi OTIF?",
    descripcion: "pregunta de prueba",
    dependenciasDatos: [],
    requierePeriodo: true,
    permisos: ["ADMINISTRADOR", "RESPONSABLE"],
    comportamientoSinDatos: "x",
    ruleVersion: "v1",
  },
];

const RESPUESTA_OK = {
  ok: true,
  catalogoId: "OTIF_CAIDA",
  respuestaDirecta: "El OTIF se mantuvo.",
  periodo: { inicio: "2026-09-01", fin: "2026-09-30" },
  filtros: {},
  fuente: "ObservacionKpi",
  formula: "numerador/denominador",
  numerador: 90,
  denominador: 100,
  calidad: { faltantes: [], cobertura: 1 },
  hecho: "El OTIF del periodo fue 90%.",
  interpretacion: "Se mantuvo respecto al periodo anterior.",
  accion: "Ninguna accion urgente.",
  comoComprobar: "Revisa ObservacionKpi del periodo.",
  ruleVersion: "consultas-v1",
};

/** Promesa controlable a mano -- para poder afirmar el estado de carga
 * ANTES de resolver la segunda llamada (Reintentar), nunca dejando que
 * el mock resuelva solo. */
function deferida<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

async function renderYcompletarFormulario() {
  render(<ConsultasPanel cadenas={CADENAS} catalogo={CATALOGO} />);
  const usuario = userEvent.setup();

  await usuario.click(screen.getByRole("radio", { name: /¿Por qué cayó mi OTIF\?/ }));
  // input[type=date] -- fireEvent.change en vez de userEvent.type: es
  // el patron recomendado para date inputs nativos en jsdom (tipear
  // caracter por caracter con userEvent.type no se comporta igual que
  // en un navegador real para este tipo de input).
  fireEvent.change(screen.getByLabelText(/Período -- inicio/), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText(/Período -- fin/), { target: { value: "2026-09-30" } });

  return usuario;
}

function payloadDeLaLlamada(indice: number): unknown {
  const init = fetchJsonSeguroMock.mock.calls[indice]?.[1] as RequestInit | undefined;
  if (!init?.body) throw new Error(`La llamada ${indice} no tiene body -- revisar el mock`);
  return JSON.parse(init.body as string);
}

describe("ConsultasPanel -- botón Reintentar (render real, jsdom)", () => {
  it(
    "429 LIMITE_TASA_EXCEDIDO -> muestra mensaje + botón Reintentar; conserva pregunta/cadena/período; " +
      "Reintentar repite el MISMO payload, muestra 'Consultando…' deshabilitado mientras está pendiente " +
      "(sin una tercera llamada), y en éxito muestra el resultado",
    async () => {
      fetchJsonSeguroMock.mockResolvedValueOnce({ ok: false, error: "LIMITE_TASA_EXCEDIDO", retryAfterSegundos: 30 });

      const usuario = await renderYcompletarFormulario();
      await usuario.click(screen.getByRole("button", { name: "Consultar" }));

      await waitFor(() => expect(screen.getByText(/demasiadas consultas/i)).toBeTruthy());
      const botonReintentar = screen.getByRole("button", { name: "Reintentar" });
      expect(botonReintentar).toBeTruthy();

      // Conserva seleccion -- pregunta, cadena y periodo siguen con los
      // valores que puso el usuario, pese al error (nunca se resetean).
      expect((screen.getByRole("radio", { name: /¿Por qué cayó mi OTIF\?/ }) as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText(/Cadena/) as HTMLSelectElement).value).toBe("cadena-1");
      expect((screen.getByLabelText(/Período -- inicio/) as HTMLInputElement).value).toBe("2026-09-01");
      expect((screen.getByLabelText(/Período -- fin/) as HTMLInputElement).value).toBe("2026-09-30");

      // Segunda llamada (Reintentar) -- la dejamos pendiente a proposito
      // para poder afirmar el estado de carga ANTES de resolverla.
      const { promesa: segundaRespuesta, resolver } = deferida<typeof RESPUESTA_OK>();
      fetchJsonSeguroMock.mockImplementationOnce(() => segundaRespuesta);

      await usuario.click(botonReintentar);

      // Estado de carga visible mientras la segunda llamada sigue
      // pendiente -- el boton de submit queda deshabilitado y el boton
      // "Reintentar" ya no esta en el DOM (el estado dejo de ser
      // "error" apenas se hizo click, de forma sincronica).
      await waitFor(() => {
        const botonConsultando = screen.getByRole("button", { name: "Consultando…" }) as HTMLButtonElement;
        expect(botonConsultando.disabled).toBe(true);
      });
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
      expect(fetchJsonSeguroMock).toHaveBeenCalledTimes(2); // nunca una tercera llamada mientras la 2da esta pendiente

      // Payload EXACTO identico entre la primera llamada y el reintento.
      expect(payloadDeLaLlamada(1)).toEqual(payloadDeLaLlamada(0));
      expect(payloadDeLaLlamada(0)).toEqual({
        catalogoId: "OTIF_CAIDA",
        cadenaId: "cadena-1",
        periodoInicio: "2026-09-01",
        periodoFin: "2026-09-30",
      });

      resolver(RESPUESTA_OK);

      await waitFor(() => expect(screen.getByText("El OTIF se mantuvo.")).toBeTruthy());
      expect(fetchJsonSeguroMock).toHaveBeenCalledTimes(2); // sigue sin haber una tercera llamada
    },
  );

  it(
    "503 SERVICIO_NO_DISPONIBLE -> mismo camino esencial: mensaje + botón Reintentar, conserva selección, " +
      "Reintentar repite el MISMO payload y en éxito limpia el error",
    async () => {
      fetchJsonSeguroMock.mockResolvedValueOnce({ ok: false, error: "SERVICIO_NO_DISPONIBLE" });

      const usuario = await renderYcompletarFormulario();
      await usuario.click(screen.getByRole("button", { name: "Consultar" }));

      await waitFor(() => expect(screen.getByText(/no está disponible/i)).toBeTruthy());
      expect((screen.getByLabelText(/Período -- inicio/) as HTMLInputElement).value).toBe("2026-09-01");
      const botonReintentar = screen.getByRole("button", { name: "Reintentar" });

      fetchJsonSeguroMock.mockResolvedValueOnce(RESPUESTA_OK);
      await usuario.click(botonReintentar);

      await waitFor(() => expect(screen.getByText("El OTIF se mantuvo.")).toBeTruthy());
      expect(fetchJsonSeguroMock).toHaveBeenCalledTimes(2);
      expect(payloadDeLaLlamada(1)).toEqual(payloadDeLaLlamada(0));
      // Error limpio tras el exito -- no deberia quedar ningun mensaje
      // de error ni boton Reintentar en pantalla.
      expect(screen.queryByText(/no está disponible/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    },
  );

  it("códigos que NO son de rate-limit (ej. PERIODO_INVALIDO) -- nunca muestran el botón Reintentar", async () => {
    fetchJsonSeguroMock.mockResolvedValueOnce({ ok: false, error: "PERIODO_INVALIDO" });
    const usuario = await renderYcompletarFormulario();
    await usuario.click(screen.getByRole("button", { name: "Consultar" }));

    await waitFor(() => expect(screen.getByText(/período no es válido/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it(
    "ronda de revision de Alex, 2026-11-17 -- secuencia 429 -> cambio de selección (período) -> " +
      "PERIODO_REQUERIDO: el codigoError del 429 anterior NO debe sobrevivir al cambio de campo, " +
      "asi que el error de validación local NUNCA muestra 'Reintentar'",
    async () => {
      fetchJsonSeguroMock.mockResolvedValueOnce({ ok: false, error: "LIMITE_TASA_EXCEDIDO", retryAfterSegundos: 30 });

      const usuario = await renderYcompletarFormulario();
      await usuario.click(screen.getByRole("button", { name: "Consultar" }));

      // 429 -- mensaje + botón Reintentar, como en la primera prueba de este archivo.
      await waitFor(() => expect(screen.getByText(/demasiadas consultas/i)).toBeTruthy());
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();

      // Cambio de selección -- se vacía el período (uno de los 3 campos:
      // pregunta/cadena/período) SIN volver a enviar el formulario. Por
      // si solo, este cambio ya debe limpiar el error y el codigoError
      // del 429 anterior (limpiarErrorDeIntentoAnterior() en
      // ConsultasPanel.tsx) -- el mensaje y el botón Reintentar
      // desaparecen de inmediato, antes de cualquier nuevo submit.
      fireEvent.change(screen.getByLabelText(/Período -- fin/), { target: { value: "" } });
      expect(screen.queryByText(/demasiadas consultas/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();

      // Nuevo submit con el período incompleto -- cae en la validación
      // LOCAL (PERIODO_REQUERIDO), que nunca llega a llamar a
      // fetchJsonSeguro(). Se dispara con fireEvent.submit() sobre el
      // <form> en vez de usuario.click() en el botón: un input
      // type="date" required="" vacío hace que jsdom (igual que un
      // navegador real) bloquee el submit NATIVO antes de que React
      // llegue a correr handleSubmit, lo cual impediría ejercitar la
      // rama propia de ConsultasPanel.tsx que es justamente lo que esta
      // prueba verifica. fireEvent.submit() dispara el evento "submit"
      // directamente, sin pasar por la validacion de restricciones del
      // navegador -- el mismo camino que seguiria, por ejemplo, un
      // "Reintentar" que invoca ejecutarConsulta() de forma directa. Si
      // codigoError hubiera quedado pegado en "LIMITE_TASA_EXCEDIDO"
      // (el bug que esto corrige), debeMostrarReintentar() habria
      // mostrado "Reintentar" aca, incorrectamente, para un error que
      // ni siquiera llego a la ruta.
      const formulario = screen.getByRole("button", { name: "Consultar" }).closest("form");
      if (!formulario) throw new Error("no se encontro el <form> -- revisar el markup de ConsultasPanel");
      fireEvent.submit(formulario);
      await waitFor(() => expect(screen.getByText(/necesita un período/i)).toBeTruthy());
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();

      // Confirmación adicional: la validación local nunca golpeó la red
      // -- sigue habiendo una sola llamada (la del 429 inicial).
      expect(fetchJsonSeguroMock).toHaveBeenCalledTimes(1);
    },
  );
});
