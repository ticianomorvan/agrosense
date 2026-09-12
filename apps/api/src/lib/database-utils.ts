import type { Json } from "./database.types";

export const json = <T>(value: Json): T => value as T;

export const iso = (value: string): string => new Date(value).toISOString();
