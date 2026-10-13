import express from "express";

export const JSON_BODY_LIMIT = "16kb";

/** Parser JSON estrito (só objetos/arrays) com limite de 16 kB. */
export function jsonBodyParser() {
  return express.json({ limit: JSON_BODY_LIMIT, strict: true });
}
