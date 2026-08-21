import dayjs from "@calcom/dayjs";
import { HttpError } from "@calcom/lib/http-error";
import { loadEoiConfig } from "@calcom/lib/eoi-config";
import { getBookingsDurationSum, getStudentGlobalHours } from "./queries";
import type { CheckEoiBookingLimitsParams, CheckEoiBookingLimitsResult } from "./types";

export class CheckEoiBookingLimitsService {
  private config = loadEoiConfig();

  /**
   * Checks EOI booking limits for a single attendee.
   * Returns a result object indicating whether the booking is allowed and details if violated.
   */
  async checkLimits(params: CheckEoiBookingLimitsParams): Promise<CheckEoiBookingLimitsResult> {
    // Reload config on each check (or implement cache invalidation)
    this.config = loadEoiConfig();

    const mapping = this.config.eventTypeMap[String(params.eventTypeId)];
    if (!mapping) {
      // Event type not mapped → no EOI constraints
      return { allowed: true };
    }

    const { course, hourType } = mapping;
    const dateStr = dayjs(params.startTime).format("YYYY-MM-DD");
    const dayStart = dayjs(params.startTime).startOf("day").toDate();
    const dayEnd = dayjs(params.startTime).endOf("day").toDate();

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

    const studentDailyLimit = this.config.dailyLimits.perStudentPerDay;
    if (studentDailyHours + params.durationHours > studentDailyLimit) {
      return {
        allowed: false,
        violatedConstraint: "student_daily",
        currentUsage: studentDailyHours + params.durationHours,
        limit: studentDailyLimit,
        details: { course, hourType, date: dateStr },
      };
    }

    // Check 2: Total daily limit
    const totalDailyHours = await getBookingsDurationSum({
      eventTypeIds: relevantEventTypeIds,
      startDate: dayStart,
      endDate: dayEnd,
      excludeUid: params.rescheduleUid,
    });

    const totalDailyLimit = this.config.dailyLimits.totalPerDay;
    if (totalDailyHours + params.durationHours > totalDailyLimit) {
      return {
        allowed: false,
        violatedConstraint: "total_daily",
        currentUsage: totalDailyHours + params.durationHours,
        limit: totalDailyLimit,
        details: { course, hourType, date: dateStr },
      };
    }

    // Check 3: Student global limit (if configured)
    const studentCourseConfig = this.config.studentMaxHours[params.attendeeEmail]?.[course];
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
        total_daily: `Daily total limit exceeded: ${result.currentUsage}h > ${result.limit}h for ${result.details?.course} (${result.details?.hourType}) on ${result.details?.date}`,
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