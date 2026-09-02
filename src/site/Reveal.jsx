import React, { useEffect, useRef } from "react";

/*
 * Fades and lifts its children in the first time they scroll into view.
 * Each instance watches itself, so content that arrives late (notes, the
 * GitHub feed) still animates correctly.
 */
export default function Reveal({
    as: Tag = "div",
    className = "",
    index = 0,
    children,
    ...rest
}) {
    const ref = useRef(null);

    useEffect(() => {
        const node = ref.current;
        if (!node) return undefined;

        if (!("IntersectionObserver" in window)) {
            node.classList.add("is-in");
            return undefined;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-in");
                        observer.unobserve(entry.target);
                    }
                });
            },
            { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return (
        <Tag ref={ref} className={`reveal ${className}`.trim()} style={{ "--i": index }} {...rest}>
            {children}
        </Tag>
    );
}
