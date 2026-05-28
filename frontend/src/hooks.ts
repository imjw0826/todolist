import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createNode, deleteNode, fetchTree, updateNode } from "./api";
import type { Category } from "./types";

export function useTree() {
  return useQuery({ queryKey: ["tree"], queryFn: fetchTree });
}

export function useCreateNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createNode,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree"] }),
  });
}

export function useDeleteNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteNode,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree"] }),
  });
}
