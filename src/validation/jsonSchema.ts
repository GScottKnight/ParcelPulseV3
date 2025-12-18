import { promises as fs } from "fs";
import path from "path";
import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validatorCache = new Map<string, ValidateFunction>();

export function contractsSchemasDir(): string {
  return path.resolve(__dirname, "..", "..", "..", "contracts", "schemas");
}

export async function loadJsonSchema(schemaPath: string): Promise<object> {
  const content = await fs.readFile(schemaPath, "utf8");
  if (!content.trim()) {
    throw new Error(`Schema file is empty: ${schemaPath}`);
  }
  return JSON.parse(content) as object;
}

export async function getSchemaValidator(schemaPath: string): Promise<ValidateFunction> {
  const cached = validatorCache.get(schemaPath);
  if (cached) return cached;
  const schema = await loadJsonSchema(schemaPath);
  const validator = ajv.compile(schema);
  validatorCache.set(schemaPath, validator);
  return validator;
}

export function assertValidSchema(
  validator: ValidateFunction,
  data: unknown,
  label: string
): void {
  const valid = validator(data);
  if (valid) return;
  const errors = (validator.errors ?? [])
    .map((error) => `${error.instancePath || "<root>"} ${error.message}`)
    .join("; ");
  throw new Error(`${label} failed schema validation: ${errors}`);
}
