import type { RouteObject } from "react-router-dom";
import NotFound from "../pages/NotFound";
import ConsolePage from "../pages/console/page";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <ConsolePage />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;
