/**
 * Rotas com divisão do bundle: o ficheiro de entrada leva só a landing e a
 * estrutura pública (sem Better Auth). Autenticação, área privada e demo são
 * chunks separados, carregados por `lazy` na primeira navegação para cada área;
 * a demo nunca carrega o cliente de autenticação nem os hooks da API.
 */
import { createBrowserRouter } from "react-router";
import { LandingPage } from "./pages/landing.tsx";
import { NotFoundPage, PublicLayout, RouteErrorPage, RouteLoading } from "./layouts/shell.tsx";

const publicPages = () => import("./pages/public.tsx");
const appLayout = () => import("./layouts/app.tsx");
const appPages = () => import("./pages/app.tsx");
const demoLayout = () => import("./layouts/demo.tsx");
const demoPages = () => import("./pages/demo.tsx");

export const router = createBrowserRouter([
  {
    path: "/",
    element: <PublicLayout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <RouteLoading />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: "entrar", lazy: async () => ({ Component: (await publicPages()).SignInPage }) },
      { path: "criar-conta", lazy: async () => ({ Component: (await publicPages()).SignUpPage }) },
      { path: "recuperar-acesso", lazy: async () => ({ Component: (await publicPages()).EmailFeatureUnavailablePage }) },
      { path: "redefinir-senha", lazy: async () => ({ Component: (await publicPages()).EmailFeatureUnavailablePage }) },
      { path: "verificar-email", lazy: async () => ({ Component: (await publicPages()).EmailFeatureUnavailablePage }) },
      { path: "confirmar-email", lazy: async () => ({ Component: (await publicPages()).EmailFeatureUnavailablePage }) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: "/app",
    lazy: async () => ({ Component: (await appLayout()).AppLayout }),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <RouteLoading />,
    children: [
      { index: true, lazy: async () => ({ Component: (await appPages()).DashboardPage }) },
      { path: "treinos", lazy: async () => ({ Component: (await appPages()).WorkoutsPage }) },
      { path: "treinos/novo", lazy: async () => ({ Component: (await appPages()).WorkoutNewPage }) },
      { path: "treinos/:id/editar", lazy: async () => ({ Component: (await appPages()).WorkoutEditPage }) },
      { path: "objetivo", lazy: async () => ({ Component: (await appPages()).GoalPage }) },
      { path: "conta", lazy: async () => ({ Component: (await appPages()).AccountPage }) },
    ],
  },
  {
    path: "/demo",
    lazy: async () => ({ Component: (await demoLayout()).DemoLayout }),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <RouteLoading />,
    children: [
      { index: true, lazy: async () => ({ Component: (await demoPages()).DemoDashboardPage }) },
      { path: "treinos", lazy: async () => ({ Component: (await demoPages()).DemoWorkoutsPage }) },
      { path: "objetivo", lazy: async () => ({ Component: (await demoPages()).DemoGoalPage }) },
    ],
  },
]);
