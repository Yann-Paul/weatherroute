import { useState, useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { searchCities } from "@/api/client";
import { useT } from "@/i18n/useT";
import type { CitySearchResult } from "@/api/types";

interface CityComboboxProps {
  value: string;
  onSelect: (city: CitySearchResult) => void;
  placeholder?: string;
  className?: string;
}

export function CityCombobox({
  value,
  onSelect,
  placeholder,
  className,
}: CityComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CitySearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const t = useT();
  const effectivePlaceholder = placeholder ?? t.cityCombobox.placeholder;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchCities(query);
        setResults(data);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal", className)}
        >
          {value || effectivePlaceholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={effectivePlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {query.length < 2 ? t.cityCombobox.typeToSearch : t.cityCombobox.noResults}
            </CommandEmpty>
            <CommandGroup>
              {results.map((city) => (
                <CommandItem
                  key={city.id}
                  value={city.id}
                  onSelect={() => {
                    onSelect(city);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === city.name ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {city.name}
                  {city.country && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {city.country}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
