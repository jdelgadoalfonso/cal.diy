import dayjs from "@calcom/dayjs";
import { loadEoiConfig } from "@calcom/lib/eoi-config";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { getBookingsDurationSum, getStudentGlobalHours } from "./queries";
import type {
  CheckEoiBookingLimitsParams,
  CheckEoiBookingLimitsResult,
} from "./types";

const log = logger.getSubLogger({
  prefix: ["[handleBookingRequested] book:user"],
});

export class CheckEoiBookingLimitsService {
  private config = loadEoiConfig();

  /**
   * Checks EOI booking limits for a single attendee.
   * Returns a result object indicating whether the booking is allowed and details if violated.
   */
  async checkLimits(
    params: CheckEoiBookingLimitsParams
  ): Promise<CheckEoiBookingLimitsResult> {
    // Reload config on each check (or implement cache invalidation)
    this.config = loadEoiConfig();

    const mapping = this.config.eventTypeMap[String(params.eventTypeId)];
    if (!mapping) {
      // Event type not mapped → no EOI constraints
      log.debug("⚠️ Evento NO mapeado. Permitiendo reserva de forma libre.");
      return { allowed: true };
    }

    log.debug("Mapeo encontrado para este evento:", mapping);

    const { course, hourType } = mapping;
    // Use the provided timezone (organizer's timezone) for day boundary calculation
    const dateStr = dayjs(params.startTime)
      .tz(params.timeZone)
      .format("YYYY-MM-DD");
    const dayStart = dayjs(params.startTime)
      .tz(params.timeZone)
      .startOf("day")
      .toDate();
    const dayEnd = dayjs(params.startTime)
      .tz(params.timeZone)
      .endOf("day")
      .toDate();

    // Find all eventTypeIds for this course+hourType
    const relevantEventTypeIds = Object.entries(this.config.eventTypeMap)
      .filter(([, m]) => m.course === course && m.hourType === hourType)
      .map(([id]) => parseInt(id, 10));

    // Check 1: Per-student daily limit
    const studentDailyHours = await getBookingsDurationSum({
      attendeeEmail: params.attendeeEmail,
      eventTypeIds: relevantEventTypeIds,
      startDate: dayStart,
      endDate: dayEnd,
      excludeUid: params.rescheduleUid,
    });

    log.debug(`Email: ${params.attendeeEmail}`);
    log.debug(
      `Horas ya reservadas hoy: ${studentDailyHours}. Horas a añadir: ${params.durationHours}. Limite: ${this.config.dailyLimits.perStudentPerDay}`
    );

    const studentDailyLimit = this.config.dailyLimits.perStudentPerDay;
    if (studentDailyHours + params.durationHours > studentDailyLimit) {
      log.error("❌ Límite superado! Bloqueando reserva...");
      return {
        allowed: false,
        violatedConstraint: "student_daily",
        currentUsage: studentDailyHours + params.durationHours,
        limit: studentDailyLimit,
        details: { course, hourType, date: dateStr },
      };
    }

    // Check 2: Student global limit (if configured)
    const studentCourseConfig =
      this.config.studentMaxHours[params.attendeeEmail]?.[course];
    const globalLimit = studentCourseConfig?.[hourType];

    if (globalLimit !== undefined && globalLimit > 0) {
      const globalHours = await getStudentGlobalHours(
        params.attendeeEmail,
        relevantEventTypeIds,
        params.rescheduleUid
      );

      if (globalHours + params.durationHours > globalLimit) {
        return {
          allowed: false,
          violatedConstraint: "student_global",
          currentUsage: globalHours + params.durationHours,
          limit: globalLimit,
          details: { course, hourType, date: dateStr },
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Enforces EOI booking limits, throwing an HttpError if any limit is violated.
   * This is the main entry point for integration with RegularBookingService.
   */
  async enforceLimits(params: CheckEoiBookingLimitsParams): Promise<void> {
    const result = await this.checkLimits(params);
    if (!result.allowed) {
      const messages: Record<string, string> = {
        student_daily: `Student daily limit exceeded: ${result.currentUsage}h > ${result.limit}h for ${result.details?.course} (${result.details?.hourType}) on ${result.details?.date}`,
        student_global: `Student global limit exceeded: ${result.currentUsage}h > ${result.limit}h for ${result.details?.course} (${result.details?.hourType})`,
      };
      const violatedConstraint = result.violatedConstraint ?? "student_daily";
      throw new HttpError({
        statusCode: 403,
        message: messages[violatedConstraint],
      });
    }
  }
}
