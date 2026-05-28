import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MindMap } from "./components/MindMap";
import { AdminLock } from "./components/AdminLock";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
        <AdminLock />
        <MindMap />
      </div>
    </QueryClientProvider>
  );
}
