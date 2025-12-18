import { promises as fs } from "fs";
import path from "path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function writeJsonLines(filePath: string, records: unknown[]): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(filePath, content + (records.length ? "\n" : ""), "utf8");
}

export async function writeBinary(filePath: string, data: Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, data);
}

export async function copyFile(srcPath: string, destPath: string): Promise<void> {
  const dir = path.dirname(destPath);
  await ensureDir(dir);
  await fs.copyFile(srcPath, destPath);
}

export async function listFilesRecursive(
  rootDir: string,
  predicate: (filePath: string) => boolean
): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  await walk(rootDir);
  return results;
}
