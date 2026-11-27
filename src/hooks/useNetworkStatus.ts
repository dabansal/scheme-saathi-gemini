import { useEffect, useRef, useState } from "react";

export interface NetworkStatus {
  isOnline: boolean;
  justReconnected: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [justReconnected, setJustReconnected] = useState(false);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const clearTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const handleOffline = () => {
      clearTimer();
      setIsOnline(false);
      setJustReconnected(false);
    };

    const handleOnline = () => {
      clearTimer();
      setIsOnline(true);
      setJustReconnected(true);
      reconnectTimerRef.current = window.setTimeout(() => {
        setJustReconnected(false);
        reconnectTimerRef.current = null;
      }, 3500);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      clearTimer();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return { isOnline, justReconnected };
}
