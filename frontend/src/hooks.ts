import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createNode, deleteNode, fetchTree, updateNode } from "./api";
import type { Category } from "./types";

// Writes used to fail silently (e.g. a database rule rejecting them), which
// looked like the button did nothing. Tell the user instead.
function reportError(action: string) {
  return (err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    window.alert(`${action}하지 못했습니다.\n${detail}`);
  };
}

export function useTree() {
  return useQuery({ queryKey: ["tree"], queryFn: fetchTree });
}

export function useCreateNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createNode,
    onError: reportError("추가"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree"] }),
  });
}

export function useUpdateNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: number;
      title?: string;
      category?: Category | null;
    }) => updateNode(id, input),
    onError: reportError("수정"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree"] }),
  });
}

export function useDeleteNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteNode,
    onError: reportError("삭제"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree"] }),
  });
}
