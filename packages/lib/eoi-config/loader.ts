import fs from "node:fs";
import path from "node:path";
import { cwd } from "node:process";
import yaml from "yaml";
import { eoiConstraintsConfigSchema } from "./schema";
import type { EoiConstraintsConfig } from "./types";

let cachedConfig: EoiConstraintsConfig | null = null;
let configPath: string | null = null;

function findConfigFile(): string | null {
  const candidates = [
    path.resolve(cwd(), "eoi-constraints.yaml"),
    path.resolve(cwd(), "config", "eoi-constraints.yaml"),
    path.resolve(__dirname, "..", "..", "..", "eoi-constraints.yaml"),
  ];
  return candidates.find(fs.existsSync) || null;
}

function getDefaultConfig(): EoiConstraintsConfig {
  return {
    eventTypeMap: {},
    dailyLimits: { perStudentPerDay: 2, totalPerDay: 8 },
    studentMaxHours: {},
  };
}

export function loadEoiConfig(customPath?: string): EoiConstraintsConfig {
  const filePath = customPath || configPath || findConfigFile();
  if (!filePath) {
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
  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
  configPath = null;
}