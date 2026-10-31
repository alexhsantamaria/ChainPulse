// Pagina — login de plataforma (RF19, PR 8 correccion). Server Component
// minimo: si ya hay sesion vigente evita mostrar el formulario de nuevo
// (misma cortesia que las paginas RF20, nunca al reves -- este guard
// nunca bloquea el acceso, solo salta un paso redundante).
import { redirect } from "next/navigation";
import { requireSesionPlataforma } from "@/infra/auth/sessionPlataforma";
import LoginForm from "./LoginForm";

export default async function LoginPlataformaPage() {
  let haySesion = false;
  try {
    await requireSesionPlataforma();
    haySesion = true;
  } catch {
    haySesion = false;
  }
  if (haySesion) redirect("/plataforma/rf20/cuestionarios");

  return <LoginForm />;
}
