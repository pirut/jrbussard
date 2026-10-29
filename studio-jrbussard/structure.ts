import type { StructureResolver } from "sanity/structure";

/* Notes first, then the ideas texted in from JR's phone (api/whatsapp.js), so
   the drafts waiting to be written up are one click away. */
export const structure: StructureResolver = (S) =>
    S.list()
        .title("Content")
        .items([
            S.documentTypeListItem("note").title("Notes"),
            S.listItem()
                .title("Texted ideas")
                .child(
                    S.documentList()
                        .title("Texted ideas")
                        .schemaType("note")
                        .filter('_type == "note" && defined(source)')
                        .defaultOrdering([{ field: "publishedAt", direction: "desc" }]),
                ),
        ]);
