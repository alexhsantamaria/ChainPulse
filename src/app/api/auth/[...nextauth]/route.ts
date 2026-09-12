// Ruta API — expone los endpoints de Auth.js (login, callback, sesion, logout).
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
