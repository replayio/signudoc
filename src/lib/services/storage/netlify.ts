import { getStore, type Store } from "@netlify/blobs";

import { type EnvSource } from "../../utils/env.ts";
import {
  normalizeStorageKey,
  type StorageObjectHead,
  StorageObjectNotFoundError,
  type StorageService,
} from "./types.ts";

// Storage in Netlify Blobs, the file store that comes with a Netlify site.
// Nothing in it has a public URL: every read goes through the app, which
// checks who is asking first. On Netlify the store needs no credentials,
// because the runtime hands @netlify/blobs its site and token itself.
// https://docs.netlify.com/build/data-and-storage/netlify-blobs/

const DEFAULT_STORE_NAME = "signudoc-documents";

/** The one thing kept beside each object, so reads can name its type. */
type ObjectMetadata = { contentType?: string };

type CreateNetlifyStorageServiceOptions = {
  env?: EnvSource;
  /** Replaced by a fake in tests. */
  store?: Store;
};

/** True when the app is being built or run by Netlify. */
export function isOnNetlify(env: EnvSource = process.env): boolean {
  return env.NETLIFY === "true";
}

export function createNetlifyStorageService({
  env = process.env,
  store: providedStore,
}: CreateNetlifyStorageServiceOptions = {}): StorageService {
  const storeName = env.NETLIFY_BLOBS_STORE?.trim() || DEFAULT_STORE_NAME;
  let openedStore = providedStore;

  // Opened on first use, not when the service is made: the store needs the
  // site and token Netlify's runtime provides, which the build does not.
  // Strong consistency, so a read straight after a write sees it: the app
  // reads a PDF back as soon as it is stored, to place fields and seal it.
  function store(): Store {
    openedStore ??= getStore({ consistency: "strong", name: storeName });

    return openedStore;
  }

  function metadataOf(metadata: Record<string, unknown>): ObjectMetadata {
    return typeof metadata.contentType === "string"
      ? { contentType: metadata.contentType }
      : {};
  }

  async function headObject(key: string): Promise<StorageObjectHead> {
    const normalizedKey = normalizeStorageKey(key);
    const found = await store().getMetadata(normalizedKey);

    if (found === null) {
      return { bucketName: storeName, exists: false, key: normalizedKey };
    }

    return {
      bucketName: storeName,
      contentType: metadataOf(found.metadata).contentType,
      etag: found.etag,
      exists: true,
      key: normalizedKey,
    };
  }

  return {
    async deleteObject(key) {
      // Deleting something that is not there is not a failure, and the
      // store already treats it that way.
      await store().delete(normalizeStorageKey(key));
    },
    async getObject(key) {
      const normalizedKey = normalizeStorageKey(key);
      const found = await store().getWithMetadata(normalizedKey, {
        type: "arrayBuffer",
      });

      // The types say an arrayBuffer read is never null, but a missing
      // key comes back as null at run time, like every other type.
      if (found === null || found.data === null) {
        throw new StorageObjectNotFoundError(normalizedKey);
      }

      const body = new Uint8Array(found.data);

      return {
        body,
        bucketName: storeName,
        contentLength: body.byteLength,
        contentType: metadataOf(found.metadata).contentType,
        etag: found.etag,
        key: normalizedKey,
      };
    },
    async getObjectStream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const found = await store().getWithMetadata(normalizedKey, {
        type: "stream",
      });

      if (found === null || found.data === null) {
        throw new StorageObjectNotFoundError(normalizedKey);
      }

      return {
        bucketName: storeName,
        contentType: metadataOf(found.metadata).contentType,
        key: normalizedKey,
        stream: found.data as ReadableStream<Uint8Array>,
      };
    },
    headObject,
    async putObject(input) {
      const normalizedKey = normalizeStorageKey(input.key);
      const metadata: ObjectMetadata = { contentType: input.contentType };

      // onlyIfNew makes the store refuse the write when something is
      // already under the key, so of two writers that arrive together
      // exactly one is kept. The refusal is reported, not thrown.
      await store().set(normalizedKey, input.body as unknown as ArrayBuffer, {
        metadata,
        ...(input.keepExisting ? { onlyIfNew: true } : {}),
      });

      return { bucketName: storeName, key: normalizedKey };
    },
  };
}
