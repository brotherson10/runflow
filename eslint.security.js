// Restrições anti-XSS para o código da aplicação. Conteúdo do utilizador é
// renderizado como texto (React/textContent); APIs que interpretam HTML são proibidas.

const HTML_SINK_MESSAGE =
  "Interpreta HTML e abre caminho a XSS. Use React/textContent para renderizar texto.";

/** @type {import("eslint").Linter.RulesRecord} */
export const securityRules = {
  "no-restricted-properties": [
    "error",
    { property: "innerHTML", message: HTML_SINK_MESSAGE },
    { property: "outerHTML", message: HTML_SINK_MESSAGE },
    { property: "insertAdjacentHTML", message: HTML_SINK_MESSAGE },
    { object: "document", property: "write", message: HTML_SINK_MESSAGE },
    { object: "document", property: "writeln", message: HTML_SINK_MESSAGE },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
      message: HTML_SINK_MESSAGE,
    },
    {
      selector: "Property[key.name='dangerouslySetInnerHTML']",
      message: HTML_SINK_MESSAGE,
    },
    {
      selector: "MemberExpression[computed=true][property.value=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]",
      message: HTML_SINK_MESSAGE,
    },
  ],
};
