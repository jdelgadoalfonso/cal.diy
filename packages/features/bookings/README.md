# Bookings

This package contains all booking-related functionality for cal.diy.

## EOI Booking Constraints

EOI (Escuela de Organización Industrial) booking constraints allow administrators to limit bookings based on:

1. **Per-student daily limits** - Maximum hours a single student can book per day for a specific course/hour type
2. **Total daily limits** - Maximum total hours across all students per day for a specific course/hour type
3. **Student global limits** - Maximum cumulative hours a specific student can book across all time for a specific course/hour type

### Configuration

Create an `eoi-constraints.yaml` file at the root of cal.diy (next to package.json) or in `config/`. See `eoi-constraints.yaml.example` for a documented example.

```yaml
eventTypeMap:
  "1":
    course: "Programación Web"
    hourType: "lectiva"
  "2":
    course: "Programación Web"
    hourType: "tutorias"
dailyLimits:
  perStudentPerDay: 2
  totalPerDay: 8
studentMaxHours:
  "alumno@eoi.es":
    "Programación Web":
      lectiva: 20
      tutorias: 10
```

### Key Concepts

- **eventTypeMap**: Maps cal.diy eventTypeId (as string) to course name and hour type ("lectiva" or "tutorias")
- **dailyLimits.perStudentPerDay**: Max hours one student can book per day for the same course+hourType combination
- **dailyLimits.totalPerDay**: Max total hours across all students per day for the same course+hourType combination
- **studentMaxHours**: Optional per-student limits per course per hourType

### How It Works

1. When a booking is created, the system checks if the event type is mapped in `eventTypeMap`
2. If mapped, it finds all event types with the same course+hourType
3. It then checks three constraints in order:
   - Student daily limit (for that specific student)
   - Total daily limit (across all students)
   - Student global limit (if configured for that student)
4. If any limit is exceeded, a 403 error is thrown with a descriptive message
5. Reschedule operations exclude the rescheduled booking from limit calculations

### Testing

Run unit tests:
```bash
yarn test packages/lib/eoi-config/__tests__
yarn test packages/features/bookings/lib/checkEoiBookingLimits/CheckEoiBookingLimitsService.test.ts
```

### Integration Points

- `CheckEoiBookingLimitsService` - Main validation service
- Integrated into `RegularBookingService` after `checkBookingAndDurationLimits`
- Validates both primary attendee (booker) and guest attendees
- Uses DI container: `getCheckEoiBookingLimitsService()`