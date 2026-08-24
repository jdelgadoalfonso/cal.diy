import { describe, expect, it } from "vitest";
import { eoiConstraintsConfigSchema, getDefaultConfig } from "../schema";

describe("eoiConstraintsConfigSchema", () => {
  it("validates minimal valid config", () => {
    const input = {
      eventTypeMap: {
        "1": { course: "Test", hourType: "lectiva" },
      },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventTypeMap["1"]).toEqual({ course: "Test", hourType: "lectiva" });
      expect(result.data.dailyLimits).toEqual({ perStudentPerDay: 2 });
      expect(result.data.studentMaxHours).toEqual({});
    }
  });

  it("validates full config with all fields", () => {
    const input = {
      eventTypeMap: {
        "1": { course: "Programación Web", hourType: "lectiva" },
        "2": { course: "Programación Web", hourType: "tutorias" },
      },
      dailyLimits: { perStudentPerDay: 3 },
      studentMaxHours: {
        "alumno@eoi.es": {
          "Programación Web": { lectiva: 20, tutorias: 10 },
        },
      },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
  });

  it("rejects empty course name", () => {
    const input = {
      eventTypeMap: {
        "1": { course: "", hourType: "lectiva" },
      },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it("rejects invalid hourType", () => {
    const input = {
      eventTypeMap: {
        "1": { course: "Test", hourType: "invalid" },
      },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it("rejects negative daily limits", () => {
    const input = {
      eventTypeMap: {},
      dailyLimits: { perStudentPerDay: -1 },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it("rejects non-integer daily limits", () => {
    const input = {
      eventTypeMap: {},
      dailyLimits: { perStudentPerDay: 2.5 },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it("rejects invalid email in studentMaxHours", () => {
    const input = {
      eventTypeMap: {},
      studentMaxHours: {
        "not-an-email": { Test: { lectiva: 10 } },
      },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it("rejects negative student max hours", () => {
    const input = {
      eventTypeMap: {},
      studentMaxHours: {
        "test@test.com": { Test: { lectiva: -5 } },
      },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it("accepts optional lectiva/tutorias in studentMaxHours", () => {
    const input = {
      eventTypeMap: {},
      studentMaxHours: {
        "test@test.com": { Test: { lectiva: 10 } },
      },
    };

    const result = eoiConstraintsConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.studentMaxHours["test@test.com"].Test.lectiva).toBe(10);
      expect(result.data.studentMaxHours["test@test.com"].Test.tutorias).toBeUndefined();
    }
  });
});

describe("getDefaultConfig", () => {
  it("returns expected defaults", () => {
    const config = getDefaultConfig();

    expect(config).toEqual({
      eventTypeMap: {},
      dailyLimits: { perStudentPerDay: 2 },
      studentMaxHours: {},
    });
  });
});