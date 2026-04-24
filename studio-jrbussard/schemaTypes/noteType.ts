import { defineField, defineType } from "sanity";

export const noteType = defineType({
    name: "note",
    title: "Notes",
    type: "document",
    fields: [
        defineField({
            name: "title",
            title: "Title",
            type: "string",
            validation: (rule) => rule.required(),
        }),
        defineField({
            name: "slug",
            title: "Slug",
            type: "slug",
            options: {
                source: "title",
                maxLength: 96,
            },
            validation: (rule) => rule.required(),
        }),
        defineField({
            name: "publishedAt",
            title: "Published date",
            type: "datetime",
            initialValue: () => new Date().toISOString(),
            validation: (rule) => rule.required(),
        }),
        defineField({
            name: "category",
            title: "Category",
            type: "string",
            initialValue: "General",
            options: {
                list: [
                    { title: "General", value: "General" },
                    { title: "Operations", value: "Operations" },
                    { title: "Building", value: "Building" },
                    { title: "Web", value: "Web" },
                ],
            },
            validation: (rule) => rule.required(),
        }),
        defineField({
            name: "summary",
            title: "Summary",
            type: "text",
            rows: 3,
            validation: (rule) => rule.required().max(220),
        }),
        defineField({
            name: "body",
            title: "Body",
            type: "text",
            rows: 8,
            validation: (rule) => rule.required(),
        }),
    ],
    preview: {
        select: {
            title: "title",
            subtitle: "category",
        },
    },
});
