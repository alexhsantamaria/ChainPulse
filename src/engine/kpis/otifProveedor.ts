// Motor de KPIs -- OTIF proveedor: "recepciones completas y a tiempo /
// recepciones", mismo criterio que OTIF pero del lado de la recepcion de
// un proveedor. `proveedorAlias`, nunca el nombre real -- mismo criterio
// de anonimizacion de terceros que el resto del proyecto (RF39: "sin
// requerir nombres reales de terceros").
import { calcularRatio } from "./compartido";
import type { ResultadoCalculoKpi } from "./constantes";

export interface FilaOtifProveedor {
  proveedorAlias: string;
  fechaPromesa: Date;
  fechaRecepcion: Date | null;
  cantidadPedida: number;
  cantidadRecibida: number | null;
}

export function calcularOtifProveedor(filas: readonly FilaOtifProveedor[]): ResultadoCalculoKpi {
  return calcularRatio(
    filas,
    (fila) => {
      if (fila.fechaRecepcion === null || fila.cantidadRecibida === null || fila.cantidadPedida <= 0) {
        return null;
      }
      const completa = fila.cantidadRecibida >= fila.cantidadPedida;
      const aTiempo = fila.fechaRecepcion.getTime() <= fila.fechaPromesa.getTime();
      return { numerador: completa && aTiempo ? 1 : 0, denominador: 1 };
    },
    "falta fecha de recepcion o cantidad recibida (recepcion todavia no cerrada)",
  );
}
