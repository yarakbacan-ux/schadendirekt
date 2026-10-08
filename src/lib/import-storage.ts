import { createReadStream, promises as fs } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { Readable } from 'node:stream';

export type StoredImportObject = {
  provider: string;
  key: string;
  sizeBytes: number;
};

export interface ImportStorage {
  readonly provider: string;
  put(key: string, content: string): Promise<StoredImportObject>;
  readText(key: string): Promise<string>;
  openReadStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

function safePath(root: string, key: string): string {
  const normalizedKey = normalize(key).replace(/^([/\\])+/, '');
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, normalizedKey);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error('INVALID_STORAGE_KEY');
  }
  return absolute;
}

export class LocalFileImportStorage implements ImportStorage {
  readonly provider = 'local-file';

  constructor(private readonly root = process.env.IMPORT_STORAGE_DIR || join(tmpdir(), 'schadendirekt-imports')) {}

  async put(key: string, content: string): Promise<StoredImportObject> {
    const file = safePath(this.root, key);
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
    return { provider: this.provider, key, sizeBytes: Buffer.byteLength(content, 'utf8') };
  }

  async readText(key: string): Promise<string> {
    return fs.readFile(safePath(this.root, key), 'utf8');
  }

  async openReadStream(key: string): Promise<Readable> {
    return createReadStream(safePath(this.root, key), { encoding: 'utf8' });
  }

  async delete(key: string): Promise<void> {
    await fs.rm(safePath(this.root, key), { force: true });
  }
}

export class MemoryImportStorage implements ImportStorage {
  readonly provider = 'memory';
  private readonly objects = new Map<string, string>();

  async put(key: string, content: string): Promise<StoredImportObject> {
    this.objects.set(key, content);
    return { provider: this.provider, key, sizeBytes: Buffer.byteLength(content, 'utf8') };
  }

  async readText(key: string): Promise<string> {
    const value = this.objects.get(key);
    if (value == null) throw new Error('IMPORT_OBJECT_NOT_FOUND');
    return value;
  }

  async openReadStream(key: string): Promise<Readable> {
    const { Readable } = await import('node:stream');
    return Readable.from([await this.readText(key)]);
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
  // this behind the same interface with S3/R2/MinIO without changing import-job semantics.
  activeStorage = new LocalFileImportStorage();
  return activeStorage;
}
