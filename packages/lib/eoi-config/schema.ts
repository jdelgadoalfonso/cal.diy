import { z } from "zod";
import type { EoiConstraintsConfig } from "./types";

export const hourTypeSchema: z.ZodEnum<["lectiva", "tutorias"]> = z.enum(["lectiva", "tutorias"]);

export const eventTypeMappingSchema: z.ZodObject<{
  course: z.ZodString;
  hourType: z.ZodEnum<["lectiva", "tutorias"]>;
}> = z.object({
  course: z.string().min(1),
  hourType: hourTypeSchema,
});

export const dailyLimitsSchema: z.ZodObject<{
  perStudentPerDay: z.ZodDefault<z.ZodNumber>;
  totalPerDay: z.ZodDefault<z.ZodNumber>;
}> = z.object({
  perStudentPerDay: z.number().int().positive().default(2),
  totalPerDay: z.number().int().positive().default(8),
});

export const studentMaxHoursSchema: z.ZodRecord<
  z.ZodString,
  z.ZodRecord<
    z.ZodString,
    z.ZodObject<{
      lectiva: z.ZodOptional<z.ZodNumber>;
      tutorias: z.ZodOptional<z.ZodNumber>;
    }>
  >
> = z.record(
  z.string().email(),
  z.record(
    z.string().min(1),
    z.object({
      lectiva: z.number().int().nonnegative().optional(),
      tutorias: z.number().int().nonnegative().optional(),
    })
  )
);

export const eoiConstraintsConfigSchema: z.ZodTransform<
  z.ZodObject<{
    eventTypeMap: z.ZodRecord<z.ZodString, z.ZodObject<{
      course: z.ZodString;
      hourType: z.ZodEnum<["lectiva", "tutorias"]>;
    }>>;
    dailyLimits: z.ZodOptional<z.ZodObject<{
      perStudentPerDay: z.ZodDefault<z.ZodNumber>;
      totalPerDay: z.ZodDefault<z.ZodNumber>;
    }>>;
    studentMaxHours: z.ZodOptional<z.ZodRecord<
      z.ZodString,
      z.ZodRecord<
        z.ZodString,
        z.ZodObject<{
          lectiva: z.ZodOptional<z.ZodNumber>;
          tutorias: z.ZodOptional<z.ZodNumber>;
        }>
      >
    >>;
  }>,
  EoiConstraintsConfig
> = z.object({
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