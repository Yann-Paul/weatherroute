import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CityCombobox } from "./CityCombobox";
import { usePlannerStore } from "@/stores/plannerStore";
import type { CitySearchResult } from "@/api/types";

export function ConnectionList() {
  const connections = usePlannerStore((s) => s.connections);
  const addConnection = usePlannerStore((s) => s.addConnection);
  const removeConnection = usePlannerStore((s) => s.removeConnection);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Direct connections (flights, trains, ferries) between cities that should
        be routed without roads.
      </p>

      {connections.map((conn, i) => (
        <div key={i} className="flex items-center gap-2">
          <CityCombobox
            value={conn.fromName}
            onSelect={(c: CitySearchResult) => {
              const updated = [...connections];
              updated[i] = { ...conn, fromId: c.id, fromName: c.name };
              usePlannerStore.setState({ connections: updated });
            }}
            placeholder="From..."
            className="flex-1"
          />
          <span className="text-muted-foreground">→</span>
          <CityCombobox
            value={conn.toName}
            onSelect={(c: CitySearchResult) => {
              const updated = [...connections];
              updated[i] = { ...conn, toId: c.id, toName: c.name };
              usePlannerStore.setState({ connections: updated });
            }}
            placeholder="To..."
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => removeConnection(i)}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          addConnection({ fromId: "", fromName: "", toId: "", toName: "" })
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        Add connection
      </Button>
    </div>
  );
}
