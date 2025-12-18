import { SourceRegistrySchema, SourceRegistry, SourceConfig } from "./sourceRegistry";
import { readJson } from "../utils/fs";

export async function loadRegistry(registryPath: string): Promise<SourceRegistry> {
  const data = await readJson<unknown>(registryPath);
  return SourceRegistrySchema.parse(data);
}

export function getSourceById(
  registry: SourceRegistry,
  sourceId: string
): SourceConfig | undefined {
  return registry.sources.find((source) => source.id === sourceId);
}
