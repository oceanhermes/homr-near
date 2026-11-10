/**
 * NEP-297 (`EVENT_JSON:`) log parsing.
 *
 * Kept free of DB/config imports so it can be unit-tested in isolation.
 */

export interface Nep297Event {
    standard: string;
    version: string;
    event: string;
    data: Record<string, unknown> | Array<Record<string, unknown>>;
}

const PREFIX = "EVENT_JSON:";

/**
 * B8/C1: the log must start with the `EVENT_JSON:` prefix and the remainder
 * must be a valid JSON object string *before* we touch it with JSON.parse.
 * The `data` member must itself be a JSON object (or array of objects) —
 * bare strings/numbers/null are rejected so downstream consumers can assume
 * structured payloads.
 */
export function parseNep297Log(log: string): Nep297Event | null {
    if (!log.startsWith(PREFIX)) return null;

    // Validate the remainder is a JSON object *string* before parsing.
    const jsonStr = log.slice(PREFIX.length).trim();
    if (jsonStr.length === 0) return null;
    if (jsonStr.charCodeAt(0) !== 0x7b /* '{' */) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        // Not valid JSON — ignore the log entirely.
        return null;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;

    if (typeof obj.standard !== "string" || obj.standard.length === 0) return null;
    if (typeof obj.event !== "string" || obj.event.length === 0) return null;

    const data = obj.data;
    let dataOk = typeof data === "object" && data !== null;
    if (Array.isArray(data)) {
        dataOk = data.every((entry) => typeof entry === "object" && entry !== null);
    }
    if (!dataOk) return null;

    return {
        standard: obj.standard,
        version: typeof obj.version === "string" ? obj.version : "",
        event: obj.event,
        data: data as Nep297Event["data"],
    };
}
