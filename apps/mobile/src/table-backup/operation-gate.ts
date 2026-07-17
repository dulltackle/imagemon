export interface OperationGate<T extends string> {
  tryEnter(operation: T): boolean;
  leave(operation: T): void;
}

/** 同步门闩：用于封住 React 状态尚未重渲染时的重复点击窗口。 */
export function createOperationGate<T extends string>(): OperationGate<T> {
  let active: T | null = null;
  return {
    tryEnter(operation) {
      if (active !== null) {
        return false;
      }
      active = operation;
      return true;
    },
    leave(operation) {
      if (active === operation) {
        active = null;
      }
    },
  };
}
