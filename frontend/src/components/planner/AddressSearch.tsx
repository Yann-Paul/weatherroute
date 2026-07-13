import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
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
import { searchAddresses } from "@/api/client";
import { useT } from "@/i18n/useT";
import { useLangStore } from "@/i18n/store";
import type { GeocodeResult } from "@/api/types";

/** Free-text address/place search (Photon geocoder) for the route planner. */
export function AddressSearch({
  onSelect,
  className,
}: {
  onSelect: (result: GeocodeResult) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const t = useT();
  const rs = t.routePlanner.search;
  const lang = useLangStore((s) => s.lang);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchAddresses(query, lang);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, lang]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-start gap-2 font-normal text-muted-foreground", className)}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">{rs.placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] max-w-[92vw] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={rs.placeholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {query.trim().length < 3 ? (
                rs.typeToSearch
              ) : loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {rs.searching}
                </span>
              ) : (
                rs.noResults
              )}
            </CommandEmpty>
            <CommandGroup>
              {results.map((r, i) => (
                <CommandItem
                  key={`${r.label}-${i}`}
                  value={`${r.label}-${i}`}
                  onSelect={() => {
                    onSelect(r);
                    setOpen(false);
                    setQuery("");
                    setResults([]);
                  }}
                >
                  <MapPin className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{r.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
