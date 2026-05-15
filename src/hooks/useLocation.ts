import { useState, useCallback } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

interface LocationData {
  latitude: number;
  longitude: number;
  address: string | null;
}

async function reverseGeocodeWeb(lat: number, lng: number): Promise<string | null> {
  // Primary: Nominatim — returns street-level detail and POI names
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en&addressdetails=1`
    );
    if (res.ok) {
      const json = await res.json();
      const a = json.address ?? {};
      const streetNum = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
      const parts = [
        a.amenity || a.building || a.office || a.shop || a.tourism,
        streetNum || undefined,
        a.suburb || a.neighbourhood || a.quarter,
        a.city || a.town || a.village || a.county,
        a.postcode,
        a.country,
      ].filter(Boolean) as string[];
      if (parts.length >= 2) return parts.join(', ');
    }
  } catch { /* fall through to BigDataCloud */ }

  // Fallback: BigDataCloud — city/province/country level
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    );
    if (res.ok) {
      const json = await res.json();
      const parts = [json.locality || json.city, json.principalSubdivision, json.countryName].filter(Boolean);
      if (parts.length > 0) return parts.join(', ');
    }
  } catch { /* ignore */ }

  return null;
}

export function useLocation() {
  const [locationData, setLocationData] = useState<LocationData | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestAndCapture = useCallback(async (): Promise<LocationData | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionGranted(false);
        setError('Location permission denied.');
        return null;
      }
      setPermissionGranted(true);

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = loc.coords;

      let address: string | null = null;

      if (Platform.OS === 'web') {
        // expo-location reverseGeocodeAsync doesn't work on web — use Nominatim instead
        address = await reverseGeocodeWeb(latitude, longitude);
      } else {
        try {
          const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (geo) {
            const streetLine = [geo.streetNumber, geo.street].filter(Boolean).join(' ');
            const parts = [geo.name, streetLine || undefined, geo.district, geo.city, geo.postalCode, geo.country].filter(Boolean) as string[];
            address = parts.join(', ');
          }
        } catch {
          // Address lookup is best-effort
        }
      }

      const data: LocationData = { latitude, longitude, address };
      setLocationData(data);
      return data;
    } catch {
      setError('Failed to capture location.');
      return null;
    }
  }, []);

  return { locationData, permissionGranted, error, requestAndCapture };
}
