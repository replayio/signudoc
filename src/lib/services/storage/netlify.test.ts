import assert from "node:assert/strict";
import { test } from "node:test";

import { type Store } from "@netlify/blobs";

import { createStorageService } from "../storage.ts";
import { resolveStorageDriver, supportsDirectUploads } from "./driver.ts";
import { createNetlifyStorageService } from "./netlify.ts";
import { StorageObjectNotFoundError } from "./types.ts";

type StoredObject = {
  body: Uint8Array;
  etag: string;
  metadata: Record<string, unknown>;
};

// An in-memory stand-in for a Netlify Blobs store, with the parts of its
// interface the driver uses.
function createFakeStore() {
  const objects = new Map<string, StoredObject>();
  let writes = 0;

  const store = {
    async delete(key: string) {
      objects.delete(key);
    },
    async getMetadata(key: string) {
      const stored = objects.get(key);

      return stored ? { etag: stored.etag, metadata: stored.metadata } : null;
    },
    async getWithMetadata(key: string, options: { type: string }) {
      const stored = objects.get(key);

      if (!stored) {
        return null;
      }

      const data =
        options.type === "stream"
          ? new Blob([stored.body as BlobPart]).stream()
          : stored.body.buffer.slice(
              stored.body.byteOffset,
              stored.body.byteOffset + stored.body.byteLength,
            );

      return { data, etag: stored.etag, metadata: stored.metadata };
    },
    async set(
      key: string,
      data: ArrayBuffer | Uint8Array,
      options: { metadata?: Record<string, unknown>; onlyIfNew?: boolean },
    ) {
      if (options.onlyIfNew && objects.has(key)) {
        return { modified: false };
      }

      writes += 1;
      const etag = `"etag-${writes}"`;

      objects.set(key, {
        body: new Uint8Array(data as ArrayBuffer),
        etag,
        metadata: options.metadata ?? {},
      });

      return { etag, modified: true };
    },
  };

  return { objects, store: store as unknown as Store };
}

test("Netlify Blobs driver stores, reads, streams and deletes objects", async () => {
  const { objects, store } = createFakeStore();
  const storage = createNetlifyStorageService({ env: {}, store });
  const body = new TextEncoder().encode("%PDF-1.7 fake");

  const ref = await storage.putObject({
    body,
    contentType: "application/pdf",
    key: "/envelopes/one/source.pdf",
  });

  assert.deepEqual(ref, {
    bucketName: "signudoc-documents",
    key: "envelopes/one/source.pdf",
  });
  assert.equal(
    objects.get("envelopes/one/source.pdf")?.metadata.contentType,
    "application/pdf",
  );

  const head = await storage.headObject("envelopes/one/source.pdf");

  assert.equal(head.exists, true);
  assert.equal(head.contentType, "application/pdf");
  assert.equal(head.etag, '"etag-1"');

  const object = await storage.getObject("envelopes/one/source.pdf");

  assert.deepEqual(object.body, body);
  assert.equal(object.contentLength, body.byteLength);
  assert.equal(object.contentType, "application/pdf");

  const streamed = await storage.getObjectStream("envelopes/one/source.pdf");
  const streamedBody = new Uint8Array(
    await new Response(streamed.stream).arrayBuffer(),
  );

  assert.deepEqual(streamedBody, body);
  assert.equal(streamed.contentType, "application/pdf");

  await storage.deleteObject("envelopes/one/source.pdf");
  await storage.deleteObject("envelopes/one/source.pdf");

  assert.equal(
    (await storage.headObject("envelopes/one/source.pdf")).exists,
    false,
  );
  await assert.rejects(
    storage.getObject("envelopes/one/source.pdf"),
    StorageObjectNotFoundError,
  );
  await assert.rejects(
    storage.getObjectStream("envelopes/one/source.pdf"),
    StorageObjectNotFoundError,
  );
});

test("Netlify Blobs driver keeps the first object when asked to", async () => {
  const { store } = createFakeStore();
  const storage = createNetlifyStorageService({ env: {}, store });
  const first = new TextEncoder().encode("first");
  const second = new TextEncoder().encode("second");

  await storage.putObject({ body: first, contentType: "text/plain", key: "k" });
  await storage.putObject({
    body: second,
    contentType: "text/plain",
    keepExisting: true,
    key: "k",
  });

  assert.deepEqual((await storage.getObject("k")).body, first);

  await storage.putObject({
    body: second,
    contentType: "text/plain",
    key: "k",
  });

  assert.deepEqual((await storage.getObject("k")).body, second);
});

test("Netlify Blobs driver takes its store name from the environment", async () => {
  const { store } = createFakeStore();
  const storage = createNetlifyStorageService({
    env: { NETLIFY_BLOBS_STORE: " documents " },
    store,
  });

  const ref = await storage.putObject({
    body: new Uint8Array(),
    contentType: "text/plain",
    key: "k",
  });

  assert.equal(ref.bucketName, "documents");
});

test("Netlify Blobs is chosen on Netlify unless something else is asked for", () => {
  assert.equal(resolveStorageDriver({ NETLIFY: "true" }), "netlify");
  assert.equal(resolveStorageDriver({ STORAGE_DRIVER: "netlify" }), "netlify");
  // PDFs go through the app, as with local storage.
  assert.equal(supportsDirectUploads({ NETLIFY: "true" }), false);
  // A connected Vercel Blob store, or Vercel itself, still wins.
  assert.equal(
    resolveStorageDriver({ BLOB_READ_WRITE_TOKEN: "t", NETLIFY: "true" }),
    "blob",
  );
  assert.equal(
    resolveStorageDriver({ NETLIFY: "true", STORAGE_DRIVER: "local" }),
    "local",
  );
  assert.equal(resolveStorageDriver({}), "local");
  // Selecting it needs no settings beyond the driver name.
  assert.ok(createStorageService({ env: { STORAGE_DRIVER: "netlify" } }));
});
