import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { ServerlessAppModule } from "./app.module";
import { bootstrap } from "../bootstrap";

export async function createServerlessApp() {
  const app = await NestFactory.create<NestExpressApplication>(ServerlessAppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });

  bootstrap(app);
  await app.init();
  return app;
}

let cachedApp: NestExpressApplication | null = null;

export async function getServerlessApp() {
  if (!cachedApp) {
    cachedApp = await createServerlessApp();
  }
  return cachedApp;
}
