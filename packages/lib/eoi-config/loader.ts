import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import yaml from "yaml";
import { eoiConstraintsConfigSchema } from "./schema";
import type { EoiConstraintsConfig } from "./types";

let cachedConfig: EoiConstraintsConfig | null = null;
let configPath: string | null = null;

function findConfigFile(): string | null {
  const candidates = [
    process.env.EOI_CONSTRAINTS_PATH
      ? path.resolve(process.env.EOI_CONSTRAINTS_PATH)
      : null,
    path.resolve(process.cwd(), "eoi-constraints.yaml"),
    path.resolve(process.cwd(), "config", "eoi-constraints.yaml"),
    path.resolve(__dirname, "..", "..", "..", "eoi-constraints.yaml"),
  ].filter((candidate): candidate is string => candidate !== null);
  return candidates.find(fs.existsSync) || null;
}

function getDefaultConfig(): EoiConstraintsConfig {
  return {
    eventTypeMap: {},
    dailyLimits: { perStudentPerDay: 2 },
    studentMaxHours: {},
  };
}

export function loadEoiConfig(customPath?: string): EoiConstraintsConfig {
  const filePath = customPath || configPath || findConfigFile();
  if (!filePath) {
    console.warn(
      "[eoi-config] No eoi-constraints.yaml found (searched $EOI_CONSTRAINTS_PATH, cwd/, cwd/config/, package root/). " +
        "EOI booking constraints are DISABLED: all bookings will be allowed."
    );
    return getDefaultConfig();
  }

  if (cachedConfig && filePath === configPath) {
    return cachedConfig;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.parse(content);
  const result = eoiConstraintsConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`Invalid eoi-constraints.yaml: ${result.error.message}`);
  }

  cachedConfig = result.data;
  configPath = filePath;
  return cachedConfig!;
}

export function clearConfigCache(): void {
  cachedConfig = null;
  configPath = null;
}