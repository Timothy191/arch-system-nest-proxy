/**
 * Minimal structured JSON logger (no external dependency).
 * Emits one JSON object per line so Vercel/log aggregators can parse it.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    service: 'arch-system-nest-proxy',
    ...fields,
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

const silenced = new WeakSet<object>();

/**
 * Attaches a single logging `error` listener to an ioredis/BullMQ emitter so
 * connection rejections never become uncaught exceptions. Repeated calls for
 * the same emitter are no-ops (deduplicated via WeakSet).
 */
export function silenceErrorListeners(emitter: any, label: string): void {
  if (!emitter || typeof emitter.on !== 'function') return;
  if (silenced.has(emitter)) return;
  silenced.add(emitter);
  emitter.on('error', (err: any) => {
    log('warn', 'redis_connection_error', {
      label,
      err: err?.message ?? String(err),
    });
  });
}
