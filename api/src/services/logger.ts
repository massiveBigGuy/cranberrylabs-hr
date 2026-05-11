type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function emit(level: LogLevel, scope: string, msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = meta
    ? `${ts} ${level.toUpperCase()} [${scope}] ${msg} ${JSON.stringify(meta)}`
    : `${ts} ${level.toUpperCase()} [${scope}] ${msg}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', scope, msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => emit('info', scope, msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', scope, msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => emit('error', scope, msg, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;
