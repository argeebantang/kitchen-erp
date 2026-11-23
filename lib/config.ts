function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `[Config] Missing required environment variable: ${key}\n` +
      `Copy .env.example to .env and fill in the values.`
    )
  }
  return value
}

/** A dollar amount from the environment, kept as a string for Decimal; a malformed one fails fast like a missing required one. */
function usdEnv(key: string, fallback: string): string {
  const value = process.env[key] || fallback
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(`[Config] ${key} must be a dollar amount such as 20 or 12.50, got "${value}"`)
  }
  return value
}

/** A clock time "HH:MM" (24-hour) from the environment; a malformed one fails fast. */
function timeEnv(key: string, fallback: string): string {
  const value = process.env[key] || fallback
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`[Config] ${key} must be a 24-hour time such as 15:00, got "${value}"`)
  }
  return value
}

export const config = {
  databaseUrl:  requireEnv('DATABASE_URL'),
  redisUrl:     requireEnv('REDIS_URL'),
  jwtSecret:    requireEnv('JWT_SECRET'),
  appUrl:       requireEnv('NEXT_PUBLIC_APP_URL'),
  // Optional (Week 9 Task 1, D2): without a key the AI features say "not set
  // up" and the rest of the app runs. Required would break the CI build and
  // every machine that has no key.
  anthropicApiKey:    process.env.ANTHROPIC_API_KEY || null,
  // The app's own monthly AI budget (D5) — a soft cap below the hard spend
  // limit set on the Anthropic Console workspace.
  aiMonthlyBudgetUsd: usdEnv('AI_MONTHLY_BUDGET_USD', '20'),
  // Optional (Week 9 Task 3, F3): the read-only kitchen_ai_reader login the
  // assistant's run_query tool uses. Without it the assistant still answers
  // cost questions; it just is not offered run_query.
  aiDatabaseUrl:      process.env.AI_DATABASE_URL || null,
  // Week 9 Task 10: stock requests for a day are due by this time (Manila) the
  // day before; later ones are accepted but flagged Late.
  stockRequestCutoff: timeEnv('STOCK_REQUEST_CUTOFF', '15:00'),
  // Optional (Week 11 Task 2): email through Resend. Without a key every email
  // is skipped (EmailLog SKIPPED) and the in-app bell works as before.
  resendApiKey:       process.env.RESEND_API_KEY || null,
  // Who emails come from. Until a domain is verified in Resend, only its
  // onboarding sender works, and it delivers only to the Resend account's own
  // address.
  emailFrom:          process.env.EMAIL_FROM || 'KitchenERP <onboarding@resend.dev>',
  nodeEnv:      process.env.NODE_ENV ?? 'development',
  isProd:       process.env.NODE_ENV === 'production',
  isDev:        process.env.NODE_ENV !== 'production',
} as const
