import DetalleObservacionKpi from "../../../_compartido/DetalleObservacionKpi";

export default async function DetalleObservacionLeadTimePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalleObservacionKpi codigo="LEAD_TIME" id={id} />;
}
