import { NextResponse } from "next/server";

import { requireVerifiedSenderSession } from "@/lib/auth/route-session";
import { getDb } from "@/lib/db/connection";
import {
  EnvelopeDocumentAccessError,
  getDraftEnvelopeDocumentForUser,
} from "@/lib/envelopes";
import { logRouteError } from "@/lib/security/logging";
import { getClientIpAddress, getRequestPathname } from "@/lib/security/request";
import { buildContentDisposition } from "@/lib/services/storage";

type EnvelopeDocumentRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: Request,
  context: EnvelopeDocumentRouteContext,
) {
  const sessionResult = await requireVerifiedSenderSession(request);

  if (sessionResult instanceof Response) {
    return sessionResult;
  }

  const session = sessionResult;
  const { id } = await context.params;
  // The prepare page reads it inline; the detail page's "Download document"
  // asks for a file.
  const asAttachment =
    new URL(request.url).searchParams.get("download") === "1";

  try {
    const document = await getDraftEnvelopeDocumentForUser(
      session.user.id,
      id,
      {
        database: getDb(),
      },
    );
    const responseBody = document.body.slice().buffer as ArrayBuffer;

    return new Response(responseBody, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": buildContentDisposition(
          document.fileName,
          asAttachment ? "attachment" : "inline",
        ),
        "content-length": String(document.contentLength),
        "content-type": document.contentType,
      },
      status: 200,
    });
  } catch (error) {
    if (error instanceof EnvelopeDocumentAccessError) {
      return NextResponse.json(
        { error: error.message },
        {
          headers: {
            "cache-control": "private, no-store",
          },
          status: error.statusCode,
        },
      );
    }

    logRouteError(error, {
      category: "draft_envelope_document_failure",
      ipAddress: getClientIpAddress(request.headers),
      message: "Unexpected failure while loading a draft envelope document.",
      path: getRequestPathname(request),
      userId: session.user.id,
    });

    return NextResponse.json(
      { error: "Unable to load this draft document." },
      {
        headers: {
          "cache-control": "private, no-store",
        },
        status: 500,
      },
    );
  }
}
