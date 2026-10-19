import { RedisService } from "@/modules/redis/redis.service";
import { Injectable, Logger } from "@nestjs/common";

import { cityTimezonesHandler } from "@calcom/platform-libraries";
import type { CityTimezones } from "@calcom/platform-libraries";

@Injectable()
export class TimezonesService {
  private readonly logger = new Logger("TimezonesService");
  private cacheKey = "cityTimezones";

  constructor(private readonly redisService: RedisService) {}

  async getCityTimeZones(): Promise<CityTimezones> {
    if (this.redisService.isReady) {
      try {
        const cachedTimezones = await this.redisService.redis.get(this.cacheKey);
        if (cachedTimezones) {
          return JSON.parse(cachedTimezones) as CityTimezones;
        }
      } catch (err) {
        this.logger.warn(`TimezonesService - Redis cache read failed, skipping cache: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const timezones = await cityTimezonesHandler();

    if (this.redisService.isReady) {
      try {
        await this.redisService.redis.set(this.cacheKey, JSON.stringify(timezones), "EX", 60 * 60 * 24);
      } catch (err) {
        this.logger.warn(`TimezonesService - Redis cache write failed, skipping cache: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return timezones;
  }
}
