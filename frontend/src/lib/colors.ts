import type { Category } from "../types";

export const CATEGORY_COLOR: Record<Category, string> = {
  project: "#c25b48",
  hobby: "#d4a14a",
  study: "#5e9b80",
  travel: "#7d6aa3",
};

export function colorFor(category: Category | null | undefined): string {
  if (!category) return "#1f1f1f";
  return CATEGORY_COLOR[category];
}
