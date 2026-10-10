import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform, type Readable as NodeReadable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type StoredImportObject = {
  provider: string;
  key: string;
  sizeBytes: number;
  checksum: string;
};

export type ImportByteStream = AsyncIterable<Uint8Array | string>;
export type ImportWriteOptions = { maxBytes?: number };

export interface ImportStorage {
  readonly provider: string;
  put(key: string, content: string, options?: ImportWriteOptions): Promise<StoredImportObject>;
  putStream(key: string, content: ImportByteStream, options?: ImportWriteOptions): Promise<StoredImportObject>;
  readText(key: string): Promise<string>;
  openReadStream(key: string): Promise<NodeReadable>;
  delete(key: string): Promise<void>;
}

function safePath(root: string, key: string): string {
  const normalizedKey = normalize(key).replace(/^([/\\])+/, '');
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, normalizedKey);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${sep}`)) throw new Error('INVALID_STORAGE_KEY');
  return absolute;
}

function checksumText(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

function checkedMaxBytes(value: number | undefined): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_IMPORT_MAX_BYTES');
  return value;
}

function meteredTransform(hash: ReturnType<typeof createHash>, maxBytes: number | null, onSize: (size: number) => void) {
  let sizeBytes = 0;
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      onSize(sizeBytes);
      if (maxBytes != null && sizeBytes > maxBytes) {
        callback(new Error('IMPORT_TOO_LARGE'));
        return;
      }
      hash.update(bytes);
      callback(null, bytes);
    }
  });
}

export class LocalFileImportStorage implements ImportStorage {
  readonly provider = 'local-file';

  constructor(private readonly root = process.env.IMPORT_STORAGE_DIR || join(tmpdir(), 'schadendirekt-imports')) {}

  async put(key: string, content: string, options?: ImportWriteOptions): Promise<StoredImportObject> {
    return this.putStream(key, Readable.from([content]), options);
  }

  async putStream(key: string, content: ImportByteStream, options: ImportWriteOptions = {}): Promise<StoredImportObject> {
    const file = safePath(this.root, key);
    await fs.mkdir(dirname(file), { recursive: true });
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const meter = meteredTransform(hash, checkedMaxBytes(options.maxBytes), (size) => { sizeBytes = size; });
    try {
      await pipeline(Readable.from(content), meter, createWriteStream(file));
      return { provider: this.provider, key, sizeBytes, checksum: hash.digest('hex') };
    } catch (error) {
      await fs.rm(file, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async readText(key: string): Promise<string> {
    return fs.readFile(safePath(this.root, key), 'utf8');
  }

  async openReadStream(key: string): Promise<NodeReadable> {
    return createReadStream(safePath(this.root, key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(safePath(this.root, key), { force: true });
  }
}

export class MemoryImportStorage implements ImportStorage {
  readonly provider = 'memory';
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, content: string, options?: ImportWriteOptions): Promise<StoredImportObject> {
    const bytes = Buffer.from(content, 'utf8');
    const maxBytes = checkedMaxBytes(options?.maxBytes);
    if (maxBytes != null && bytes.byteLength > maxBytes) throw new Error('IMPORT_TOO_LARGE');
    this.objects.set(key, bytes);
    return { provider: this.provider, key, sizeBytes: bytes.byteLength, checksum: checksumText(content) };
  }

  async putStream(key: string, content: ImportByteStream, options: ImportWriteOptions = {}): Promise<StoredImportObject> {
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    const maxBytes = checkedMaxBytes(options.maxBytes);
    let sizeBytes = 0;
    try {
      for await (const chunk of content) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
        sizeBytes += bytes.byteLength;
        if (maxBytes != null && sizeBytes > maxBytes) throw new Error('IMPORT_TOO_LARGE');
        hash.update(bytes);
        chunks.push(bytes);
      }
      this.objects.set(key, Buffer.concat(chunks));
      return { provider: this.provider, key, sizeBytes, checksum: hash.digest('hex') };
    } catch (error) {
      this.objects.delete(key);
      throw error;
    }
  }

  async readText(key: string): Promise<string> {
    const value = this.objects.get(key);
    if (value == null) throw new Error('IMPORT_OBJECT_NOT_FOUND');
    return value.toString('utf8');
  }

  async openReadStream(key: string): Promise<NodeReadable> {
    const value = this.objects.get(key);
    if (value == null) throw new Error('IMPORT_OBJECT_NOT_FOUND');
    return Readable.from([value]);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  fetchImpl?: typeof fetch;
};

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function awsTimestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodedKey(key: string) {
  return key.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

export class S3CompatibleImportStorage implements ImportStorage {
  readonly provider = 's3';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: S3Config) {
    if (!config.endpoint || !config.region || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error('IMPORT_STORAGE_S3_CONFIG_MISSING');
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private objectUrl(key: string) {
    const base = this.config.endpoint.replace(/\/$/, '');
    return new URL(`${base}/${encodeURIComponent(this.config.bucket)}/${encodedKey(key)}`);
  }

  private signedHeaders(method: string, url: URL, payloadHash: string, now = new Date()) {
    const amzDate = awsTimestamp(now);
    const dateStamp = amzDate.slice(0, 8);
    const headerPairs: Array<[string, string]> = [
      ['host', url.host],
      ['x-amz-content-sha256', payloadHash],
      ['x-amz-date', amzDate]
    ];
    if (this.config.sessionToken) headerPairs.push(['x-amz-security-token', this.config.sessionToken]);
    headerPairs.sort(([a], [b]) => a.localeCompare(b));
    const canonicalHeaders = headerPairs.map(([name, value]) => `${name}:${value.trim()}\n`).join('');
    const signedHeaderNames = headerPairs.map(([name]) => name).join(';');
    const canonicalRequest = `${method}\n${url.pathname}\n${url.searchParams.toString()}\n${canonicalHeaders}\n${signedHeaderNames}\n${payloadHash}`;
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;
    const kDate = hmac(`AWS4${this.config.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.config.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const headers: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`
    };
    if (this.config.sessionToken) headers['x-amz-security-token'] = this.config.sessionToken;
    return headers;
  }

  async put(key: string, content: string, options?: ImportWriteOptions): Promise<StoredImportObject> {
    return this.putStream(key, Readable.from([content]), options);
  }

  async putStream(key: string, content: ImportByteStream, options: ImportWriteOptions = {}): Promise<StoredImportObject> {
    const url = this.objectUrl(key);
    const hash = createHash('sha256');
    const maxBytes = checkedMaxBytes(options.maxBytes);
    let sizeBytes = 0;
    const meter = meteredTransform(hash, maxBytes, (size) => { sizeBytes = size; });
    const body = Readable.from(content).pipe(meter);
    try {
      const response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: this.signedHeaders('PUT', url, 'UNSIGNED-PAYLOAD'),
        body,
        duplex: 'half'
      } as RequestInit & { duplex: 'half' });
      if (!response.ok) throw new Error(`IMPORT_STORAGE_S3_PUT_${response.status}`);
      return { provider: this.provider, key, sizeBytes, checksum: hash.digest('hex') };
    } catch (error) {
      await this.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async openReadStream(key: string): Promise<NodeReadable> {
    const url = this.objectUrl(key);
    const emptyHash = sha256Hex('');
    const response = await this.fetchImpl(url, { method: 'GET', headers: this.signedHeaders('GET', url, emptyHash) });
    if (response.status === 404) throw new Error('IMPORT_OBJECT_NOT_FOUND');
    if (!response.ok || !response.body) throw new Error(`IMPORT_STORAGE_S3_GET_${response.status}`);
    const reader = response.body.getReader();
    return Readable.from((async function* () {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    })());
  }

  async readText(key: string): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.openReadStream(key)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key);
    const emptyHash = sha256Hex('');
    const response = await this.fetchImpl(url, { method: 'DELETE', headers: this.signedHeaders('DELETE', url, emptyHash) });
    if (!response.ok && response.status !== 404) throw new Error(`IMPORT_STORAGE_S3_DELETE_${response.status}`);
  }
}

export function getImportMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.IMPORT_MAX_BYTES?.trim();
  if (!raw) return 5 * 1024 * 1024 * 1024;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_IMPORT_MAX_BYTES');
  return value;
}

export function createImportStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ImportStorage {
  const production = env.NODE_ENV === 'production';
  const driver = env.IMPORT_STORAGE_DRIVER?.trim().toLowerCase() || (production ? '' : 'local');
  if (driver === 'local') {
    if (production) throw new Error('IMPORT_STORAGE_SHARED_BACKEND_REQUIRED');
    return new LocalFileImportStorage(env.IMPORT_STORAGE_DIR || undefined);
  }
  if (driver === 's3') {
    const endpoint = env.IMPORT_STORAGE_S3_ENDPOINT?.trim();
    const region = env.IMPORT_STORAGE_S3_REGION?.trim();
    const bucket = env.IMPORT_STORAGE_S3_BUCKET?.trim();
    const accessKeyId = env.IMPORT_STORAGE_S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.IMPORT_STORAGE_S3_SECRET_ACCESS_KEY?.trim();
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) throw new Error('IMPORT_STORAGE_S3_CONFIG_MISSING');
    return new S3CompatibleImportStorage({
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      sessionToken: env.IMPORT_STORAGE_S3_SESSION_TOKEN?.trim() || undefined
    });
  }
  if (production) throw new Error('IMPORT_STORAGE_SHARED_BACKEND_REQUIRED');
  throw new Error('IMPORT_STORAGE_DRIVER_UNSUPPORTED');
}

export function getImportStorageHealth(env: NodeJS.ProcessEnv = process.env) {
  try {
    const storage = createImportStorageFromEnv(env);
    return { ok: true, provider: storage.provider, reason: null as string | null };
  } catch (error) {
    return { ok: false, provider: 'unavailable', reason: error instanceof Error ? error.message : 'IMPORT_STORAGE_UNAVAILABLE' };
  }
}

let activeStorage: ImportStorage | null = null;

export function setImportStorageForTests(storage: ImportStorage | null): void {
  activeStorage = storage;
}

export function getImportStorage(): ImportStorage {
  if (!activeStorage) activeStorage = createImportStorageFromEnv();
  return activeStorage;
}
