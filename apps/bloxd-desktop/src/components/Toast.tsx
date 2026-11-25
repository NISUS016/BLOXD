import { useProjectStore } from "../store/useProjectStore";

export function Toast() {
  const { toast, clearToast } = useProjectStore();
  if (!toast) return null;

  const style =
    toast.kind === "success"
      ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
      : toast.kind === "error"
      ? "border-rose-500/40 bg-rose-950/90 text-rose-200"
      : "border-slate-700 bg-slate-900/95 text-slate-200";

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50">
      <div
        onClick={clearToast}
        className={`pointer-events-auto cursor-pointer rounded-lg border px-3.5 py-2 text-xs font-medium shadow-xl backdrop-blur-sm ${style}`}
      >
        {toast.message}
      </div>
    </div>
  );
}
