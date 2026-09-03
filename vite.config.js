import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    /*
     * The Vercel project (and .env.local on every machine that has one) still
     * sets REACT_APP_CONVEX_URL from the Create React App days. Accepting both
     * prefixes means nothing has to be renamed on the hosting side.
     */
    envPrefix: ["VITE_", "REACT_APP_"],
    build: {
        target: "es2020",
        sourcemap: false,
        cssCodeSplit: true,
        /* Three.js alone is ~540 kB minified; it only loads for Adventure Bay. */
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            output: {
                /* Keep the heavy, rarely-needed libraries in their own
                   long-cached chunks instead of inside the page bundles. */
                manualChunks(id) {
                    if (id.includes("node_modules/three")) return "three";
                    if (id.includes("node_modules/convex")) return "convex";
                    if (
                        /node_modules\/(react-markdown|remark|micromark|mdast|unified|hast|unist|vfile|property-information|comma-separated|space-separated|bail|trough|zwitch|ccount|decode-named|character-entities|estree|devlop|html-url|longest-streak|markdown-table|trim-lines|style-to)/.test(
                            id
                        )
                    ) {
                        return "markdown";
                    }
                    return undefined;
                },
            },
        },
    },
    test: {
        environment: "node",
        globals: true,
        include: ["src/**/*.test.{js,jsx}"],
    },
});
