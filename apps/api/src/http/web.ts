/**
 * Build da web servido pelo Express, na mesma origem da API.
 *
 * - A pasta é validada no arranque (absoluta, existente, com index.html), por isso
 *   um caminho errado falha logo e não depende da pasta de onde o processo arranca.
 * - Ficheiros estáticos: `/assets/*` (nomes com hash) com cache longa e imutável;
 *   o resto com `no-cache`. Sem listagens, sem dotfiles e sem redirecionamentos.
 * - Fallback SPA (index.html) só em GET/HEAD de PÁGINAS: nunca em `/api` (qualquer
 *   capitalização) nem em caminhos com extensão (um asset inexistente dá 404).
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, sep } from "node:path";
import express, { type Router } from "express";

export const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const PAGE_CACHE_CONTROL = "no-cache";

export interface WebBuild {
  readonly dir: string;
  readonly indexHtml: Buffer;
}

/** Valida e carrega o build. Lança com uma mensagem clara se estiver em falta. */
export function loadWebBuild(distDir: string): WebBuild {
  if (!isAbsolute(distDir)) throw new Error("A pasta do build da web tem de ser um caminho absoluto.");
  let dir: string;
  try {
    dir = realpathSync(distDir);
  } catch {
    throw new Error(`Build da web não encontrado em ${distDir}. Corra npm run build.`);
  }
  const indexPath = join(dir, "index.html");
  let isFile: boolean;
  try {
    isFile = statSync(indexPath).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) throw new Error(`Build da web sem index.html em ${dir}. Corra npm run build.`);
  return { dir, indexHtml: readFileSync(indexPath) };
}

function isApiPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === "/api" || lower.startsWith("/api/");
}

export function createWebRouter(build: WebBuild): Router {
  const router = express.Router();
  const assetsDir = join(build.dir, "assets") + sep;

  router.use(
    express.static(build.dir, {
      index: false,
      redirect: false,
      dotfiles: "ignore",
      fallthrough: true,
      setHeaders: (res, filePath) => {
        res.setHeader("Cache-Control", filePath.startsWith(assetsDir) ? ASSET_CACHE_CONTROL : PAGE_CACHE_CONTROL);
      },
    }),
  );

  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (isApiPath(req.path) || extname(req.path) !== "") {
      next();
      return;
    }
    res.setHeader("Cache-Control", PAGE_CACHE_CONTROL);
    res.type("html").send(build.indexHtml);
  });

  return router;
}
