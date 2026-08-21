import type { HourType } from "@calcom/lib/eoi-config";

export interface CheckEoiBookingLimitsParams {
  attendeeEmail: string;
  eventTypeId: number;
  startTime: Date;
  endTime: Date;
  durationHours: number;
  rescheduleUid?: string;
}

export interface CheckEoiBookingLimitsResult {
  allowed: boolean;
  violatedConstraint?: "student_daily" | "total_daily" | "student_global";
  currentUsage?: number;
  limit?: number;
  details?: {
    course: string;
    hourType: HourType;
    date: string;
  };
}