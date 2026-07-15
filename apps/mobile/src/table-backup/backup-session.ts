// 备份进行中状态机（方案 2.2）：idle / running / cancelling / failed / succeeded。
// 失败说明为会话级展示，不持久化（对齐 ADR 0201/0105 精神）。
//
// 会话持有本次运行的 AbortController：requestCancel 触发取消，镜像引擎的网络阶段
// 随时可取消，半写状态靠下次镜像幂等修平。

export interface BackupSummary {
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly skipped: number;
}

export type BackupSessionState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "cancelling" }
  | { readonly status: "failed"; readonly message: string }
  | {
      readonly status: "succeeded";
      readonly succeededAt: string;
      readonly summary: BackupSummary;
    };

/** 镜像引擎运行结果，驱动会话状态落地。 */
export type BackupSettleResult =
  | { readonly status: "succeeded"; readonly succeededAt: string; readonly summary: BackupSummary }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "blocked"; readonly reason: "migration" | "model_call" }
  | { readonly status: "not_configured" };

export interface BackupSessionStore {
  readonly getSnapshot: () => BackupSessionState;
  readonly subscribe: (listener: () => void) => () => void;
  /** idle/failed/succeeded → running，返回本次运行的取消信号。 */
  readonly start: () => AbortSignal;
  /** running → cancelling 并中断信号；已结束则无操作。 */
  readonly requestCancel: () => void;
  /** 依据引擎结果落地终态。 */
  readonly settle: (result: BackupSettleResult) => void;
  /** 回到 idle（清除会话级展示）。 */
  readonly reset: () => void;
}

const IDLE: BackupSessionState = { status: "idle" };

export function createBackupSessionStore(): BackupSessionStore {
  const listeners = new Set<() => void>();
  let state: BackupSessionState = IDLE;
  let controller: AbortController | null = null;

  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const setState = (next: BackupSessionState) => {
    state = next;
    notify();
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start() {
      controller = new AbortController();
      setState({ status: "running" });
      return controller.signal;
    },

    requestCancel() {
      if (state.status !== "running") {
        return;
      }
      controller?.abort();
      setState({ status: "cancelling" });
    },

    settle(result) {
      controller = null;
      switch (result.status) {
        case "succeeded":
          setState({
            status: "succeeded",
            succeededAt: result.succeededAt,
            summary: result.summary,
          });
          return;
        case "cancelled":
          // 取消不更新成功时间，直接回 idle。
          setState(IDLE);
          return;
        case "failed":
          setState({ status: "failed", message: result.message });
          return;
        case "blocked":
          setState({
            status: "failed",
            message:
              result.reason === "migration"
                ? "已有表格备份或恢复进行中，请稍后重试。"
                : "已有模型调用进行中，请稍后重试。",
          });
          return;
        case "not_configured":
          setState({
            status: "failed",
            message: "尚未配置飞书连接或个人授权码。",
          });
          return;
      }
    },

    reset() {
      controller = null;
      setState(IDLE);
    },
  };
}
