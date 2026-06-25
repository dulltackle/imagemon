import { useLocalSearchParams } from "expo-router";

import {
  ModelConfigurationEditor,
} from "../../src/model-configurations/ModelConfigurationEditor";
import type { ModelConfigurationType } from "../../src/model-configurations";

export default function NewModelConfigurationScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const initialType: ModelConfigurationType = params.type === "text" ? "text" : "image";

  return <ModelConfigurationEditor initialConfiguration={null} initialType={initialType} />;
}
