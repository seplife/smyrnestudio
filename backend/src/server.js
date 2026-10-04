import { buildApp } from "./app.js";

const port = Number(process.env.PORT || 8000);
const app = await buildApp({ logger: { level: process.env.LOG_LEVEL || "info" }, resume: process.env.CHOIR_RESUME !== "0" });
try {
  await app.listen({ port, host: process.env.HOST || "0.0.0.0" });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
