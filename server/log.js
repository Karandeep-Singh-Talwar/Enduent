// Minimal structured logger. Never pass the API key or request headers in here.

/**
 * @param {NodeJS.WriteStream} stream
 * @param {string} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
function write(stream, level, message, meta) {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  stream.write(`${new Date().toISOString()} ${level} ${message}${suffix}\n`);
}

export const log = Object.freeze({
  info: (message, meta) => write(process.stdout, 'INFO ', message, meta),
  error: (message, meta) => write(process.stderr, 'ERROR', message, meta),
});
