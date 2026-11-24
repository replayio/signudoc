import { isOnNetlify } from "../utils/env.ts";

type IpEnv = Record<string, string | undefined>;

function firstAddress(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

/**
 * The headers that carry the visitor's address, most trustworthy first.
 *
 * On Vercel, x-vercel-forwarded-for and x-real-ip are written by Vercel
 * itself and cannot be set by the visitor, so they come first.
 * https://vercel.com/docs/headers/request-headers
 *
 * On Netlify, x-nf-client-connection-ip is written by Netlify itself and
 * holds one address, where x-forwarded-for lists Netlify's own hop as well.
 * https://docs.netlify.com/platform/primitives/#client-ip-address
 *
 * Anywhere else those names mean nothing special and anyone could send
 * them, so the usual proxy headers are used instead.
 */
export function getClientIpHeaderNames(env: IpEnv = process.env): string[] {
  if (env.VERCEL === "1") {
    return ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"];
  }

  if (isOnNetlify(env)) {
    return ["x-nf-client-connection-ip", "x-forwarded-for", "x-real-ip"];
  }

  return ["x-forwarded-for", "cf-connecting-ip", "x-real-ip"];
}

export function getClientIpAddress(
  headers: Headers,
  env: IpEnv = process.env,
): string | null {
  for (const name of getClientIpHeaderNames(env)) {
    const address = firstAddress(headers.get(name));

    if (address) {
      return address;
    }
  }

  return null;
}

export function getRequestUserAgent(headers: Headers): string | null {
  return headers.get("user-agent")?.trim() ?? null;
}

export function getRequestPathname(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}
