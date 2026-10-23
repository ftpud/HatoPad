import { Select } from "../Select";
import type { AiModel } from "@hatopad/protocol";

export function WorkflowReasoningField({
  model,
  modelSelected,
  value,
  onChange,
}: {
  model?: AiModel;
  modelSelected: boolean;
  value?: string;
  onChange(value: string | undefined): void;
}) {
  const available = !!model?.reasoningLevels.length;
  return (
    <label>
      Reasoning effort
      <Select
        aria-label="Workflow reasoning effort"
        disabled={!available}
        value={value ?? ""}
        onValueChange={(selectedValue) => onChange(selectedValue || undefined)}
      >
        <option value="">Model default{model?.defaultReasoning ? ` (${model.defaultReasoning})` : ""}</option>
        {value && !model?.reasoningLevels.includes(value) && (
          <option value={value} disabled>
            {value}
          </option>
        )}
        {model?.reasoningLevels.map((level) => (
          <option key={level} value={level} title={model.reasoningDescriptions?.[level]}>
            {level}
          </option>
        ))}
      </Select>
      {!available && (
        <small>
          {!modelSelected
            ? "Select a model to choose reasoning effort."
            : model
              ? "This model does not advertise reasoning levels."
              : "Reasoning levels are unavailable until model details load."}
        </small>
      )}
    </label>
  );
}
