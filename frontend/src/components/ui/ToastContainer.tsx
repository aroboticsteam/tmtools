import { useUiStore } from '../../stores/ui';

const VARIANT_CLASSES: Record<string, string> = {
  success: 'border-green-200 bg-green-50 text-green-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-neutral-200 bg-white text-neutral-800',
};

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-[200] flex flex-col gap-2 lg:bottom-4" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => dismiss(toast.id)}
          className={`max-w-sm rounded-lg border px-3.5 py-2.5 text-left text-sm ${VARIANT_CLASSES[toast.variant]}`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
