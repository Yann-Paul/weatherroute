import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useT } from "@/i18n/useT";
import { COUNTRIES } from "@/utils/countries";

interface CountryComboboxProps {
  blockedCodes: string[];
  onToggle: (code: string) => void;
}

export function CountryCombobox({ blockedCodes, onToggle }: CountryComboboxProps) {
  const [query, setQuery] = useState("");
  const t = useT();
  const tc = t.advanced.blockedCountries;
  const lang = t.dateLocale === "de-DE" ? "de" : "en";

  const filtered =
    query.trim().length < 1
      ? []
      : COUNTRIES.filter(
          (c) =>
            c[lang].toLowerCase().includes(query.toLowerCase()) ||
            c.en.toLowerCase().includes(query.toLowerCase()) ||
            c.code.toLowerCase() === query.trim().toLowerCase()
        ).slice(0, 8);

  return (
    <Command shouldFilter={false} className="border rounded-md">
      <CommandInput
        placeholder={tc.customPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {query.trim().length < 1 ? tc.customTypeToSearch : tc.customNoResults}
        </CommandEmpty>
        <CommandGroup>
          {filtered.map((c) => (
            <CommandItem
              key={c.code}
              value={c.code}
              onSelect={() => {
                onToggle(c.code);
                setQuery("");
              }}
            >
              <Check
                className={cn(
                  "mr-2 h-4 w-4",
                  blockedCodes.includes(c.code) ? "opacity-100" : "opacity-0"
                )}
              />
              {c[lang]}
              <span className="ml-auto text-xs text-muted-foreground">{c.code}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
