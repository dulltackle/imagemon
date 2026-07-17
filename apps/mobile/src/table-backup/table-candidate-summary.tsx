import type { ReactNode } from "react";

import { Text, View } from "@/tw";
import { Badge } from "@/ui/Badge";
import { Surface } from "@/ui/Surface";

import type { TableCandidate } from "./table-resolver";
import { tableCandidateKindLabel } from "./table-choice-presentation";

export interface TableCandidateSummaryProps {
  candidate: TableCandidate;
  children?: ReactNode;
}

export function TableCandidateSummary({
  candidate,
  children,
}: TableCandidateSummaryProps) {
  return (
    <Surface variant="fieldGroup">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-sm font-semibold leading-5 text-app-ink" selectable>
          {candidate.name || "指定数据表"}
        </Text>
        <Badge variant="warning">{tableCandidateKindLabel(candidate.kind)}</Badge>
      </View>
      <Text className="text-xs leading-4 text-app-ink-muted" selectable>
        {candidate.tableId}
      </Text>
      {candidate.missingFieldNames.length > 0 ? (
        <Text className="text-[13px] leading-[18px] text-app-ink-muted" selectable>
          当前缺少可选字段：{candidate.missingFieldNames.join("、")}
        </Text>
      ) : null}
      {children}
    </Surface>
  );
}
