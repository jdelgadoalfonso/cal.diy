import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { BullModule } from "@nestjs/bull";
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { seconds, ThrottlerModule } from "@nestjs/throttler";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { AppController } from "./app.controller";
import appConfig from "@/config/app";
import { CustomThrottlerGuard } from "@/lib/throttler-guard";
import { AppLoggerMiddleware } from "@/middleware/app.logger.middleware";
import { RedirectsMiddleware } from "@/middleware/app.redirects.middleware";
import { RewriterMiddleware } from "@/middleware/app.rewrites.middleware";
import { JsonBodyMiddleware } from "@/middleware/body/json.body.middleware";
import { RawBodyMiddleware } from "@/middleware/body/raw.body.middleware";
import { UrlencodedBodyMiddleware } from "@/middleware/body/urlencoded.body.middleware";
import { ResponseInterceptor } from "@/middleware/request-ids/request-id.interceptor";
import { RequestIdMiddleware } from "@/middleware/request-ids/request-id.middleware";
import { AuthModule } from "@/modules/auth/auth.module";
import { EndpointsModule } from "@/modules/endpoints.module";
import { JwtModule } from "@/modules/jwt/jwt.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { RedisModule } from "@/modules/redis/redis.module";
import { RedisService } from "@/modules/redis/redis.service";
import { VercelWebhookController } from "@/vercel-webhook.controller";

const isServerless = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const redisAvailable = !!process.env.REDIS_URL;

class ThrottlerStorageMockService {
  public redis = {
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
    getKeys: async () => [],
    expire: async () => 0,
    lrange: async () => [],
    lpush: async () => 0,
    incr: async () => 0,
    hmset: async () => "OK",
    expireat: async () => 1,
    hgetall: async () => ({}),
    setex: async () => "OK",
    keys: async () => [],
    quit: async () => undefined,
  };

  async getRecord(key: string): Promise<{ value: string; timestamp: number } | null> {
    return null;
  }

  async setRecord(key: string, value: string, ttl: number): Promise<void> {
    // no-op in mock
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    name: string
  ): Promise<{
    isBlocked: boolean;
    totalHits: number;
    timeToExpire: number | null;
    timeToBlockExpire: number | null;
  }> {
    // In-memory fallback: never block, always allow
    return {
      isBlocked: false,
      totalHits: 1,
      timeToExpire: ttl,
      timeToBlockExpire: null,
    };
  }
}

const conditionalImports = [
  SentryModule.forRoot(),
  ConfigModule.forRoot({
    ignoreEnvFile: true,
    isGlobal: true,
    load: [appConfig],
  }),

  ...(redisAvailable ? [RedisModule] : []),
  ...(redisAvailable && !isServerless
    ? [
        BullModule.forRoot({
          redis: `${process.env.REDIS_URL}${process.env.NODE_ENV === "production" ? "?tls=true" : ""}`,
        }),
      ]
    : []),
  ...(redisAvailable
    ? [
        ThrottlerModule.forRootAsync({
          imports: [RedisModule],
          inject: [RedisService],
          useFactory: (redisService: RedisService) => ({
            throttlers: [
              {
                name: "dummy",
                ttl: seconds(60),
                limit: 120,
              },
            ],
            storage: new ThrottlerStorageRedisService(redisService.redis),
          }),
        }),
      ]
    : [
        ThrottlerModule.forRoot({
          throttlers: [
            {
              name: "dummy",
              ttl: 60,
              limit: 120,
            },
          ],
        }),
      ]),
  PrismaModule,
  EndpointsModule,
  AuthModule,
  JwtModule,
];

const conditionalProviders = [
  {
    provide: APP_FILTER,
    useClass: SentryGlobalFilter,
  },
  ...(redisAvailable
    ? [
        {
          provide: ThrottlerStorageRedisService,
          useFactory: (redisService: RedisService) => {
            return new ThrottlerStorageRedisService(redisService.redis);
          },
          inject: [RedisService],
        },
      ]
    : [
        {
          provide: ThrottlerStorageRedisService,
          useFactory: () => {
            const mock: ThrottlerStorageMockService = new ThrottlerStorageMockService();
            return mock as unknown as ThrottlerStorageRedisService;
          },
        },
      ]),
  {
    provide: APP_INTERCEPTOR,
    useClass: ResponseInterceptor,
  },
  {
    provide: APP_GUARD,
    useClass: CustomThrottlerGuard,
  },
];

@Module({
  imports: conditionalImports as any,
  controllers: [AppController, VercelWebhookController],
  providers: conditionalProviders as any,
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RawBodyMiddleware)
      .forRoutes(
        {
          path: "/api/v2/billing/webhook",
          method: RequestMethod.POST,
        },
        {
          path: "/v2/billing/webhook",
          method: RequestMethod.POST,
        },
        {
          path: "/v2/webhooks/vercel/deployment-promoted",
          method: RequestMethod.POST,
        }
      )
      .apply(UrlencodedBodyMiddleware)
      .forRoutes(
        {
          path: "/v2/auth/oauth2/token",
          method: RequestMethod.POST,
        },
        {
          path: "/api/v2/auth/oauth2/token",
          method: RequestMethod.POST,
        }
      )
      .apply(JsonBodyMiddleware)
      .forRoutes("*")
      .apply(RequestIdMiddleware)
      .forRoutes("*")
      .apply(AppLoggerMiddleware)
      .forRoutes("*")
      .apply(RedirectsMiddleware)
      .forRoutes("/")
      .apply(RewriterMiddleware)
      .forRoutes("/");
  }
}
