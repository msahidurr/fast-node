import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { MOCKUPS_DIR } from "../catalog/mockup.server";

// Serves generated mockup PNGs from data/mockups/ (see mockup.server.ts for
// why these aren't under public/). Filenames are server-generated UUIDs, but
// reject anything that isn't a bare filename to rule out path traversal.
export async function loader({ params }: LoaderFunctionArgs) {
  const filename = params.filename ?? "";
  if (!/^[a-zA-Z0-9-]+\.png$/.test(filename)) {
    throw new Response("Not found", { status: 404 });
  }

  try {
    const data = await readFile(path.join(MOCKUPS_DIR, filename));
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    throw new Response("Not found", { status: 404 });
  }
}
