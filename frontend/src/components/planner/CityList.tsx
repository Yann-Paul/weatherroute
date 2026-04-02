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
import { GripVertical, X, Plus, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { CityCombobox } from "./CityCombobox";
import { usePlannerStore } from "@/stores/plannerStore";
import { useT } from "@/i18n/useT";
import type { CitySearchResult } from "@/api/types";

function SortableCityRow({ index }: { index: number }) {
  const city = usePlannerStore((s) => s.cities[index]);
  const updateCity = usePlannerStore((s) => s.updateCity);
  const removeCity = usePlannerStore((s) => s.removeCity);
  const t = useT();
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
        aria-label={t.cityList.dragLabel}
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

      <div className="flex flex-col items-center gap-0.5" title={t.cityList.pauseTitle}>
        <NumericInput
          min={0}
          max={30}
          value={city.restDays}
          fallback={0}
          onChange={(v) => updateCity(index, { restDays: v })}
          className="w-16 text-center"
          aria-label={t.cityList.pauseLabel}
        />
        <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground leading-none">
          <Pause className="h-2.5 w-2.5" />{t.cityList.pauseLabel}
        </span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => removeCity(index)}
        aria-label={t.cityList.removeLabel}
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
  const t = useT();

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
        {t.cityList.addCity}
      </Button>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Pause className="h-3 w-3 shrink-0" />{t.cityList.helpText}
      </p>
    </div>
  );
}
