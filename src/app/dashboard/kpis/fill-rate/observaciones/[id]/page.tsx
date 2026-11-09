// Pagina -- detalle duradero de una observacion Fill Rate. Incremento 4
// PR1 (Alex, 2026-11-06). Wrapper minimo: toda la consulta y el render
// viven en el componente compartido (../../../_compartido/DetalleObservacionKpi.tsx)
// para no duplicarlos con el equivalente de OTIF.
import DetalleObservacionKpi from "../../../_compartido/DetalleObservacionKpi";

export default async function DetalleObservacionFillRatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalleObservacionKpi codigo="FILL_RATE" id={id} />;
}
