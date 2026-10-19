import { Module } from "@nestjs/common";
import { AppModule } from "../app.module";

/**
 * ServerlessAppModule re-exports AppModule so that the same NestJS application
 * can be bootstrapped both locally (via main.ts) and on Vercel (via a serverless
 * function entrypoint). All Redis/Bull/Throttler conditional logic already lives
 * inside AppModule based on the REDIS_URL and VERCEL environment variables.
 */
@Module({
  imports: [AppModule],
})
export class ServerlessAppModule {}
