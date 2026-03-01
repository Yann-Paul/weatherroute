import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ConnectionList } from "./ConnectionList";
import { usePlannerStore } from "@/stores/plannerStore";
import { PRESET_BLOCKED_COUNTRIES } from "@/utils/constants";

export function AdvancedPanel() {
  const store = usePlannerStore();

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="flex w-full items-center justify-between p-4 text-sm font-medium"
        >
          Advanced Settings
          <ChevronDown className="h-4 w-4 transition-transform [[data-state=open]_&]:rotate-180" />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 px-1">
        {/* Direct Connections */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Direct Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <ConnectionList />
          </CardContent>
        </Card>

        {/* Temperature Preferences */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Temperature Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Desired day temp (°C)</Label>
                <Input
                  type="number"
                  value={store.desiredDayTemp}
                  onChange={(e) =>
                    store.setTemp("desiredDayTemp", Number(e.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Desired night temp (°C)</Label>
                <Input
                  type="number"
                  value={store.desiredNightTemp}
                  onChange={(e) =>
                    store.setTemp("desiredNightTemp", Number(e.target.value))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Day temp range: {store.dayTempMin}°C — {store.dayTempMax}°C
              </Label>
              <Slider
                min={-20}
                max={50}
                step={1}
                value={[store.dayTempMin, store.dayTempMax]}
                onValueChange={([min, max]) => {
                  store.setTemp("dayTempMin", min);
                  store.setTemp("dayTempMax", max);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Night temp range: {store.nightTempMin}°C — {store.nightTempMax}°C
              </Label>
              <Slider
                min={-30}
                max={40}
                step={1}
                value={[store.nightTempMin, store.nightTempMax]}
                onValueChange={([min, max]) => {
                  store.setTemp("nightTempMin", min);
                  store.setTemp("nightTempMax", max);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Climate warming factor: {store.warmingFactor.toFixed(1)}°C
              </Label>
              <Slider
                min={-1}
                max={4}
                step={0.1}
                value={[store.warmingFactor]}
                onValueChange={([v]) => store.setWarmingFactor(v)}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Temperature weighting: {store.tempWeight.toFixed(2)}
              </Label>
              <p className="text-xs text-muted-foreground">
                0 = distance only, 1 = weather only
              </p>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[store.tempWeight]}
                onValueChange={([v]) => store.setTempWeight(v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Travel Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Travel Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max daily km</Label>
                <Input
                  type="number"
                  min={10}
                  max={500}
                  value={store.maxDailyKm}
                  onChange={(e) => store.setMaxDailyKm(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Max travel days</Label>
                <Input
                  type="number"
                  min={1}
                  max={730}
                  value={store.maxTravelDays}
                  onChange={(e) =>
                    store.setMaxTravelDays(Number(e.target.value))
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={store.sortedInput}
                onCheckedChange={store.setSortedInput}
              />
              <Label>Keep cities in input order</Label>
            </div>
          </CardContent>
        </Card>

        {/* Elevation Profile */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Elevation Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>
                Resolution: {store.elevResolution} points per 1000 km
              </Label>
              <Slider
                min={100}
                max={3000}
                step={100}
                value={[store.elevResolution]}
                onValueChange={([v]) => store.setElevResolution(v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Blocked Countries */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Blocked Countries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  store.setBlockedCountries(
                    PRESET_BLOCKED_COUNTRIES.map((c) => c.code)
                  )
                }
              >
                Block defaults
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => store.setBlockedCountries([])}
              >
                Unblock all
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESET_BLOCKED_COUNTRIES.map((country) => (
                <label
                  key={country.code}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={store.blockedCountries.includes(country.code)}
                    onCheckedChange={() =>
                      store.toggleBlockedCountry(country.code)
                    }
                  />
                  {country.name}
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
