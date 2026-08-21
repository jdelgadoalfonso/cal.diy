import { CheckEoiBookingLimitsService } from "@calcom/features/bookings/lib/checkEoiBookingLimits";
import { bindModuleToClassOnToken, createModule, type Module, type ModuleLoader, type Token } from "@calcom/features/di/di";
import { DI_TOKENS } from "@calcom/features/di/tokens";

const thisModule: Module = createModule();
const token: Token = DI_TOKENS.CHECK_EOI_BOOKING_LIMITS_SERVICE;
const moduleToken: Token = DI_TOKENS.CHECK_EOI_BOOKING_LIMITS_SERVICE_MODULE;

const loadModule: ModuleLoader = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token,
  classs: CheckEoiBookingLimitsService,
  depsMap: {},
});

export const moduleLoader: ModuleLoader = {
  token,
  loadModule,
};

export type { CheckEoiBookingLimitsService };