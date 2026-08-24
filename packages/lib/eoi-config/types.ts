export type HourType = "lectiva" | "tutorias";

export interface EventTypeMapping {
  course: string;
  hourType: HourType;
}

export interface DailyLimits {
  perStudentPerDay: number;
}

export interface StudentMaxHours {
  [email: string]: {
    [course: string]: {
      lectiva?: number;
      tutorias?: number;
    };
  };
}

export interface EoiConstraintsConfig {
  eventTypeMap: Record<string, EventTypeMapping>;
  dailyLimits: DailyLimits;
  studentMaxHours: StudentMaxHours;
}