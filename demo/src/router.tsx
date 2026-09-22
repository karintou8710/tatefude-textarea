import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { EditorPage } from "./routes/EditorPage";
import { Home } from "./routes/Home";
import { sampleText } from "./sample";
import { SettingsProvider } from "./settings-store";

const rootRoute = createRootRoute({
  component: () => (
    <SettingsProvider>
      <Outlet />
    </SettingsProvider>
  ),
});

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });

const emptyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/empty",
  component: () => <EditorPage initialText="" />,
});

const sampleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sample",
  component: () => <EditorPage initialText={sampleText} />,
});

// GitHub Pages はリポジトリ名の下に置かれ、深い URL を直接タップすると 404 が返る。
// ハッシュで持てば base: "./" のまま、どこに置いても動く
export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, emptyRoute, sampleRoute]),
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
