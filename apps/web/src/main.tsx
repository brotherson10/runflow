import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { createQueryClient, resetToSignedOut, SESSION_EXPIRED_KEY, setUnauthorizedHandler } from "./lib/query.ts";
import { router } from "./router.tsx";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

const queryClient = createQueryClient();

// 401 da API: a sessão expirou. Limpa os dados em cache e deixa a rota protegida
// redirecionar para /entrar (uma única vez, sem pedidos protegidos nessa página).
setUnauthorizedHandler(() => {
  resetToSignedOut(queryClient);
  queryClient.setQueryData(SESSION_EXPIRED_KEY, true);
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("Elemento #root não encontrado.");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
