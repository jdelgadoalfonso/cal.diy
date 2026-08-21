import { z } from "zod";
import type { EoiConstraintsConfig } from "./types";

export const hourTypeSchema = z.enum(["lectiva", "tutorias"]);

export const eventTypeMappingSchema = z.object({
  course: z.string().min(1),
  hourType: hourTypeSchema,
});

export const dailyLimitsSchema = z.object({
  perStudentPerDay: z.number().int().positive().default(2),
  totalPerDay: z.number().int().positive().default(8),
});

export const studentMaxHoursSchema = z.record(
  z.string().email(),
  z.record(
    z.string().min(1),
    z.object({
      lectiva: z.number().int().nonnegative().optional(),
      tutorias: z.number().int().nonnegative().optional(),
    })
  )
);

export const eoiConstraintsConfigSchema = z.object({
  eventTypeMap: z.record(z.string(), eventTypeMappingSchema),
  dailyLimits: dailyLimitsSchema.optional(),
  studentMaxHours: studentMaxHoursSchema.optional(),
}).transform((data) => ({
  ...data,
  dailyLimits: data.dailyLimits ?? { perStudentPerDay: 2, totalPerDay: 8 },
  studentMaxHours: data.studentMaxHours ?? {},
}));

export type EoiConstraintsConfigSchema = z.infer<typeof eoiConstraintsConfigSchema>;

export function getDefaultConfig(): EoiConstraintsConfig {
  return {
    eventTypeMap: {},
    dailyLimits: { perStudentPerDay: 2, totalPerDay: 8 },
    studentMaxHours: {},
  };
}