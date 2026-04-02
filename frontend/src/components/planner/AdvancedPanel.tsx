import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ConnectionList } from "./ConnectionList";
import { CountryCombobox } from "./CountryCombobox";
import { usePlannerStore } from "@/stores/plannerStore";
import { useT } from "@/i18n/useT";
import { PRESET_BLOCKED_COUNTRIES } from "@/utils/constants";
import { getCountryName } from "@/utils/countries";

export function AdvancedPanel() {
  const store = usePlannerStore();
  const t = useT();
  const tc = t.advanced;
  const lang = t.dateLocale === "de-DE" ? "de" : "en";

  // Local slider states for smooth dragging (store only updated on commit)
  const [dayTempRange, setDayTempRange] = useState([store.dayTempMin, store.dayTempMax]);
  const [nightTempRange, setNightTempRange] = useState([store.nightTempMin, store.nightTempMax]);
  const [warmingFactor, setWarmingFactor] = useState([store.warmingFactor]);
  const [distanceWeight, setDistanceWeight] = useState([store.distanceWeight]);
  const [tempWeight, setTempWeight] = useState([store.tempWeight]);
  const [windWeight, setWindWeight] = useState([store.windWeight]);
  const [rainWeight, setRainWeight] = useState([store.rainWeight]);
  const [elevResolution, setElevResolution] = useState([store.elevResolution]);

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="flex w-full items-center justify-between p-4 text-sm font-medium"
        >
          {tc.title}
          <ChevronDown className="h-4 w-4 transition-transform [[data-state=open]_&]:rotate-180" />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 px-1">
        {/* Direct Connections */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tc.directConnections.heading}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t.connections.description}
            </p>
            <ConnectionList />
          </CardContent>
        </Card>

        {/* Temperature Preferences */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tc.temperature.heading}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{tc.temperature.desiredDay}</Label>
                <Input
                  type="number"
                  value={store.desiredDayTemp}
                  onChange={(e) =>
                    store.setTemp("desiredDayTemp", Number(e.target.value))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{tc.temperature.desiredNight}</Label>
                <Input
                  type="number"
                  value={store.desiredNightTemp}
                  onChange={(e) =>
                    store.setTemp("desiredNightTemp", Number(e.target.value))
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {tc.temperature.targetDesc}
            </p>

            <div className="space-y-2">
              <Label>{tc.temperature.dayRange(dayTempRange[0], dayTempRange[1])}</Label>
              <p className="text-xs text-muted-foreground">
                {tc.temperature.dayRangeDesc}
              </p>
              <Slider
                min={-20}
                max={50}
                step={1}
                value={dayTempRange}
                onValueChange={setDayTempRange}
                onValueCommit={([min, max]) => {
                  store.setTemp("dayTempMin", min);
                  store.setTemp("dayTempMax", max);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>{tc.temperature.nightRange(nightTempRange[0], nightTempRange[1])}</Label>
              <p className="text-xs text-muted-foreground">
                {tc.temperature.nightRangeDesc}
              </p>
              <Slider
                min={-30}
                max={40}
                step={1}
                value={nightTempRange}
                onValueChange={setNightTempRange}
                onValueCommit={([min, max]) => {
                  store.setTemp("nightTempMin", min);
                  store.setTemp("nightTempMax", max);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>{tc.temperature.warmingFactor(warmingFactor[0].toFixed(1))}</Label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{tc.temperature.warmingFactorDesc1}</p>
                <p>{tc.temperature.warmingFactorDesc2}</p>
                <p>{tc.temperature.warmingFactorDesc3}{" "}<span className="font-medium">{tc.temperature.recommended}</span></p>
                <p>{tc.temperature.warmingFactorDesc4}</p>
              </div>
              <Slider
                min={-1}
                max={4}
                step={0.1}
                value={warmingFactor}
                onValueChange={setWarmingFactor}
                onValueCommit={([v]) => store.setWarmingFactor(v)}
              />
            </div>

            <div className="space-y-2">
              <Label>{tc.temperature.distanceWeight(distanceWeight[0].toFixed(2))}</Label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{tc.temperature.distanceWeightDesc1}</p>
                <p>{tc.temperature.distanceWeightDesc2}{" "}<span className="font-medium">{tc.temperature.recommended}</span></p>
                <p>{tc.temperature.distanceWeightDesc3}</p>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={distanceWeight}
                onValueChange={setDistanceWeight}
                onValueCommit={([v]) => store.setDistanceWeight(v)}
              />
            </div>

            <div className="space-y-2">
              <Label>{tc.temperature.tempWeight(tempWeight[0].toFixed(2))}</Label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{tc.temperature.tempWeightDesc1}</p>
                <p>{tc.temperature.tempWeightDesc2}</p>
                <p>{tc.temperature.tempWeightDesc3}</p>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={tempWeight}
                onValueChange={setTempWeight}
                onValueCommit={([v]) => store.setTempWeight(v)}
              />
            </div>

            <div className="space-y-2">
              <Label>{tc.temperature.windWeight(windWeight[0].toFixed(2))}</Label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{tc.temperature.windWeightDesc1}</p>
                <p>{tc.temperature.windWeightDesc2}</p>
                <p>{tc.temperature.windWeightDesc3}</p>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={windWeight}
                onValueChange={setWindWeight}
                onValueCommit={([v]) => store.setWindWeight(v)}
              />
            </div>

            <div className="space-y-2">
              <Label>{tc.temperature.rainWeight(rainWeight[0].toFixed(2))}</Label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{tc.temperature.rainWeightDesc1}</p>
                <p>{tc.temperature.rainWeightDesc2}</p>
                <p>{tc.temperature.rainWeightDesc3}</p>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={rainWeight}
                onValueChange={setRainWeight}
                onValueCommit={([v]) => store.setRainWeight(v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Travel Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tc.travel.heading}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{tc.travel.maxDailyKm}</Label>
                <NumericInput
                  min={10}
                  max={500}
                  value={store.maxDailyKm}
                  fallback={10}
                  onChange={(v) => store.setMaxDailyKm(v)}
                />
                <p className="text-xs text-muted-foreground">
                  {tc.travel.maxDailyKmDesc}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{tc.travel.maxTravelDays}</Label>
                <NumericInput
                  min={1}
                  max={730}
                  value={store.maxTravelDays}
                  fallback={1}
                  onChange={(v) => store.setMaxTravelDays(v)}
                />
                <p className="text-xs text-muted-foreground">
                  {tc.travel.maxTravelDaysDesc}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Elevation Profile */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tc.elevation.heading}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>{tc.elevation.resolutionLabel}</Label>
              <Slider
                min={100}
                max={3000}
                step={100}
                value={elevResolution}
                onValueChange={setElevResolution}
                onValueCommit={([v]) => store.setElevResolution(v)}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">{tc.elevation.low}</span>
                  <span>{tc.elevation.lowDesc}</span>
                </span>
                <span className="flex flex-col gap-0.5 items-center text-center">
                  <span className="font-medium text-foreground">{tc.elevation.medium}</span>
                  <span>{tc.elevation.mediumDesc}</span>
                </span>
                <span className="flex flex-col gap-0.5 items-end text-right">
                  <span className="font-medium text-foreground">{tc.elevation.high}</span>
                  <span>{tc.elevation.highDesc}</span>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Blocked Countries */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tc.blockedCountries.heading}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {tc.blockedCountries.description}
            </p>
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
                {tc.blockedCountries.blockDefaults}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => store.setBlockedCountries([])}
              >
                {tc.blockedCountries.unblockAll}
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
                  {tc.blockedCountries.names[country.code] ?? country.name}
                </label>
              ))}
              {store.blockedCountries
                .filter((code) => !PRESET_BLOCKED_COUNTRIES.some((c) => c.code === code))
                .map((code) => (
                  <label key={code} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked
                      onCheckedChange={() => store.toggleBlockedCountry(code)}
                    />
                    {tc.blockedCountries.names[code] ?? getCountryName(code, lang)}
                  </label>
                ))}
            </div>
            <CountryCombobox
              blockedCodes={store.blockedCountries}
              onToggle={store.toggleBlockedCountry}
            />
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
