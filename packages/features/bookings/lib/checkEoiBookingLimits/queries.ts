import { Prisma } from "@calcom/prisma/client";
import prisma from "@calcom/prisma";
import dayjs from "@calcom/dayjs";

interface BookingAggregateParams {
  attendeeEmail?: string;
  eventTypeIds: number[];
  startDate: Date;
  endDate: Date;
  excludeUid?: string;
  statuses?: string[];
}

/**
 * Gets the sum of booking durations (in hours) for the given parameters.
 * Only counts ACCEPTED bookings by default.
 */
export async function getBookingsDurationSum(params: BookingAggregateParams): Promise<number> {
  const {
    attendeeEmail,
    eventTypeIds,
    startDate,
    endDate,
    excludeUid,
    statuses = ["ACCEPTED"],
  } = params;
  
  console.log("DEBUG QUERY getBookingsDurationSum params:", { attendeeEmail, eventTypeIds, startDate, endDate, excludeUid });

  const where: Prisma.BookingWhereInput = {
    eventTypeId: { in: eventTypeIds },
    startTime: { gte: startDate, lt: endDate },
    status: { in: statuses },
    ...(excludeUid && { uid: { not: excludeUid } }),
    ...(attendeeEmail && {
      attendees: { some: { email: attendeeEmail } },
    }),
  };

  const bookings = await prisma.booking.findMany({
    where,
    select: { startTime: true, endTime: true },
  });
  console.log("DEBUG QUERY findMany result:", bookings);

  return bookings.reduce((sum, b) => {
    const duration = dayjs(b.endTime).diff(b.startTime, "minutes") / 60;
    return sum + duration;
  }, 0);
}

/**
 * Gets the total hours booked by a student across all time for the given event types.
 * Only counts ACCEPTED bookings.
 */
export async function getStudentGlobalHours(
  attendeeEmail: string,
  eventTypeIds: number[],
  excludeUid?: string
): Promise<number> {
  const where: Prisma.BookingWhereInput = {
    eventTypeId: { in: eventTypeIds },
    status: "ACCEPTED",
    ...(excludeUid && { uid: { not: excludeUid } }),
    attendees: { some: { email: attendeeEmail } },
  };

  const bookings = await prisma.booking.findMany({
    where,
    select: { startTime: true, endTime: true },
  });
  console.log("DEBUG QUERY findMany result:", bookings);

  return bookings.reduce((sum, b) => {
    const duration = dayjs(b.endTime).diff(b.startTime, "minutes") / 60;
    return sum + duration;
  }, 0);
}