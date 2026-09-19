// Pagina — paso 1 (Server Component) de la evaluacion expres v2: solo
// resuelve el id dinamico (Next 15, params llega como Promise) y delega
// toda la interactividad al componente cliente. Mismo patron que
// invitacion/aceptar/page.tsx + AceptarInvitacionForm.
import CuestionarioForm from "./CuestionarioForm";

export default async function EvaluacionPreguntasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CuestionarioForm evaluacionId={id} />;
}
