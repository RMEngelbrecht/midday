"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@midday/ui/select";
import {
  CATEGORY_KIND_OPTIONS,
  type CategoryKind,
} from "@/utils/category-kinds";

type Props = {
  value?: CategoryKind;
  onChange: (value: CategoryKind) => void;
  placeholder?: string;
};

export function SelectCategoryKind({ value, onChange, placeholder }: Props) {
  const selected = CATEGORY_KIND_OPTIONS.find(
    (option) => option.value === value,
  );

  return (
    <div className="space-y-1">
      <Select
        value={value ?? ""}
        onValueChange={(next) => onChange(next as CategoryKind)}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder ?? "Select a type"} />
        </SelectTrigger>
        <SelectContent>
          {CATEGORY_KIND_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <p className="text-xs text-muted-foreground pt-1">
          {selected.description}
        </p>
      )}
    </div>
  );
}
