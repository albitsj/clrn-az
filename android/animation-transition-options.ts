/** 仅对 undefined 应用公开 API 的默认参数语义。
 * @param value - 调用参数。
 * @param fallback - 既有默认值。
 */
export function withDefault<T>(value: T | undefined, fallback: T): T { return value === undefined ? fallback : value; }

