export const logger = {
    info: (msg: string, meta?: unknown) =>
        console.log(JSON.stringify({ level: "info", msg, meta, ts: new Date().toISOString() })),
    warn: (msg: string, meta?: unknown) =>
        console.warn(JSON.stringify({ level: "warn", msg, meta, ts: new Date().toISOString() })),
    error: (msg: string, meta?: unknown) =>
        console.error(JSON.stringify({ level: "error", msg, meta, ts: new Date().toISOString() })),
};