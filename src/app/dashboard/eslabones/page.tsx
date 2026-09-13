// Pagina — lista y declara los eslabones de la cadena (RF2).
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import NuevoEslabonForm from "./NuevoEslabonForm";

export default async function EslabonesPage() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const eslabones = await tenantClient(session.user.empresaId).eslabon.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 underline">
          ← Volver al panel
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Eslabones de la cadena</h1>
        <p className="text-sm text-slate-600">
          Cada área, proceso o proveedor externo que forma parte de tu cadena de suministro.
        </p>
      </div>

      {eslabones.length > 0 ? (
        <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003) */}
          {eslabones.map((eslabon: any) => (
            <li key={eslabon.id} className="flex items-center justify-between px-4 py-3">
              <span>{eslabon.nombre}</span>
              {eslabon.esProveedorExterno && (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  proveedor externo
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Todavía no hay eslabones declarados.</p>
      )}

      <NuevoEslabonForm />
    </main>
  );
}
