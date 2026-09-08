import { useEffect } from "react";

export default function useDialogFocus(ref) {
    useEffect(() => {
        const previous = document.activeElement;
        const dialog = ref.current;
        dialog?.focus();
        const trap = (event) => {
            if (event.key !== "Tab") return;
            const items = [
                ...dialog.querySelectorAll(
                    'a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]',
                ),
            ].filter((item) => item.getClientRects().length);
            if (!items.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (
                event.shiftKey &&
                (document.activeElement === first ||
                    document.activeElement === dialog)
            ) {
                event.preventDefault();
                last.focus();
            } else if (
                !event.shiftKey &&
                (document.activeElement === last ||
                    document.activeElement === dialog)
            ) {
                event.preventDefault();
                first.focus();
            }
        };
        dialog?.addEventListener("keydown", trap);
        return () => {
            dialog?.removeEventListener("keydown", trap);
            if (previous?.isConnected) previous.focus();
        };
    }, [ref]);
}
