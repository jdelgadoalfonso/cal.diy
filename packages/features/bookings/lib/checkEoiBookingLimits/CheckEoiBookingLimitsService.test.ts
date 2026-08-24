/**
 * Unit tests for CheckEoiBookingLimitsService
 * Tests all three constraint checks with mocked Prisma
 */

import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import fs from "node:fs";
import path from "node:path";
import { clearConfigCache, loadEoiConfig } from "@calcom/lib/eoi-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckEoiBookingLimitsService } from "./CheckEoiBookingLimitsService";

const TEST_CONFIG_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "test-configs-eoi"
);

function setupTestConfigDir(): void {
  if (!fs.existsSync(TEST_CONFIG_DIR)) {
    fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  }
}

function writeTestConfig(filename: string, content: string): void {
  setupTestConfigDir();
  fs.writeFileSync(path.join(TEST_CONFIG_DIR, filename), content);
}

function cleanupTestConfigDir(): void {
  if (fs.existsSync(TEST_CONFIG_DIR)) {
    fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  }
}

const createMockBooking = (
  overrides: Partial<{
    uid: string;
    eventTypeId: number;
    startTime: Date;
    endTime: Date;
    status: string;
    attendeeEmail: string;
  }> = {}
): {
  uid: string;
  eventTypeId: number;
  startTime: Date;
  endTime: Date;
  status: string;
  attendees: { email: string }[];
} => {
  const base = {
    uid: "booking-1",
    eventTypeId: 1,
    startTime: new Date("2025-01-15T10:00:00Z"),
    endTime: new Date("2025-01-15T11:00:00Z"),
    status: "ACCEPTED",
    attendees: [{ email: "student@example.com" }],
  };
  const merged = { ...base, ...overrides };
  if (overrides.attendeeEmail) {
    merged.attendees = [{ email: overrides.attendeeEmail }];
  }
  return merged;
};

describe("CheckEoiBookingLimitsService", () => {
  let service: CheckEoiBookingLimitsService;

  beforeEach(() => {
    clearConfigCache();
    setupTestConfigDir();
    vi.clearAllMocks();
    service = new CheckEoiBookingLimitsService();
  });

  afterEach(() => {
    clearConfigCache();
    cleanupTestConfigDir();
    vi.restoreAllMocks();
  });

  describe("Unmapped event type", () => {
    it("allows booking when eventTypeId is not in config", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
`;
      writeTestConfig("unmapped.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "unmapped.yaml"));

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 999, // Not in config
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(true);
      expect(result.violatedConstraint).toBeUndefined();
    });
  });

  describe("Per-student daily limit", () => {
    it("allows booking when under daily limit", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
  "2":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
`;
      writeTestConfig("daily-limit.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "daily-limit.yaml"));

      // Mock existing booking: 1 hour for same student, same course/hourType, same day
      prismaMock.booking.findMany.mockResolvedValue([
        createMockBooking({
          uid: "existing-1",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T08:00:00Z"),
          endTime: new Date("2025-01-15T09:00:00Z"),
          attendeeEmail: "student@example.com",
        }),
      ]);

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(true);
    });

    it("rejects booking when student daily limit exceeded", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
  "2":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
`;
      writeTestConfig("daily-limit-exceeded.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "daily-limit-exceeded.yaml"));

      // Mock existing bookings: 2 hours for same student, same course/hourType, same day
      prismaMock.booking.findMany.mockResolvedValue([
        createMockBooking({
          uid: "existing-1",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T08:00:00Z"),
          endTime: new Date("2025-01-15T09:00:00Z"),
          attendeeEmail: "student@example.com",
        }),
        createMockBooking({
          uid: "existing-2",
          eventTypeId: 2,
          startTime: new Date("2025-01-15T09:00:00Z"),
          endTime: new Date("2025-01-15T10:00:00Z"),
          attendeeEmail: "student@example.com",
        }),
      ]);

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(false);
      expect(result.violatedConstraint).toBe("student_daily");
      expect(result.currentUsage).toBe(3); // 2 existing + 1 new
      expect(result.limit).toBe(2);
      expect(result.details?.course).toBe("Programación Web");
      expect(result.details?.hourType).toBe("lectiva");
      expect(result.details?.date).toBe("2025-01-15");
    });

    it("excludes rescheduleUid from daily limit count", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
`;
      writeTestConfig("reschedule.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "reschedule.yaml"));

      // Use mockImplementation to filter out excluded uid
      prismaMock.booking.findMany.mockImplementation(
        async (args: { where?: { uid?: { not?: string } } }) => {
          const excludeUid = args.where?.uid?.not;
          const allBookings = [
            createMockBooking({
              uid: "reschedule-uid",
              eventTypeId: 1,
              startTime: new Date("2025-01-15T08:00:00Z"),
              endTime: new Date("2025-01-15T10:00:00Z"),
              attendeeEmail: "student@example.com",
            }),
          ];
          if (excludeUid) {
            return allBookings.filter((b) => b.uid !== excludeUid);
          }
          return allBookings;
        }
      );

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
        rescheduleUid: "reschedule-uid",
      });

      // Should allow because the existing booking is excluded
      expect(result.allowed).toBe(true);
    });
  });

  describe("Total daily limit", () => {

  });

  describe("Student global limit", () => {
    it("allows booking when global limit not configured", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
`;
      writeTestConfig("no-global.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "no-global.yaml"));

      // Mock: student daily check returns 1 hour (under 2h limit)
      // Total daily check returns 1 hour (under 8h limit)
      // Global limit check not run (not configured)
      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: { attendees?: { some?: { email?: string } } };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          if (attendeeEmail === "student@example.com") {
            // Student daily check - return 1 hour booking
            return [
              createMockBooking({
                uid: "existing-1",
                eventTypeId: 1,
                startTime: new Date("2025-01-15T08:00:00Z"),
                endTime: new Date("2025-01-15T09:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
            ];
          }
          // Total daily check - return same booking
          return [
            createMockBooking({
              uid: "existing-1",
              eventTypeId: 1,
              startTime: new Date("2025-01-15T08:00:00Z"),
              endTime: new Date("2025-01-15T09:00:00Z"),
              attendeeEmail: "student@example.com",
            }),
          ];
        }
      );

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(true);
    });

    it("allows booking when under global limit", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
studentMaxHours:
  "student@example.com":
    "Programación Web":
      lectiva: 20
      tutorias: 10
`;
      writeTestConfig("global-limit.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "global-limit.yaml"));

      // Mock:
      // 1. Student daily check - 1 hour today (under 2h limit)
      // 2. Total daily check - 1 hour today (under 8h limit)
      // 3. Global limit check - 5 hours total (under 20h limit)
      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: {
            attendees?: { some?: { email?: string } };
            uid?: { not?: string };
          };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          const excludeUid = args.where?.uid?.not;

          // Global limit check uses getStudentGlobalHours which has different where clause
          // It doesn't have date range filter, and always has attendeeEmail
          // Student daily check has date range filter and attendeeEmail
          // Total daily check has date range filter but no attendeeEmail

          // For simplicity, check if it's the global check (no date range in where)
          // Actually, let's check by the parameters passed
          // The daily checks have startTime in where, global check doesn't

          const hasDateRange = args.where && "startTime" in args.where;

          if (attendeeEmail === "student@example.com" && hasDateRange) {
            // Student daily check - return 1 hour booking today
            return [
              createMockBooking({
                uid: "today-1",
                eventTypeId: 1,
                startTime: new Date("2025-01-15T08:00:00Z"),
                endTime: new Date("2025-01-15T09:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
            ];
          }

          if (!attendeeEmail && hasDateRange) {
            // Total daily check - return 1 hour booking today
            return [
              createMockBooking({
                uid: "today-1",
                eventTypeId: 1,
                startTime: new Date("2025-01-15T08:00:00Z"),
                endTime: new Date("2025-01-15T09:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
            ];
          }

          if (attendeeEmail === "student@example.com" && !hasDateRange) {
            // Global limit check - return 5 hours across time
            const allBookings = [
              createMockBooking({
                uid: "existing-1",
                eventTypeId: 1,
                startTime: new Date("2024-01-15T10:00:00Z"),
                endTime: new Date("2024-01-15T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-2",
                eventTypeId: 1,
                startTime: new Date("2024-06-15T10:00:00Z"),
                endTime: new Date("2024-06-15T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-3",
                eventTypeId: 1,
                startTime: new Date("2024-12-15T10:00:00Z"),
                endTime: new Date("2024-12-15T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-4",
                eventTypeId: 1,
                startTime: new Date("2024-12-15T11:00:00Z"),
                endTime: new Date("2024-12-15T12:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-5",
                eventTypeId: 1,
                startTime: new Date("2025-01-10T10:00:00Z"),
                endTime: new Date("2025-01-10T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
            ];
            if (excludeUid) {
              return allBookings.filter((b) => b.uid !== excludeUid);
            }
            return allBookings;
          }

          return [];
        }
      );

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(true);
    });

    it("rejects booking when student global limit exceeded", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 10
studentMaxHours:
  "student@example.com":
    "Programación Web":
      lectiva: 5
`;
      writeTestConfig("global-limit-exceeded.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "global-limit-exceeded.yaml"));

      // Mock:
      // 1. Student daily check - 0 hours today (under 10h limit)
      // 2. Total daily check - 0 hours today (under 20h limit)
      // 3. Global limit check - 5 hours total (at 5h limit)
      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: {
            attendees?: { some?: { email?: string } };
            startTime?: object | Date;
            uid?: { not?: string };
          };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          const hasDateRange = args.where?.startTime;
          const excludeUid = args.where?.uid?.not;

          if (attendeeEmail === "student@example.com" && hasDateRange) {
            // Student daily check - return empty (no bookings today)
            return [];
          }

          if (!attendeeEmail && hasDateRange) {
            // Total daily check - return empty (no bookings today)
            return [];
          }

          if (attendeeEmail === "student@example.com" && !hasDateRange) {
            // Global limit check - return 5 hours across time (at limit)
            const allBookings = [
              createMockBooking({
                uid: "existing-1",
                eventTypeId: 1,
                startTime: new Date("2024-01-15T10:00:00Z"),
                endTime: new Date("2024-01-15T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-2",
                eventTypeId: 1,
                startTime: new Date("2024-06-15T10:00:00Z"),
                endTime: new Date("2024-06-15T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-3",
                eventTypeId: 1,
                startTime: new Date("2024-12-15T10:00:00Z"),
                endTime: new Date("2024-12-15T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-4",
                eventTypeId: 1,
                startTime: new Date("2024-12-15T11:00:00Z"),
                endTime: new Date("2024-12-15T12:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-5",
                eventTypeId: 1,
                startTime: new Date("2025-01-10T10:00:00Z"),
                endTime: new Date("2025-01-10T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
            ];
            if (excludeUid) {
              return allBookings.filter((b) => b.uid !== excludeUid);
            }
            return allBookings;
          }

          return [];
        }
      );

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(false);
      expect(result.violatedConstraint).toBe("student_global");
      expect(result.currentUsage).toBe(6); // 5 existing + 1 new
      expect(result.limit).toBe(5);
    });

    it("excludes rescheduleUid from global limit count", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 10
studentMaxHours:
  "student@example.com":
    "Programación Web":
      lectiva: 5
`;
      writeTestConfig("global-reschedule.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "global-reschedule.yaml"));

      // Mock:
      // 1. Student daily check - 0 hours today (under 10h limit)
      // 2. Total daily check - 0 hours today (under 20h limit)
      // 3. Global limit check - 5 hours total including reschedule (2h), but reschedule excluded = 3h + 1h new = 4h <= 5h limit
      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: {
            attendees?: { some?: { email?: string } };
            startTime?: object | Date;
            uid?: { not?: string };
          };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          const hasDateRange = args.where?.startTime;
          const excludeUid = args.where?.uid?.not;

          if (attendeeEmail === "student@example.com" && hasDateRange) {
            // Student daily check - return empty (no bookings today)
            return [];
          }

          if (!attendeeEmail && hasDateRange) {
            // Total daily check - return empty (no bookings today)
            return [];
          }

          if (attendeeEmail === "student@example.com" && !hasDateRange) {
            // Global limit check - return 5 hours total including 2h reschedule
            const allBookings = [
              createMockBooking({
                uid: "reschedule-uid",
                eventTypeId: 1,
                startTime: new Date("2024-01-15T10:00:00Z"),
                endTime: new Date("2024-01-15T12:00:00Z"), // 2 hours
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-1",
                eventTypeId: 1,
                startTime: new Date("2024-06-15T10:00:00Z"),
                endTime: new Date("2024-06-15T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-2",
                eventTypeId: 1,
                startTime: new Date("2024-12-15T10:00:00Z"),
                endTime: new Date("2024-12-15T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-3",
                eventTypeId: 1,
                startTime: new Date("2024-12-15T11:00:00Z"),
                endTime: new Date("2024-12-15T12:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
              createMockBooking({
                uid: "existing-4",
                eventTypeId: 1,
                startTime: new Date("2025-01-10T10:00:00Z"),
                endTime: new Date("2025-01-10T11:00:00Z"),
                attendeeEmail: "student@example.com",
              }),
            ];
            if (excludeUid) {
              return allBookings.filter((b) => b.uid !== excludeUid);
            }
            return allBookings;
          }

          return [];
        }
      );

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
        rescheduleUid: "reschedule-uid",
      });

      // Should allow because the rescheduled booking (2h) is excluded: 3h remaining + 1h new = 4h <= 5h limit
      expect(result.allowed).toBe(true);
    });
  });

  describe("Course/hourType separation", () => {
    it("separates limits by course and hourType", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
  "2":
    course: "Programación Web"
    hourType: "tutorias"
  "3":
    course: "Inglés Técnico"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
`;
      writeTestConfig("separation.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "separation.yaml"));

      // Mock existing bookings for different course/hourType combos
      // The query filters by eventTypeIds, so we need mockImplementation to filter correctly
      prismaMock.booking.findMany.mockImplementation(
        async (args: { where?: { eventTypeId?: { in?: number[] } } }) => {
          const eventTypeIds = args.where?.eventTypeId?.in;
          const allBookings = [
            // 2 hours of Programación Web lectiva (eventTypeId: 1)
            createMockBooking({
              uid: "existing-1",
              eventTypeId: 1,
              startTime: new Date("2025-01-15T08:00:00Z"),
              endTime: new Date("2025-01-15T10:00:00Z"),
              attendeeEmail: "student@example.com",
            }),
            // 1 hour of Programación Web tutorias (eventTypeId: 2)
            createMockBooking({
              uid: "existing-2",
              eventTypeId: 2,
              startTime: new Date("2025-01-15T10:00:00Z"),
              endTime: new Date("2025-01-15T11:00:00Z"),
              attendeeEmail: "student@example.com",
            }),
          ];
          // Filter by eventTypeIds if provided
          if (eventTypeIds && Array.isArray(eventTypeIds)) {
            return allBookings.filter((b) =>
              eventTypeIds.includes(b.eventTypeId)
            );
          }
          return allBookings;
        }
      );

      // Try to book Inglés Técnico lectiva (different course, eventTypeId: 3) - should be allowed
      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 3,
        startTime: new Date("2025-01-15T11:00:00Z"),
        endTime: new Date("2025-01-15T12:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe("enforceLimits", () => {
    it("throws HttpError with 403 when student daily limit exceeded", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 1
`;
      writeTestConfig("enforce-daily.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "enforce-daily.yaml"));

      prismaMock.booking.findMany.mockResolvedValue([
        createMockBooking({
          uid: "existing-1",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T08:00:00Z"),
          endTime: new Date("2025-01-15T09:00:00Z"),
          attendeeEmail: "student@example.com",
        }),
      ]);

      await expect(
        service.enforceLimits({
          attendeeEmail: "student@example.com",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T10:00:00Z"),
          endTime: new Date("2025-01-15T11:00:00Z"),
          durationHours: 1,
        })
      ).rejects.toThrowError();

      try {
        await service.enforceLimits({
          attendeeEmail: "student@example.com",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T10:00:00Z"),
          endTime: new Date("2025-01-15T11:00:00Z"),
          durationHours: 1,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "Student daily limit exceeded"
        );
      }
    });


    it("throws HttpError with 403 when student global limit exceeded", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
studentMaxHours:
  "student@example.com":
    "Programación Web":
      lectiva: 1
`;
      writeTestConfig("enforce-global.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "enforce-global.yaml"));

      prismaMock.booking.findMany.mockResolvedValue([
        createMockBooking({
          uid: "existing-1",
          eventTypeId: 1,
          startTime: new Date("2024-01-15T10:00:00Z"),
          endTime: new Date("2024-01-15T11:00:00Z"),
          attendeeEmail: "student@example.com",
        }),
      ]);

      await expect(
        service.enforceLimits({
          attendeeEmail: "student@example.com",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T10:00:00Z"),
          endTime: new Date("2025-01-15T11:00:00Z"),
          durationHours: 1,
        })
      ).rejects.toThrowError();

      try {
        await service.enforceLimits({
          attendeeEmail: "student@example.com",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T10:00:00Z"),
          endTime: new Date("2025-01-15T11:00:00Z"),
          durationHours: 1,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "Student global limit exceeded"
        );
      }
    });
  });

  describe("Timezone handling", () => {
    it("calculates date from startTime in organizer timezone", async () => {
      const yamlContent = `
    eventTypeMap:
      "1":
        course: "Programación Web"
        hourType: "lectiva"
    dailyLimits:
      perStudentPerDay: 2
    `;
      writeTestConfig("timezone.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "timezone.yaml"));

      // Booking at 23:00 UTC on Jan 15 = 00:00 Jan 16 in UTC+1
      // With timezone "Europe/Madrid" (UTC+1), this is still Jan 15
      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: { attendees?: { some?: { email?: string } } };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          if (attendeeEmail) {
            return [];
          }
          return [];
        }
      );

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T23:00:00Z"),
        endTime: new Date("2025-01-16T00:00:00Z"),
        durationHours: 1,
        timeZone: "Europe/Madrid",
      });

      expect(result.allowed).toBe(true);
      // When allowed=true, details is not returned (only returned on violation)
      // This is expected behavior - details only included when constraint violated
      expect(result.details).toBeUndefined();
    });

    it("respects daily limit across timezone boundary", async () => {
      const yamlContent = `
    eventTypeMap:
      "1":
        course: "Programación Web"
        hourType: "lectiva"
    dailyLimits:
      perStudentPerDay: 2
    `;
      writeTestConfig("timezone-boundary.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "timezone-boundary.yaml"));

      // Existing booking: 2 hours on Jan 16 in Europe/Madrid timezone
      // (starts at 00:30 UTC = 01:30 Madrid time on Jan 16)
      const allExistingBookings = [
        createMockBooking({
          uid: "existing-1",
          eventTypeId: 1,
          startTime: new Date("2025-01-16T00:30:00Z"), // 01:30 Madrid time Jan 16
          endTime: new Date("2025-01-16T01:30:00Z"), // 02:30 Madrid time Jan 16
          attendeeEmail: "student@example.com",
        }),
        createMockBooking({
          uid: "existing-2",
          eventTypeId: 1,
          startTime: new Date("2025-01-16T01:30:00Z"), // 02:30 Madrid time Jan 16
          endTime: new Date("2025-01-16T02:30:00Z"), // 03:30 Madrid time Jan 16
          attendeeEmail: "student@example.com",
        }),
      ];

      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: {
            attendees?: { some?: { email?: string } };
            startTime?: { gte?: Date; lt?: Date };
          };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          const startDate = args.where?.startTime?.gte;
          const endDate = args.where?.startTime?.lt;

          if (attendeeEmail === "student@example.com") {
            return allExistingBookings.filter((b) => {
              if (startDate && b.startTime < startDate) return false;
              if (endDate && b.startTime >= endDate) return false;
              return true;
            });
          }
          return [];
        }
      );

      // Try to book another hour on Jan 16 02:30 UTC (which is Jan 16 03:30 Madrid time)
      // This is SAME day in Madrid timezone (Jan 16), limit is 2h, already used 2h -> should be rejected
      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-16T02:30:00Z"),
        endTime: new Date("2025-01-16T03:30:00Z"),
        durationHours: 1,
        timeZone: "Europe/Madrid",
      });

      // Should be rejected because in Madrid timezone, this is same day (Jan 16) and 2h already used
      expect(result.allowed).toBe(false);
      expect(result.violatedConstraint).toBe("student_daily");
    });

    it("allows booking on next day in organizer timezone", async () => {
      const yamlContent = `
    eventTypeMap:
      "1":
        course: "Programación Web"
        hourType: "lectiva"
    dailyLimits:
      perStudentPerDay: 2
    `;
      writeTestConfig("timezone-next-day.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "timezone-next-day.yaml"));

      // Existing booking: 2 hours on Jan 16 in Europe/Madrid timezone
      // The mock needs to respect the date range filter passed by the service
      const allExistingBookings = [
        createMockBooking({
          uid: "existing-1",
          eventTypeId: 1,
          startTime: new Date("2025-01-16T00:30:00Z"), // 01:30 Madrid time Jan 16
          endTime: new Date("2025-01-16T01:30:00Z"), // 02:30 Madrid time Jan 16
          attendeeEmail: "student@example.com",
        }),
        createMockBooking({
          uid: "existing-2",
          eventTypeId: 1,
          startTime: new Date("2025-01-16T01:30:00Z"), // 02:30 Madrid time Jan 16
          endTime: new Date("2025-01-16T02:30:00Z"), // 03:30 Madrid time Jan 16
          attendeeEmail: "student@example.com",
        }),
      ];

      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: {
            attendees?: { some?: { email?: string } };
            startTime?: { gte?: Date; lt?: Date };
          };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          const startDate = args.where?.startTime?.gte;
          const endDate = args.where?.startTime?.lt;

          if (attendeeEmail === "student@example.com") {
            return allExistingBookings.filter((b) => {
              if (startDate && b.startTime < startDate) return false;
              if (endDate && b.startTime >= endDate) return false;
              return true;
            });
          }
          return [];
        }
      );

      // Try to book on Jan 17 00:30 UTC (which is Jan 17 01:30 Madrid time)
      // This is NEXT day in Madrid timezone (Jan 17), so should be allowed
      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-17T00:30:00Z"),
        endTime: new Date("2025-01-17T01:30:00Z"),
        durationHours: 1,
        timeZone: "Europe/Madrid",
      });

      // Should be allowed because in Madrid timezone, this is a new day (Jan 17)
      expect(result.allowed).toBe(true);
    });

    it("rejects when daily limit exceeded in organizer timezone", async () => {
      const yamlContent = `
    eventTypeMap:
      "1":
        course: "Programación Web"
        hourType: "lectiva"
    dailyLimits:
      perStudentPerDay: 2
    `;
      writeTestConfig("timezone-exceeded.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "timezone-exceeded.yaml"));

      // Existing booking: 2 hours on Jan 15 in Europe/Madrid timezone
      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: { attendees?: { some?: { email?: string } } };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          if (attendeeEmail === "student@example.com") {
            return [
              createMockBooking({
                uid: "existing-1",
                eventTypeId: 1,
                startTime: new Date("2025-01-15T22:00:00Z"), // 23:00 Madrid time Jan 15
                endTime: new Date("2025-01-16T00:00:00Z"), // 01:00 Madrid time Jan 16
                attendeeEmail: "student@example.com",
              }),
            ];
          }
          return [];
        }
      );

      // Try to book another hour on Jan 15 23:30 UTC (which is Jan 16 00:30 Madrid time)
      // This is SAME day in Madrid timezone (Jan 16), so should be rejected
      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T23:30:00Z"),
        endTime: new Date("2025-01-16T00:30:00Z"),
        durationHours: 1,
        timeZone: "Europe/Madrid",
      });

      // Should be rejected because in Madrid timezone, this is still Jan 16 (same day as existing booking)
      expect(result.allowed).toBe(false);
      expect(result.violatedConstraint).toBe("student_daily");
    });
  });

  describe("Only counts ACCEPTED bookings", () => {
    it("ignores non-ACCEPTED bookings", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 1
`;
      writeTestConfig("accepted-only.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "accepted-only.yaml"));

      // The query only filters by status = "ACCEPTED", so PENDING bookings won't be returned
      // Mock empty results (since PENDING bookings are filtered out by the query)
      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: { attendees?: { some?: { email?: string } } };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          if (attendeeEmail) {
            return [];
          }
          return [];
        }
      );

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe("Multiple attendees in one booking", () => {
    it("checks each attendee independently against daily limits", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
`;
      writeTestConfig("multi-attendee.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "multi-attendee.yaml"));

      // No existing bookings for either attendee
      prismaMock.booking.findMany.mockResolvedValue([]);

      // Check primary attendee (booker)
      const result1 = await service.checkLimits({
        attendeeEmail: "booker@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      // Check guest attendee
      const result2 = await service.checkLimits({
        attendeeEmail: "guest@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });

    it("rejects guest when guest exceeds daily limit but booker is ok", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 1
`;
      writeTestConfig("multi-attendee-limit.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "multi-attendee-limit.yaml"));

      // Guest has existing booking (1h), booker has none
      prismaMock.booking.findMany.mockImplementation(
        async (args: {
          where?: { attendees?: { some?: { email?: string } } };
        }) => {
          const attendeeEmail = args.where?.attendees?.some?.email;
          if (attendeeEmail === "guest@example.com") {
            return [
              createMockBooking({
                uid: "existing-1",
                eventTypeId: 1,
                startTime: new Date("2025-01-15T08:00:00Z"),
                endTime: new Date("2025-01-15T09:00:00Z"),
                attendeeEmail: "guest@example.com",
              }),
            ];
          }
          return [];
        }
      );

      // Booker should be allowed
      const bookerResult = await service.checkLimits({
        attendeeEmail: "booker@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      // Guest should be rejected (already has 1h, limit is 1h)
      const guestResult = await service.checkLimits({
        attendeeEmail: "guest@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(bookerResult.allowed).toBe(true);
      expect(guestResult.allowed).toBe(false);
      expect(guestResult.violatedConstraint).toBe("student_daily");
    });

  });
});
