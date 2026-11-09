// Pagina -- detalle duradero de una observacion OTIF. Incremento 4 PR1
// (Alex, 2026-11-06). Wrapper minimo: toda la consulta y el render viven
// en el componente compartido (../../../_compartido/DetalleObservacionKpi.tsx)
// para no duplicarlos con el equivalente de Fill Rate.
import DetalleObservacionKpi from "../../../_compartido/DetalleObservacionKpi";

export default async function DetalleObservacionOtifPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalleObservacionKpi codigo="OTIF" id={id} />;
}
