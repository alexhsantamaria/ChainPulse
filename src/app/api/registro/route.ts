// Ruta API — crea la empresa y el administrador de una cuenta nueva (RF1).
import { NextResponse } from "next/server";
import { z } from "zod";
import { registrarEmpresaYAdmin, EmailYaRegistradoError } from "@/infra/auth/registro";

const registroSchema = z.object({
  nombreEmpresa: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registroSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  try {
    await registrarEmpresaYAdmin(parsed.data);
  } catch (err) {
    if (err instanceof EmailYaRegistradoError) {
      return NextResponse.json({ ok: false, error: "EMAIL_YA_REGISTRADO" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
