// Pagina — paso 1 (Server Component) del resultado: resuelve el id
// dinamico y delega al componente cliente. Mismo patron que
// evaluacion/[id]/page.tsx.
import ResultadoForm from "./ResultadoForm";

export default async function EvaluacionResultadoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ResultadoForm evaluacionId={id} />;
}
