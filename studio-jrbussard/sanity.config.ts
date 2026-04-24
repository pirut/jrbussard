import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./schemaTypes";

export default defineConfig({
    name: "default",
    title: "JR Bussard CMS",
    projectId: "8qiu273i",
    dataset: "production",
    plugins: [structureTool(), visionTool()],
    schema: {
        types: schemaTypes,
    },
});
