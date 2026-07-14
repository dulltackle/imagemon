import {
  createContext,
  use,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createModelCallLockStore,
  type ActiveModelCall,
  type BeginModelCallInput,
  type BeginModelCallResult,
  type ModelCallLockStore,
  type UpdateModelCallPatch,
} from "./model-call-lock";

export interface ModelCallLockContextValue {
  readonly activeCall: ActiveModelCall | null;
  readonly beginModelCall: (
    input: BeginModelCallInput,
  ) => BeginModelCallResult;
  readonly updateModelCall: (
    id: string,
    patch: UpdateModelCallPatch,
  ) => void;
  readonly endModelCall: (id: string) => void;
}

interface ModelCallLockProviderProps {
  readonly children: ReactNode;
}

const ModelCallLockContext = createContext<ModelCallLockContextValue | null>(
  null,
);

export function ModelCallLockProvider({ children }: ModelCallLockProviderProps) {
  const storeRef = useRef<ModelCallLockStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createModelCallLockStore();
  }
  const store = storeRef.current;
  const activeCall = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const value = useMemo<ModelCallLockContextValue>(
    () => ({
      activeCall,
      beginModelCall: store.beginModelCall,
      updateModelCall: store.updateModelCall,
      endModelCall: store.endModelCall,
    }),
    [activeCall, store],
  );

  return (
    <ModelCallLockContext.Provider value={value}>
      {children}
    </ModelCallLockContext.Provider>
  );
}

export function useModelCallLock(): ModelCallLockContextValue {
  const value = use(ModelCallLockContext);
  if (!value) {
    throw new Error("useModelCallLock must be used within ModelCallLockProvider.");
  }
  return value;
}
