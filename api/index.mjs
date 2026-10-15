// Vercel Function única com toda a API (Express): /api/*, autenticação e cron.
// Reexporta o build compilado (npm run build gera apps/api/dist antes de a
// Vercel empacotar esta função). A web é servida pela CDN (vercel.json).
export { default } from "../apps/api/dist/vercel.js";
