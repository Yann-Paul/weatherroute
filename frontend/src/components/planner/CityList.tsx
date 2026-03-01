import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CityCombobox } from "./CityCombobox";
import { usePlannerStore } from "@/stores/plannerStore";
import type { CitySearchResult } from "@/api/types";

function SortableCityRow({ index }: { index: number }) {
  const city = usePlannerStore((s) => s.cities[index]);
  const updateCity = usePlannerStore((s) => s.updateCity);
  const removeCity = usePlannerStore((s) => s.removeCity);
  const itemId = `city-${index}`;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: itemId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-border bg-background p-2"
    >
      <button
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {index + 1}
      </span>

      <CityCombobox
        value={city.name}
        onSelect={(c: CitySearchResult) =>
          updateCity(index, { id: c.id, name: c.name })
        }
        className="flex-1"
      />

      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={30}
          value={city.restDays}
          onChange={(e) =>
            updateCity(index, { restDays: parseInt(e.target.value) || 0 })
          }
          className="w-16 text-center"
          aria-label="Rest days"
        />
        <span className="text-xs text-muted-foreground">days</span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => removeCity(index)}
        aria-label="Remove city"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function CityList() {
  const cities = usePlannerStore((s) => s.cities);
  const addCity = usePlannerStore((s) => s.addCity);
  const reorderCities = usePlannerStore((s) => s.reorderCities);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const items = cities.map((_, i) => `city-${i}`);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.indexOf(active.id as string);
      const newIndex = items.indexOf(over.id as string);
      reorderCities(oldIndex, newIndex);
    }
  }

  return (
    <div className="space-y-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {cities.map((_, i) => (
            <SortableCityRow key={`city-${i}`} index={i} />
          ))}
        </SortableContext>
      </DndContext>

      <Button
        variant="outline"
        size="sm"
        onClick={() => addCity({ id: "", name: "", restDays: 0 })}
        className="w-full"
      >
        <Plus className="mr-2 h-4 w-4" />
        Add city
      </Button>
    </div>
  );
}
