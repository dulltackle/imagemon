import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createRandomId, createUtcTimestamp } from "../storage";

export type ModelCallType =
  | "modelConfigurationTest"
  | "imageGeneration"
  | "imageEdit";

export interface ActiveModelCall {
  id: string;
  type: ModelCallType;
  startedAt: string;
}

export type BeginModelCallResult =
  | {
      status: "started";
      call: ActiveModelCall;
    }
  | {
      status: "blocked";
      activeCall: ActiveModelCall;
    };

interface ModelCallLockContextValue {
  activeCall: ActiveModelCall | null;
  beginModelCall(type: ModelCallType): BeginModelCallResult;
  endModelCall(id: string): void;
}

interface ModelCallLockProviderProps {
  children: ReactNode;
}

const ModelCallLockContext = createContext<ModelCallLockContextValue | null>(null);

export function ModelCallLockProvider({ children }: ModelCallLockProviderProps) {
  const [activeCall, setActiveCall] = useState<ActiveModelCall | null>(null);

  const beginModelCall = useCallback(
    (type: ModelCallType): BeginModelCallResult => {
      if (activeCall) {
        return {
          status: "blocked",
          activeCall,
        };
      }

      const call: ActiveModelCall = {
        id: createRandomId(),
        type,
        startedAt: createUtcTimestamp(),
      };
      setActiveCall(call);
      return {
        status: "started",
        call,
      };
    },
    [activeCall],
  );

  const endModelCall = useCallback((id: string) => {
    setActiveCall((current) => (current?.id === id ? null : current));
  }, []);

  const value = useMemo(
    () => ({
      activeCall,
      beginModelCall,
      endModelCall,
    }),
    [activeCall, beginModelCall, endModelCall],
  );

  return (
    <ModelCallLockContext.Provider value={value}>
      {children}
    </ModelCallLockContext.Provider>
  );
}

export function useModelCallLock(): ModelCallLockContextValue {
  const value = useContext(ModelCallLockContext);
  if (!value) {
    throw new Error("useModelCallLock must be used within ModelCallLockProvider.");
  }
  return value;
}
