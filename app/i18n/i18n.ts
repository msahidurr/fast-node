import en from "./locales/en.json";

// NFR-10: i18n scaffolding for a v1 that only ships English. Every string
// wired through here (currently just the app nav -- see app/routes/app.tsx)
// makes a future locale additive: drop a new locales/xx.json matching this
// shape and list it below, no rewrite of the routes that call t(). Full
// string coverage across every route is intentionally not done in this
// pass -- see Phase 7 flags.
const LOCALES: Record<string, Record<string, string>> = { en };

export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = Object.keys(LOCALES);

// Resolves the request's most-preferred language tag (from the standard
// Accept-Language header -- the offline sessions this app uses for
// background/merchant-admin requests don't carry a per-user locale the way
// an online session's associated_user would) to one we actually support.
export function resolveLocale(acceptLanguageHeader?: string | null): string {
  if (!acceptLanguageHeader) return DEFAULT_LOCALE;
  const firstTag = acceptLanguageHeader.split(",")[0]?.trim();
  const base = firstTag?.split("-")[0]?.toLowerCase();
  return base && SUPPORTED_LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}

export function translate(locale: string, key: string): string {
  const dict = LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE];
  return dict[key] ?? LOCALES[DEFAULT_LOCALE][key] ?? key;
}

export type Translator = (key: string) => string;

export function createTranslator(locale: string): Translator {
  return (key: string) => translate(locale, key);
}
