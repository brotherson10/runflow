// Amostras partilhadas pelos testes de contagem de caracteres: as mesmas strings
// são verificadas no JavaScript (code points) e no PostgreSQL (char_length).
export const UNICODE_SAMPLES = [
  { label: "ASCII", value: "abc", codePoints: 3 },
  { label: "é composto (NFC, U+00E9)", value: "é", codePoints: 1 },
  { label: "é decomposto (e + U+0301)", value: "é", codePoints: 2 },
  { label: "emoji fora do BMP", value: "🏃", codePoints: 1 },
  { label: "emoji com tom de pele", value: "🏃🏽", codePoints: 2 },
  { label: "família com ZWJ", value: "👨‍👩‍👧", codePoints: 5 },
  { label: "bandeira (2 indicadores regionais)", value: "🇵🇹", codePoints: 2 },
  { label: "corredora com ZWJ e seletor", value: "🏃‍♀️", codePoints: 4 },
] as const;
