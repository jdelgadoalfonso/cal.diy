/**
 * Unit tests for EOI Config Loader
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cwd } from "node:process";

import { loadEoiConfig, clearConfigCache } from "../loader";
import { eoiConstraintsConfigSchema } from "../schema";

const TEST_CONFIG_DIR = path.resolve(__dirname, "..", "..", "..", "..", "test-configs");

function setupTestConfigDir() {
  if (!fs.existsSync(TEST_CONFIG_DIR)) {
    fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  }
}

function writeTestConfig(filename: string, content: string) {
  setupTestConfigDir();
  fs.writeFileSync(path.join(TEST_CONFIG_DIR, filename), content);
}

function removeTestConfig(filename: string) {
  const filepath = path.join(TEST_CONFIG_DIR, filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
}

function cleanupTestConfigDir() {
  if (fs.existsSync(TEST_CONFIG_DIR)) {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  }
}

describe("loadEoiConfig", () => {
  beforeEach(() => {
    clearConfigCache();
    setupTestConfigDir();
  });

  afterEach(() => {
    clearConfigCache();
    cleanupTestConfigDir();
  });

  it("loads valid YAML config from custom path", () => {
    const yamlContent = `
eventTypeMap:
  "1":
    course: "Ingles B1"
    hourType: "lectiva"
  "2":
    course: "Ingles B1"
    hourType: "tutorias"
dailyLimits:
  perStudentPerDay: 3
  totalPerDay: 6
studentMaxHours:
  "student@example.com":
    "Ingles B1":
      lectiva: 50
      tutorias: 10
`;
    writeTestConfig("valid.yaml", yamlContent);

    const config = loadEoiConfig(path.join(TEST_CONFIG_DIR, "valid.yaml"));

    expect(config.eventTypeMap["1"]).toEqual({ course: "Ingles B1", hourType: "lectiva" });
    expect(config.eventTypeMap["2"]).toEqual({ course: "Ingles B1", hourType: "tutorias" });
    expect(config.dailyLimits.perStudentPerDay).toBe(3);
    expect(config.dailyLimits.totalPerDay).toBe(6);
    expect(config.studentMaxHours["student@example.com"]["Ingles B1"].lectiva).toBe(50);
    expect(config.studentMaxHours["student@example.com"]["Ingles B1"].tutorias).toBe(10);
  });

  it("uses defaults when dailyLimits not provided", () => {
    const yamlContent = `
eventTypeMap:
  "1":
    course: "Ingles B1"
    hourType: "lectiva"
`;
    writeTestConfig("minimal.yaml", yamlContent);

    const config = loadEoiConfig(path.join(TEST_CONFIG_DIR, "minimal.yaml"));

    expect(config.dailyLimits.perStudentPerDay).toBe(2);
    expect(config.dailyLimits.totalPerDay).toBe(8);
    expect(config.studentMaxHours).toEqual({});
  });

  it("throws descriptive error for invalid YAML syntax", () => {
    writeTestConfig("invalid.yaml", "invalid: yaml: content: [");

    expect(() => loadEoiConfig(path.join(TEST_CONFIG_DIR, "invalid.yaml"))).toThrow();
  });

  it("throws descriptive error for schema validation failure", () => {
    const yamlContent = `
eventTypeMap:
  "1":
    course: ""
    hourType: "lectiva"
`;
    writeTestConfig("schema-invalid.yaml", yamlContent);

    expect(() => loadEoiConfig(path.join(TEST_CONFIG_DIR, "schema-invalid.yaml"))).toThrow(
      "Invalid eoi-constraints.yaml"
    );
  });

  it("throws descriptive error for invalid hourType", () => {
    const yamlContent = `
eventTypeMap:
  "1":
    course: "Ingles B1"
    hourType: "invalid"
`;
    writeTestConfig("bad-hourt.yaml", yamlContent);

    expect(() => loadEoiConfig(path.join(TEST_CONFIG_DIR, "bad-hourt.yaml"))).toThrow(
      "Invalid eoi-constraints.yaml"
    );
  });

  it("caches config and returns cached version on subsequent calls", () => {
    const yamlContent = `
eventTypeMap:
  "1":
    course: "Ingles B1"
    hourType: "lectiva"
`;
    writeTestConfig("cache-test.yaml", yamlContent);

    const config1 = loadEoiConfig(path.join(TEST_CONFIG_DIR, "cache-test.yaml"));
    const config2 = loadEoiConfig(path.join(TEST_CONFIG_DIR, "cache-test.yaml"));

    expect(config1).toBe(config2); // Same object reference
  });

  it("reloads config when cache is cleared", () => {
    const yamlContent1 = `
eventTypeMap:
  "1":
    course: "Ingles B1"
    hourType: "lectiva"
`;
    const yamlContent2 = `
eventTypeMap:
  "1":
    course: "Frances A1"
    hourType: "tutorias"
`;
    writeTestConfig("reload-test.yaml", yamlContent1);

    const config1 = loadEoiConfig(path.join(TEST_CONFIG_DIR, "reload-test.yaml"));
    expect(config1.eventTypeMap["1"].course).toBe("Ingles B1");

    // Update file
    writeTestConfig("reload-test.yaml", yamlContent2);
    clearConfigCache();

    const config2 = loadEoiConfig(path.join(TEST_CONFIG_DIR, "reload-test.yaml"));
    expect(config2.eventTypeMap["1"].course).toBe("Frances A1");
  });

  it("returns default config when file not found and no custom path", () => {
    // biome-ignore lint/correctness/noProcessGlobal: mocking process.cwd for test
    const originalCwd = process.cwd;
    const tempDir = path.join(TEST_CONFIG_DIR, "empty-for-not-found");
    fs.mkdirSync(tempDir, { recursive: true });

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    const config = loadEoiConfig();

    expect(config.eventTypeMap).toEqual({});
    expect(config.dailyLimits.perStudentPerDay).toBe(2);
    expect(config.dailyLimits.totalPerDay).toBe(8);
    expect(config.studentMaxHours).toEqual({});

    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns default config when customPath is undefined and no config file exists", () => {
    // Mock process.cwd to a temp directory without config
    // biome-ignore lint/correctness/noProcessGlobal: mocking process.cwd for test
    const originalCwd = process.cwd;
    const tempDir = path.join(TEST_CONFIG_DIR, "empty");
    fs.mkdirSync(tempDir, { recursive: true });

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    const config = loadEoiConfig();

    expect(config.eventTypeMap).toEqual({});
    expect(config.dailyLimits.perStudentPerDay).toBe(2);

    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds config in current working directory", () => {
    const yamlContent = `
eventTypeMap:
  "1":
    course: "Ingles B1"
    hourType: "lectiva"
`;
    // Write to a location that findConfigFile will check
    // biome-ignore lint/correctness/noProcessGlobal: mocking process.cwd for test
    const originalCwd = process.cwd;
    const tempDir = path.join(TEST_CONFIG_DIR, "cwd-test");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "eoi-constraints.yaml"), yamlContent);

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    const config = loadEoiConfig();

    expect(config.eventTypeMap["1"].course).toBe("Ingles B1");

    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("clearConfigCache", () => {
  it("clears cached config and path", () => {
    const yamlContent = `
eventTypeMap:
  "1":
    course: "Ingles B1"
    hourType: "lectiva"
`;
    writeTestConfig("clear-cache.yaml", yamlContent);

    loadEoiConfig(path.join(TEST_CONFIG_DIR, "clear-cache.yaml"));
    clearConfigCache();

    // Should be able to load different config from same path after clear
    const yamlContent2 = `
eventTypeMap:
  "1":
    course: "Frances A1"
    hourType: "tutorias"
`;
    writeTestConfig("clear-cache.yaml", yamlContent2);

    const config = loadEoiConfig(path.join(TEST_CONFIG_DIR, "clear-cache.yaml"));
    expect(config.eventTypeMap["1"].course).toBe("Frances A1");
  });
});