import { createContainer, type Container } from "@calcom/features/di/di";
import {
  type CheckEoiBookingLimitsService,
  moduleLoader as checkEoiBookingLimitsModule,
} from "./CheckEoiBookingLimits.module";

const checkEoiBookingLimitsContainer: Container = createContainer();

export function getCheckEoiBookingLimitsService(): CheckEoiBookingLimitsService {
  checkEoiBookingLimitsModule.loadModule(checkEoiBookingLimitsContainer);

  return checkEoiBookingLimitsContainer.get<CheckEoiBookingLimitsService>(checkEoiBookingLimitsModule.token);
}