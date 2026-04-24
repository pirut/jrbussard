## Notes CMS

This site uses Sanity for the Notes section. The React app reads published
`note` documents from Sanity, and `studio-jrbussard` gives you the editing UI.

The Studio is connected to project `8qiu273i` and dataset `production`.

1. Run `sanity login` if you are not already signed in.
2. Run `npm run cms` to manage posts at `http://localhost:3333`.
3. Add your local and deployed site URLs to Sanity's CORS origins.
4. Run `npm run cms:deploy` when you want a hosted Studio URL.
5. Optionally run `npm run cms:import` once to import the starter notes.

The frontend only needs published Sanity content. You do not need to edit code
for normal blog updates.
