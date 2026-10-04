import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const pretty = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

export const logger = pino({
  level,
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
});
