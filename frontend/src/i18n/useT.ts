import { useLangStore } from "./store";
import { de, en } from "./translations";

const dict = { de, en };

export function useT() {
  const lang = useLangStore((s) => s.lang);
  return dict[lang];
}
