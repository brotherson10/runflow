import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { securityRules } from "../eslint.security.js";

// Aplica exatamente as regras de segurança do projeto, sem regras de tipos,
// para verificar que cada padrão perigoso é bloqueado.
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      rules: securityRules,
    },
  ],
});

async function ruleIds(code: string, filePath = "probe.tsx"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? "fatal");
}

describe("restrições anti-XSS do ESLint", () => {
  it.each([
    ["innerHTML (escrita)", "el.innerHTML = userText;"],
    ["innerHTML (computado)", 'el["innerHTML"] = userText;'],
    ["outerHTML", "el.outerHTML = userText;"],
    ["insertAdjacentHTML", 'el.insertAdjacentHTML("beforeend", userText);'],
    ["document.write", "document.write(userText);"],
  ])("bloqueia %s", async (_label, code) => {
    const ids = await ruleIds(`declare const el: HTMLElement; declare const userText: string;\n${code}`);
    expect(ids.some((id) => id.startsWith("no-restricted"))).toBe(true);
  });

  it("bloqueia dangerouslySetInnerHTML em JSX", async () => {
    const ids = await ruleIds(
      "export const X = (p: { html: string }) => <div dangerouslySetInnerHTML={{ __html: p.html }} />;",
    );
    expect(ids).toContain("no-restricted-syntax");
  });

  it("bloqueia dangerouslySetInnerHTML passado como objeto de props", async () => {
    const ids = await ruleIds(
      'export const props = { dangerouslySetInnerHTML: { __html: "<b>x</b>" } };',
      "probe.ts",
    );
    expect(ids).toContain("no-restricted-syntax");
  });

  it("permite textContent e texto em JSX", async () => {
    const ids = await ruleIds(
      "declare const el: HTMLElement; declare const userText: string;\n" +
        "el.textContent = userText;\n" +
        "export const X = () => <p>{userText}</p>;",
    );
    expect(ids).toEqual([]);
  });
});
