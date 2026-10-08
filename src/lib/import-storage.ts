import { createHash } from 'node:crypto';
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

export interface ImportStorage {
  readonly provider: string;
  put(key: string, content: string): Promise<StoredImportObject>;
  putStream(key: string, content: ImportByteStream): Promise<StoredImportObject>;
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

export class LocalFileImportStorage implements ImportStorage {
  readonly provider = 'local-file';

  constructor(private readonly root = process.env.IMPORT_STORAGE_DIR || join(tmpdir(), 'schadendirekt-imports')) {}

  async put(key: string, content: string): Promise<StoredImportObject> {
    return this.putStream(key, Readable.from([content]));
  }

  async putStream(key: string, content: ImportByteStream): Promise<StoredImportObject> {
    const file = safePath(this.root, key);
    await fs.mkdir(dirname(file), { recursive: true });
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(bytes);
        sizeBytes += bytes.byteLength;
        callback(null, bytes);
      }
    });
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

  async put(key: string, content: string): Promise<StoredImportObject> {
    const bytes = Buffer.from(content, 'utf8');
    this.objects.set(key, bytes);
    return { provider: this.provider, key, sizeBytes: bytes.byteLength, checksum: checksumText(content) };
  }

  async putStream(key: string, content: ImportByteStream): Promise<StoredImportObject> {
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    let sizeBytes = 0;
    for await (const chunk of content) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      hash.update(bytes);
      sizeBytes += bytes.byteLength;
      chunks.push(bytes);
    }
    this.objects.set(key, Buffer.concat(chunks));
    return { provider: this.provider, key, sizeBytes, checksum: hash.digest('hex') };
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

let activeStorage: ImportStorage | null = null;

export function setImportStorageForTests(storage: ImportStorage | null): void {
  activeStorage = storage;
}

export function getImportStorage(): ImportStorage {
  if (activeStorage) return activeStorage;
  // Local filesystem is only the built-in development/CI driver. Production can replace
  // this behind the same stream interface with S3/R2/MinIO without changing import-job semantics.
  activeStorage = new LocalFileImportStorage();
  return activeStorage;
}
