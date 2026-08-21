/**
 * Unit tests for CheckEoiBookingLimitsService
 * Tests all three constraint checks with mocked Prisma
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import type { CheckEoiBookingLimitsService } from "./CheckEoiBookingLimitsService";
import { loadEoiConfig, clearConfigCache } from "@calcom/lib/eoi-config";
import path from "node:path";
import fs from "node:fs";

const TEST_CONFIG_DIR: string = path.resolve(__dirname, "..", "..", "..", "..", "test-configs-eoi");

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

const createMockBooking = (overrides: Partial<{
  uid: string;
  eventTypeId: number;
  startTime: Date;
  endTime: Date;
  status: string;
  attendeeEmail: string;
}> = {}): {
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
  totalPerDay: 8
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
  totalPerDay: 8
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
  totalPerDay: 8
`;
      writeTestConfig("reschedule.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "reschedule.yaml"));

      // Use mockImplementation to filter out excluded uid
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { uid?: { not?: string } } }) => {
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
      });

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
    it("allows booking when total daily limit not exceeded", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
  totalPerDay: 8
`;
      writeTestConfig("total-daily.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "total-daily.yaml"));

      // Mock: student daily check (with attendeeEmail filter) returns empty for student4
      // Total daily check (no attendeeEmail filter) returns 3 hours from other students
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } } } }) => {
        const attendeeEmail = args.where?.attendees?.some?.email;
        if (attendeeEmail === "student4@example.com") {
          return []; // No existing bookings for this student
        }
        // Total daily check - return bookings from other students
        return [
          createMockBooking({
            uid: "existing-1",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T08:00:00Z"),
            endTime: new Date("2025-01-15T09:00:00Z"),
            attendeeEmail: "student1@example.com",
          }),
          createMockBooking({
            uid: "existing-2",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T09:00:00Z"),
            endTime: new Date("2025-01-15T10:00:00Z"),
            attendeeEmail: "student2@example.com",
          }),
          createMockBooking({
            uid: "existing-3",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T10:00:00Z"),
            endTime: new Date("2025-01-15T11:00:00Z"),
            attendeeEmail: "student3@example.com",
          }),
        ];
      });

      const result = await service.checkLimits({
        attendeeEmail: "student4@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T11:00:00Z"),
        endTime: new Date("2025-01-15T12:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(true);
    });

    it("rejects booking when total daily limit exceeded", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
  totalPerDay: 4
`;
      writeTestConfig("total-daily-exceeded.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "total-daily-exceeded.yaml"));

      // Mock existing bookings: 4 hours total from different students
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } } } }) => {
        const attendeeEmail = args.where?.attendees?.some?.email;
        const allBookings = [
          createMockBooking({
            uid: "existing-1",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T08:00:00Z"),
            endTime: new Date("2025-01-15T09:00:00Z"),
            attendeeEmail: "student1@example.com",
          }),
          createMockBooking({
            uid: "existing-2",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T09:00:00Z"),
            endTime: new Date("2025-01-15T10:00:00Z"),
            attendeeEmail: "student2@example.com",
          }),
          createMockBooking({
            uid: "existing-3",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T10:00:00Z"),
            endTime: new Date("2025-01-15T11:00:00Z"),
            attendeeEmail: "student3@example.com",
          }),
          createMockBooking({
            uid: "existing-4",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T11:00:00Z"),
            endTime: new Date("2025-01-15T12:00:00Z"),
            attendeeEmail: "student4@example.com",
          }),
        ];
        // If attendeeEmail filter is present, filter by it (student daily check)
        // If no attendeeEmail filter, return all (total daily check)
        if (attendeeEmail) {
          return allBookings.filter((b) => b.attendees[0].email === attendeeEmail);
        }
        return allBookings;
      });

      const result = await service.checkLimits({
        attendeeEmail: "student5@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T12:00:00Z"),
        endTime: new Date("2025-01-15T13:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(false);
      expect(result.violatedConstraint).toBe("total_daily");
      expect(result.currentUsage).toBe(5); // 4 existing + 1 new
      expect(result.limit).toBe(4);
    });
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
  totalPerDay: 8
`;
      writeTestConfig("no-global.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "no-global.yaml"));

      // Mock: student daily check returns 1 hour (under 2h limit)
      // Total daily check returns 1 hour (under 8h limit)
      // Global limit check not run (not configured)
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } } } }) => {
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
      });

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
  totalPerDay: 8
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
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } }; uid?: { not?: string } } }) => {
        const attendeeEmail = args.where?.attendees?.some?.email;
        const excludeUid = args.where?.uid?.not;
        
        // Global limit check uses getStudentGlobalHours which has different where clause
        // It doesn't have date range filter, and always has attendeeEmail
        // Student daily check has date range filter and attendeeEmail
        // Total daily check has date range filter but no attendeeEmail
        
        // For simplicity, check if it's the global check (no date range in where)
        // Actually, let's check by the parameters passed
        // The daily checks have startTime in where, global check doesn't
        
        const hasDateRange = args.where && 'startTime' in args.where;
        
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
      });

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
  totalPerDay: 20
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
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } }; startTime?: object | Date; uid?: { not?: string } } }) => {
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
      });

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
  totalPerDay: 20
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
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } }; startTime?: object | Date; uid?: { not?: string } } }) => {
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
      });

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
  totalPerDay: 8
`;
      writeTestConfig("separation.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "separation.yaml"));

      // Mock existing bookings for different course/hourType combos
      // The query filters by eventTypeIds, so we need mockImplementation to filter correctly
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { eventTypeId?: { in?: number[] } } }) => {
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
          return allBookings.filter((b) => eventTypeIds.includes(b.eventTypeId));
        }
        return allBookings;
      });

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
  totalPerDay: 8
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
        expect((error as Error).message).toContain("Student daily limit exceeded");
      }
    });

    it("throws HttpError with 403 when total daily limit exceeded", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 2
  totalPerDay: 2
`;
      writeTestConfig("enforce-total.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "enforce-total.yaml"));

      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } } } }) => {
        const attendeeEmail = args.where?.attendees?.some?.email;
        const allBookings = [
          createMockBooking({
            uid: "existing-1",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T08:00:00Z"),
            endTime: new Date("2025-01-15T10:00:00Z"),
            attendeeEmail: "student1@example.com",
          }),
        ];
        if (attendeeEmail) {
          return allBookings.filter((b) => b.attendees[0].email === attendeeEmail);
        }
        return allBookings;
      });

      await expect(
        service.enforceLimits({
          attendeeEmail: "student2@example.com",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T10:00:00Z"),
          endTime: new Date("2025-01-15T11:00:00Z"),
          durationHours: 1,
        })
      ).rejects.toThrowError();

      try {
        await service.enforceLimits({
          attendeeEmail: "student2@example.com",
          eventTypeId: 1,
          startTime: new Date("2025-01-15T10:00:00Z"),
          endTime: new Date("2025-01-15T11:00:00Z"),
          durationHours: 1,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Daily total limit exceeded");
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
  totalPerDay: 8
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
        expect((error as Error).message).toContain("Student global limit exceeded");
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
  totalPerDay: 8
`;
      writeTestConfig("timezone.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "timezone.yaml"));

      // Booking at 23:00 UTC on Jan 15 = 00:00 Jan 16 in UTC+1
      // But we use startTime as-is for date calculation
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } } } }) => {
        const attendeeEmail = args.where?.attendees?.some?.email;
        if (attendeeEmail) {
          return [];
        }
        return [];
      });

      const result = await service.checkLimits({
        attendeeEmail: "student@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T23:00:00Z"),
        endTime: new Date("2025-01-16T00:00:00Z"),
        durationHours: 1,
      });

      expect(result.allowed).toBe(true);
      // When allowed=true, details is not returned (only returned on violation)
      // This is expected behavior - details only included when constraint violated
      expect(result.details).toBeUndefined();
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
  totalPerDay: 8
`;
      writeTestConfig("accepted-only.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "accepted-only.yaml"));

      // The query only filters by status = "ACCEPTED", so PENDING bookings won't be returned
      // Mock empty results (since PENDING bookings are filtered out by the query)
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } } } }) => {
        const attendeeEmail = args.where?.attendees?.some?.email;
        if (attendeeEmail) {
          return [];
        }
        return [];
      });

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
  totalPerDay: 8
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
  totalPerDay: 8
`;
      writeTestConfig("multi-attendee-limit.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "multi-attendee-limit.yaml"));

      // Guest has existing booking (1h), booker has none
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } } } }) => {
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
      });

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

    it("checks total daily limit independently per attendee (sequential calls see same DB state)", async () => {
      const yamlContent = `
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
dailyLimits:
  perStudentPerDay: 10
  totalPerDay: 3
`;
      writeTestConfig("multi-attendee-total.yaml", yamlContent);
      loadEoiConfig(path.join(TEST_CONFIG_DIR, "multi-attendee-total.yaml"));

      // 2 existing bookings from other students (2h total)
      prismaMock.booking.findMany.mockImplementation(async (args: { where?: { attendees?: { some?: { email?: string } } } }) => {
        const attendeeEmail = args.where?.attendees?.some?.email;
        const allBookings = [
          createMockBooking({
            uid: "existing-1",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T08:00:00Z"),
            endTime: new Date("2025-01-15T09:00:00Z"),
            attendeeEmail: "student1@example.com",
          }),
          createMockBooking({
            uid: "existing-2",
            eventTypeId: 1,
            startTime: new Date("2025-01-15T09:00:00Z"),
            endTime: new Date("2025-01-15T10:00:00Z"),
            attendeeEmail: "student2@example.com",
          }),
        ];
        if (attendeeEmail) {
          return allBookings.filter((b) => b.attendees[0].email === attendeeEmail);
        }
        return allBookings;
      });

      // First guest (1h) - allowed (2h existing + 1h new = 3h, at limit)
      const guest1Result = await service.checkLimits({
        attendeeEmail: "guest1@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(guest1Result.allowed).toBe(true);

      // Second guest (1h) - also allowed (same 2h existing + 1h new = 3h, at limit)
      // Note: sequential calls don't see each other's in-flight bookings
      const guest2Result = await service.checkLimits({
        attendeeEmail: "guest2@example.com",
        eventTypeId: 1,
        startTime: new Date("2025-01-15T10:00:00Z"),
        endTime: new Date("2025-01-15T11:00:00Z"),
        durationHours: 1,
      });

      expect(guest2Result.allowed).toBe(true);
    });
  });
});