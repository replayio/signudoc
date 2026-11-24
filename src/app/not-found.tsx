import { connection } from "next/server";

import { NotFoundShell } from "@/components/not-found/not-found-shell";

// Rendered on demand rather than at build time, so the scripts on the page
// carry the nonce the Content-Security-Policy of that response asks for.
export default async function NotFound() {
  await connection();

  return <NotFoundShell initialState="default" />;
}
