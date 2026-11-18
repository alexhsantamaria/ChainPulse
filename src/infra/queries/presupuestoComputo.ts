// Infraestructura -- aplica PRESUPUESTO_COMPUTO_MS (I5-14,
// limitesConsultas.ts) al computo SINCRONICO de cada uno de los 6
// motores del catalogo (engine/queries/*.ts). Incremento 5 PR2, a
// pedido explicito de Alex, 2026-11-18.
//
// LIMITE DURO, a proposito: JavaScript sincronico no se puede
// interrumpir ni abortar desde afuera mientras corre -- no hay
// preempcion sin mover el computo a un Worker Thread o a un proceso
// separado, y ninguno de los 6 motores lo hace hoy. Por eso esta
// funcion NUNCA interrumpe `calcular` -- la deja terminar SIEMPRE, mide
// cuanto tardo DESPUES de que terminó, y si excedio el presupuesto,
// DESCARTA ese resultado ya calculado (nunca lo persiste ni lo entrega)
// en lugar de devolverlo. Por el mismo motivo, este mecanismo NO
// protege contra un loop infinito real -- un computo que nunca termina
// nunca llega a medirse ni a descartarse. Es un techo de cordura contra
// un computo que SI termina pero tarda demasiado (ej. un recorrido
// ineficiente si algun motor futuro incorporara un grafo real), nunca
// una garantia de liveness.
//
// Centraliza TODO lo que los 6 ejecutores necesitan (construccion del
// error + logging saneado del evento de exceso) para que cada uno de
// ellos se limite a pasar su catalogoId y su llamada al motor -- evita
// repetir 6 veces casi el mismo bloque de codigo.
import { registrarEventoPresupuestoComputo } from "./eventoPresupuestoComputo";
import type { CatalogoConsultaId } from "@/domain/queries/tipos";

export interface ErrorPresupuestoComputoExcedido {
  ok: false;
  error: "PRESUPUESTO_COMPUTO_EXCEDIDO";
}

function esNumeroFinitoNoNegativo(valor: number): boolean {
  return Number.isFinite(valor) && valor >= 0;
}

/** Deteccion por duck-typing de un valor "thenable" (Promise real o
 * cualquier objeto/funcion con un `.then` invocable) -- deliberadamente
 * NO usa `instanceof Promise` (eso no detecta una Promise de otro
 * realm, ni un thenable custom que no extienda Promise). */
function esPromiseLike(valor: unknown): boolean {
  return (
    (typeof valor === "object" || typeof valor === "function") &&
    valor !== null &&
    typeof (valor as { then?: unknown }).then === "function"
  );
}

/** Valida UNA lectura individual del reloj (nunca solo la resta final)
 * -- atrapa, con un mensaje que dice CUAL de las dos lecturas fallo,
 * un reloj inyectado que devuelve un valor invalido en "antes" o en
 * "despues" por separado, incluso en el caso (posible, aunque raro) en
 * que la resta de dos lecturas invalidas igual resultara en un numero
 * que pasaria la validacion de `duracionMs` por casualidad. */
function validarLecturaDeReloj(valor: number, momento: "antes" | "despues", catalogoId: CatalogoConsultaId): void {
  if (!esNumeroFinitoNoNegativo(valor)) {
    throw new Error(
      `ejecutarConsultaDentroDePresupuesto(): la lectura del reloj "${momento}" es invalida (${valor}) -- el reloj inyectado debe devolver siempre un numero finito >= 0 (catalogoId=${catalogoId})`,
    );
  }
}

/**
 * Ejecuta `calcular` (SINCRONICA -- nunca una funcion que devuelva una
 * Promise; ver nota de cabecera) y mide cuanto tardo con `reloj`
 * (inyectable solo para pruebas deterministas; en produccion siempre
 * performance.now()). Si `calcular` lanza, la excepcion se propaga tal
 * cual -- esta funcion nunca la atrapa, la transforma ni le agrega
 * contexto.
 *
 * Si la duracion medida quedo DENTRO del presupuesto
 * (duracionMs <= presupuestoMs -- la igualdad cuenta como DENTRO,
 * nunca como excedida), devuelve el resultado real de `calcular`, sin
 * tocarlo. Si lo excedio, descarta ese resultado, emite EXACTAMENTE un
 * evento saneado (nunca con cadenaId/empresaId/usuarioId/huella -- ver
 * eventoPresupuestoComputo.ts) y devuelve el error de presupuesto
 * excedido en su lugar.
 */
export function ejecutarConsultaDentroDePresupuesto<T>(
  catalogoId: CatalogoConsultaId,
  presupuestoMs: number,
  calcular: () => T,
  reloj: () => number = () => performance.now(),
): T | ErrorPresupuestoComputoExcedido {
  if (!esNumeroFinitoNoNegativo(presupuestoMs)) {
    throw new Error(
      `ejecutarConsultaDentroDePresupuesto(): presupuestoMs invalido (${presupuestoMs}) -- debe ser un numero finito >= 0 (catalogoId=${catalogoId})`,
    );
  }

  const inicio = reloj();
  validarLecturaDeReloj(inicio, "antes", catalogoId);

  // Nunca se envuelve en try/catch -- una excepcion real del motor debe
  // propagarse exactamente como lo hacia antes de este PR.
  const resultado = calcular();

  // Rechazo explicito de un callback PromiseLike: `calcular` debe ser
  // SINCRONICA (ver nota de cabecera). Si devolviera una Promise (o
  // cualquier thenable), medir "fin - inicio" aca solo mediria el
  // tiempo de CREARLA -- el trabajo real seguiria pendiente despues de
  // este punto, y esta funcion estaria a punto de devolver (o auditar)
  // un valor que todavia no es el resultado real. Se rechaza en
  // runtime, nunca se deja pasar en silencio.
  if (esPromiseLike(resultado)) {
    throw new Error(
      `ejecutarConsultaDentroDePresupuesto(): calcular() devolvio un valor PromiseLike (thenable) -- esta funcion exige una funcion SINCRONICA; medir alrededor de una Promise solo mediria el tiempo de crearla, nunca el del trabajo real que todavia estaria pendiente (catalogoId=${catalogoId})`,
    );
  }

  const fin = reloj();
  validarLecturaDeReloj(fin, "despues", catalogoId);

  const duracionMs = fin - inicio;
  if (!esNumeroFinitoNoNegativo(duracionMs)) {
    throw new Error(
      `ejecutarConsultaDentroDePresupuesto(): duracionMs invalida (${duracionMs}) -- el reloj inyectado debe ser monotonico no decreciente (catalogoId=${catalogoId})`,
    );
  }

  if (duracionMs <= presupuestoMs) {
    return resultado;
  }

  registrarEventoPresupuestoComputo("CONSULTA_PRESUPUESTO_COMPUTO_EXCEDIDO", { catalogoId, duracionMs, presupuestoMs });
  return { ok: false, error: "PRESUPUESTO_COMPUTO_EXCEDIDO" };
}
