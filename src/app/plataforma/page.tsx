// Pagina — entrada de /plataforma (PR 8 correccion). Server Component:
// unica decision es "hay sesion de plataforma vigente o no", la misma
// lectura que requireSesionPlataforma() ya hace contra Postgres (via
// leer_estado_sesion_plataforma()) -- no se repite ninguna logica de
// sesion aca, solo se bifurca el redirect segun el resultado.
import { redirect } from "next/navigation";
import { requireSesionPlataforma } from "@/infra/auth/sessionPlataforma";

export default async function EntradaPlataformaPage() {
  let haySesion = false;
  try {
    await requireSesionPlataforma();
    haySesion = true;
  } catch {
    haySesion = false;
  }
  redirect(haySesion ? "/plataforma/rf20/cuestionarios" : "/plataforma/login");
}
