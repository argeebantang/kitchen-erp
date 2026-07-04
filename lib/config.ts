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

export const config = {
  databaseUrl:  requireEnv('DATABASE_URL'),
  redisUrl:     requireEnv('REDIS_URL'),
  jwtSecret:    requireEnv('JWT_SECRET'),
  appUrl:       requireEnv('NEXT_PUBLIC_APP_URL'),
  nodeEnv:      process.env.NODE_ENV ?? 'development',
  isProd:       process.env.NODE_ENV === 'production',
  isDev:        process.env.NODE_ENV !== 'production',
} as const
