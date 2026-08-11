import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"

import { en, zhCN } from "./resources"

export const supportedLanguages = ["zh-CN", "en"] as const
export type AppLanguage = (typeof supportedLanguages)[number]
export const languageStorageKey = "codex-router-language"

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "zh-CN": { translation: zhCN },
      en: { translation: en },
    },
    fallbackLng: "zh-CN",
    supportedLngs: supportedLanguages,
    nonExplicitSupportedLngs: true,
    keySeparator: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: languageStorageKey,
    },
  })

function syncDocumentLanguage(language: string) {
  document.documentElement.lang = language.startsWith("en") ? "en" : "zh-CN"
}

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language)
i18n.on("languageChanged", syncDocumentLanguage)

export default i18n
