import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { requirePlatformAdmin } from "../admin/auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requirePlatformAdmin(request);
  throw redirect("/admin/partners");
};
