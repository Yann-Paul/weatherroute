import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Lang } from "./translations";

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

function applyLangToDocument(lang: Lang) {
  document.documentElement.lang = lang;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: "de" as Lang,
      setLang: (lang) => {
        applyLangToDocument(lang);
        set({ lang });
      },
    }),
    {
      name: "weatherroute-lang",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) applyLangToDocument(state.lang);
      },
    }
  )
);
