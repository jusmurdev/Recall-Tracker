import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  CONNECTOR_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i).optional(),

  OPENFDA_API_KEY: z.string().optional(),
  OPENFDA_ENDPOINTS: z.string().default("food,drug,device"),
  INGEST_CRON_FDA: z.string().default("15 */4 * * *"),
  INGEST_CRON_FSIS: z.string().default("5 */2 * * *"),
  INGEST_CRON_CPSC: z.string().default("35 */6 * * *"),
  INGEST_BACKFILL_DAYS: z.coerce.number().int().min(1).max(3650).default(120),
  INGEST_USE_FIXTURES: z
    .string()
    .default("0")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),

  RESTAURANT_RESEARCH_TTL_DAYS: z.coerce.number().int().min(1).default(90),
  RESTAURANT_RESEARCH_MIN_REFRESH_DAYS: z.coerce.number().int().min(0).default(7),
  GRADE_REFRESH_DAYS: z.coerce.number().int().min(1).default(7),
  PROFILE_PRUNE_DAYS: z.coerce.number().int().min(1).default(180),
  MAINTENANCE_CRON: z.string().default("20 6 * * *"),

  EXPO_ACCESS_TOKEN: z.string().optional(),

  /** Default provider for premium AI features; others in AI_PROVIDER_FALLBACKS are tried when needed. */
  AI_PROVIDER: z.enum(["anthropic", "openai", "gemini", "openai-compatible"]).default("anthropic"),
  AI_PROVIDER_FALLBACKS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter((s): s is "anthropic" | "openai" | "gemini" | "openai-compatible" => ["anthropic", "openai", "gemini", "openai-compatible"].includes(s))),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  /** Any OpenAI-compatible chat endpoint (Ollama: http://localhost:11434/v1, Groq, Together…). */
  AI_COMPAT_BASE_URL: z.string().url().optional(),
  AI_COMPAT_MODEL: z.string().optional(),
  AI_COMPAT_API_KEY: z.string().optional(),
  AI_COMPAT_VISION: z
    .string()
    .default("0")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().default(50),

  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof Env>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: reset the cache after mutating process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export function openFdaEndpoints(): Array<"food" | "drug" | "device"> {
  return env()
    .OPENFDA_ENDPOINTS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is "food" | "drug" | "device" => s === "food" || s === "drug" || s === "device");
}
