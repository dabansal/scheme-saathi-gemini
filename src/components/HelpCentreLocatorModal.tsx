/// <reference types="@types/google.maps" />
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import {
  AlertTriangle,
  Building2,
  Check,
  ExternalLink,
  Landmark,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
  Store,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  INDIA_DEFAULT_CENTER,
  findIndiaStateByCode,
} from "../../shared/indiaStates.ts";
import type { CitizenLocation, Language } from "../../shared/models.ts";
import { fetchMapsConfig } from "../api.ts";
import { UI_COPY } from "../i18n.ts";

type CentreCategory = "csc" | "tehsil" | "bank";

interface LivePlaceItem {
  id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number };
  googleMapsUri?: string;
}

interface HelpCentreLocatorModalProps {
  open: boolean;
  language: Language;
  location?: CitizenLocation;
  isOffline: boolean;
  onClose: () => void;
}

const CATEGORY_QUERIES: Record<CentreCategory, string> = {
  csc: "Common Service Centre CSC Jan Seva Kendra",
  tehsil: "Tehsil Office Block Development Office SDM",
  bank: "State Bank of India public sector bank branch",
};

function isSafeHttpsUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export function HelpCentreLocatorModal({
  open,
  language,
  location,
  isOffline,
  onClose,
}: HelpCentreLocatorModalProps) {
  const copy = UI_COPY[language].helpCentreMap;
  const [apiKey, setApiKey] = useState<string>("");
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    if (!open || apiKey) return;
    let active = true;
    setConfigLoading(true);
    setConfigError(false);
    void fetchMapsConfig()
      .then((cfg) => {
        if (!active) return;
        if (cfg.configured && cfg.apiKey) {
          setApiKey(cfg.apiKey);
        } else {
          setConfigError(true);
        }
      })
      .catch(() => {
        if (active) setConfigError(true);
      })
      .finally(() => {
        if (active) setConfigLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, apiKey]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-centre-map-title"
      className="fixed inset-0 z-50 bg-[#1F1F1F]/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5 print:hidden"
    >
      <div className="bg-[#F8FAFD] rounded-[28px] w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden md-elevation-3">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-white border-b border-[#E1E5EC] flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[#D3E3FD] text-[#041E49] flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="help-centre-map-title"
                className="text-lg sm:text-xl font-semibold text-[#1F1F1F]"
              >
                {copy.modalTitle}
              </h2>
              <p className="text-xs sm:text-sm text-[#444746] mt-0.5 leading-snug">
                {copy.modalSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.closeBtn}
            className="min-h-[44px] min-w-[44px] rounded-full text-[#444746] hover:text-[#1F1F1F] hover:bg-[#1F1F1F]/8 inline-flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {isOffline ? (
            <FallbackUnavailable message={copy.mapUnavailable} language={language} />
          ) : configLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-[#444746] text-sm">
              <Loader2 className="w-6 h-6 animate-spin text-[#0B57D0]" aria-hidden="true" />
              <span>{copy.searchingLabel}</span>
            </div>
          ) : configError || !apiKey ? (
            <FallbackUnavailable message={copy.mapUnavailable} language={language} />
          ) : (
            <APIProvider
              apiKey={apiKey}
              libraries={["places", "marker"]}
              language={language}
              region="IN"
            >
              <LocatorMapWorkspace language={language} location={location} />
            </APIProvider>
          )}
        </div>
      </div>
    </div>
  );
}

function FallbackUnavailable({
  message,
  language,
}: {
  message: string;
  language: Language;
}) {
  return (
    <div className="rounded-[20px] bg-[#FFF4D6] p-5 space-y-3.5 text-sm text-[#422006]">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-5 h-5 text-[#7A4F01] mt-0.5 shrink-0" aria-hidden="true" />
        <p className="leading-relaxed">{message}</p>
      </div>
      <a
        href="https://locator.csccloud.in/"
        target="_blank"
        rel="noopener noreferrer"
        className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0B57D0] text-white text-sm font-medium hover:bg-[#0842A0] transition-colors"
      >
        <span>
          {language === "hi"
            ? "आधिकारिक CSC लोकेटर खोलें"
            : "Open Official CSC Locator"}
        </span>
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
      </a>
    </div>
  );
}

function LocatorMapWorkspace({
  language,
  location,
}: {
  language: Language;
  location?: CitizenLocation;
}) {
  const copy = UI_COPY[language].helpCentreMap;
  const loadingStatus = useApiLoadingStatus();
  const map = useMap();
  const coreLib = useMapsLibrary("core");
  const placesLib = useMapsLibrary("places");

  const stateInfo = useMemo(
    () => findIndiaStateByCode(location?.stateCode),
    [location?.stateCode],
  );

  const initialCenter = useMemo(
    () => stateInfo?.defaultCenter ?? INDIA_DEFAULT_CENTER,
    [stateInfo],
  );

  const initialAreaQuery = useMemo(() => {
    if (location?.district && location?.stateName) {
      return `${location.district}, ${location.stateName}`;
    }
    if (location?.stateName) {
      return location.stateName;
    }
    return "";
  }, [location?.district, location?.stateName]);

  const [category, setCategory] = useState<CentreCategory>("csc");
  const [areaInput, setAreaInput] = useState(initialAreaQuery);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locating, setLocating] = useState(false);
  const [geoNotice, setGeoNotice] = useState<string | null>(null);
  const [places, setPlaces] = useState<LivePlaceItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const hasAutoSearchedRef = useRef(false);

  // Sync area input when user updates State/District filter
  useEffect(() => {
    setAreaInput(initialAreaQuery);
  }, [initialAreaQuery]);

  const runLiveSearch = useCallback(
    async (opts: {
      cat: CentreCategory;
      areaText: string;
      coords: { lat: number; lng: number } | null;
    }) => {
      if (!placesLib) return;
      setSearching(true);
      setSearchError(null);

      try {
        const baseTerm = CATEGORY_QUERIES[opts.cat];
        const trimmedArea = opts.areaText.trim();
        const textQuery = opts.coords
          ? baseTerm
          : trimmedArea
            ? `${baseTerm} in ${trimmedArea}, India`
            : `${baseTerm} in India`;

        const biasCenter = opts.coords ?? initialCenter;
        // Places API (New): Place.searchByText (zero legacy PlacesService)
        const request: google.maps.places.SearchByTextRequest = {
          textQuery,
          fields: [
            "id",
            "displayName",
            "formattedAddress",
            "location",
            "googleMapsURI",
          ],
          locationBias: {
            center: biasCenter,
            radius: opts.coords ? 12000 : 35000,
          },
          maxResultCount: 8,
          region: "IN",
          language,
        };

        const response = await placesLib.Place.searchByText(request);
        const found: LivePlaceItem[] = (response.places ?? [])
          .filter((p) => Boolean(p.location))
          .map((p, idx) => ({
            id: p.id || `place_${idx}`,
            name: p.displayName || "Help Centre",
            address: p.formattedAddress || "",
            location: {
              lat: p.location!.lat(),
              lng: p.location!.lng(),
            },
            googleMapsUri: p.googleMapsURI ?? undefined,
          }));

        setPlaces(found);
        setSelectedId(found[0]?.id ?? null);

        if (map && found.length > 0) {
          if (found.length === 1 || !coreLib) {
            map.setCenter(found[0].location);
            map.setZoom(14);
          } else {
            const bounds = new coreLib.LatLngBounds();
            found.forEach((item) => bounds.extend(item.location));
            if (opts.coords) bounds.extend(opts.coords);
            map.fitBounds(bounds, 48);
          }
        } else if (map && opts.coords) {
          map.setCenter(opts.coords);
          map.setZoom(13);
        }
      } catch {
        setSearchError(copy.mapUnavailable);
        setPlaces([]);
      } finally {
        setSearching(false);
      }
    },
    [placesLib, coreLib, initialCenter, language, map, copy.mapUnavailable],
  );

  // Trigger initial search once Places library finishes loading
  useEffect(() => {
    if (!placesLib || hasAutoSearchedRef.current) return;
    hasAutoSearchedRef.current = true;
    void runLiveSearch({
      cat: category,
      areaText: areaInput,
      coords: userCoords,
    });
  }, [placesLib, category, areaInput, userCoords, runLiveSearch]);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setGeoNotice(null);
    setUserCoords(null);
    void runLiveSearch({ cat: category, areaText: areaInput, coords: null });
  }

  function handleCategoryChange(nextCat: CentreCategory) {
    setCategory(nextCat);
    void runLiveSearch({ cat: nextCat, areaText: areaInput, coords: userCoords });
  }

  function handleUseCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoNotice(copy.geoDenied);
      return;
    }
    setLocating(true);
    setGeoNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserCoords(coords);
        setLocating(false);
        void runLiveSearch({ cat: category, areaText: "", coords });
      },
      () => {
        setLocating(false);
        setGeoNotice(copy.geoDenied);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  const selectedPlace = useMemo(
    () => places.find((p) => p.id === selectedId) ?? null,
    [places, selectedId],
  );

  if (
    loadingStatus === APILoadingStatus.FAILED ||
    loadingStatus === APILoadingStatus.AUTH_FAILURE
  ) {
    return <FallbackUnavailable message={copy.mapUnavailable} language={language} />;
  }

  return (
    <div className="space-y-4">
      {/* M3 Filter Chips & Search Bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { key: "csc" as const, label: copy.categories.csc, Icon: Store },
              {
                key: "tehsil" as const,
                label: copy.categories.tehsil,
                Icon: Building2,
              },
              { key: "bank" as const, label: copy.categories.bank, Icon: Landmark },
            ] as const
          ).map(({ key, label, Icon }) => {
            const active = category === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => handleCategoryChange(key)}
                className={`min-h-[40px] px-4 py-2 rounded-full text-xs sm:text-sm font-medium inline-flex items-center gap-2 border transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#0B57D0] ${
                  active
                    ? "bg-[#D3E3FD] border-transparent text-[#041E49]"
                    : "bg-white border-[#747775]/60 text-[#444746] hover:bg-[#F0F4F9]"
                }`}
              >
                {active ? (
                  <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <form
          onSubmit={handleSearchSubmit}
          className="flex flex-col sm:flex-row items-stretch gap-2.5"
        >
          <div className="flex-1 flex items-center gap-2 rounded-full bg-white border border-[#C4C7C5] pl-4 pr-1.5 py-1 focus-within:border-[#0B57D0] focus-within:ring-2 focus-within:ring-[#0B57D0]/15 transition-all">
            <Search className="w-4 h-4 text-[#444746] shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={areaInput}
              onChange={(e) => setAreaInput(e.target.value)}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchPlaceholder}
              className="flex-1 min-h-[38px] bg-transparent text-sm text-[#1F1F1F] placeholder:text-[#747775] focus:outline-none"
            />
            <button
              type="submit"
              disabled={searching}
              className="min-h-[38px] px-4 rounded-full bg-[#0B57D0] text-white text-sm font-medium inline-flex items-center gap-1.5 hover:bg-[#0842A0] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <span>{copy.searchBtn}</span>
            </button>
          </div>
          <button
            type="button"
            disabled={locating || searching}
            onClick={handleUseCurrentLocation}
            className="min-h-[46px] px-4 rounded-full border border-[#747775]/70 bg-white text-[#0B57D0] text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-[#0B57D0]/8 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {locating ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{locating ? copy.locatingBtn : copy.useMyLocationBtn}</span>
          </button>
        </form>

        <p className="text-xs text-[#444746] leading-snug">
          {copy.locationPrivacyNote}
        </p>

        {geoNotice && (
          <p className="text-xs text-[#422006] bg-[#FFF4D6] rounded-2xl px-4 py-2.5">
            {geoNotice}
          </p>
        )}
      </div>

      {/* Interactive Map + Verified Results List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 h-[320px] sm:h-[360px] w-full rounded-[20px] overflow-hidden border border-[#E1E5EC] bg-[#F0F4F9]">
          <GoogleMap
            defaultCenter={initialCenter}
            defaultZoom={stateInfo ? 10 : 5}
            mapId="DEMO_MAP_ID"
            gestureHandling="greedy"
            clickableIcons={false}
            internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
            onClick={() => setSelectedId(null)}
            className="w-full h-full"
          >
            {userCoords && (
              <AdvancedMarker position={userCoords} title="Your location">
                <Pin
                  background="#146C2E"
                  borderColor="#072711"
                  glyphColor="#ffffff"
                />
              </AdvancedMarker>
            )}

            {places.map((place) => {
              const isSelected = place.id === selectedId;
              return (
                <AdvancedMarker
                  key={place.id}
                  position={place.location}
                  title={place.name}
                  zIndex={isSelected ? 50 : 10}
                  onClick={() => {
                    setSelectedId(place.id);
                    map?.panTo(place.location);
                  }}
                >
                  <Pin
                    background={isSelected ? "#0B57D0" : "#444746"}
                    borderColor={isSelected ? "#041E49" : "#1F1F1F"}
                    glyphColor="#ffffff"
                    scale={isSelected ? 1.15 : 1}
                  />
                </AdvancedMarker>
              );
            })}

            {selectedPlace && (
              <InfoWindow
                position={selectedPlace.location}
                pixelOffset={[0, -34]}
                maxWidth={250}
                onCloseClick={() => setSelectedId(null)}
              >
                <div className="space-y-1.5 pr-1">
                  <p className="text-xs font-semibold text-[#1F1F1F] leading-snug">
                    {selectedPlace.name}
                  </p>
                  {selectedPlace.address && (
                    <p className="text-[11px] text-[#444746] leading-snug">
                      {selectedPlace.address}
                    </p>
                  )}
                  {isSafeHttpsUrl(selectedPlace.googleMapsUri) && (
                    <a
                      href={selectedPlace.googleMapsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#0B57D0] hover:underline pt-0.5"
                    >
                      <span>{copy.openInGoogleMaps}</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </div>

        {/* Verified Places Sidebar List */}
        <div className="lg:col-span-5 max-h-[360px] overflow-y-auto border border-[#E1E5EC] rounded-[20px] divide-y divide-[#E1E5EC] bg-white">
          {searching ? (
            <div className="p-6 flex items-center justify-center gap-2 text-xs text-[#444746]">
              <Loader2 className="w-4 h-4 animate-spin text-[#0B57D0]" aria-hidden="true" />
              <span>{copy.searchingLabel}</span>
            </div>
          ) : searchError ? (
            <div className="p-4 text-xs text-[#422006] bg-[#FFF4D6]">
              {searchError}
            </div>
          ) : places.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#444746] leading-relaxed">
              {copy.noResultsLabel}
            </div>
          ) : (
            places.map((place) => {
              const active = place.id === selectedId;
              return (
                <div
                  key={place.id}
                  className={`p-3.5 space-y-1.5 transition-colors ${
                    active ? "bg-[#D3E3FD]/45" : "bg-white hover:bg-[#F0F4F9]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(place.id);
                      map?.panTo(place.location);
                      map?.setZoom(15);
                    }}
                    className="w-full text-left space-y-0.5"
                  >
                    <p className="text-sm font-semibold text-[#1F1F1F] leading-snug">
                      {place.name}
                    </p>
                    {place.address && (
                      <p className="text-xs text-[#444746] leading-snug">
                        {place.address}
                      </p>
                    )}
                  </button>
                  {isSafeHttpsUrl(place.googleMapsUri) && (
                    <a
                      href={place.googleMapsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#0B57D0] hover:underline"
                    >
                      <span>{copy.openInGoogleMaps}</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
