# Supabase setup

## One-time

1. Create a Supabase project.
2. In **SQL Editor**, run `migrations/0001_initial.sql`.
3. In **Storage**, create a private bucket named `recordings` (or set `SUPABASE_RECORDINGS_BUCKET`).
4. Copy the project URL and the **service role** key into `.env.local`:
   ```
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

## Notes

- The service role key is server-only — never import it from a client component.
- Recordings are uploaded with one-time signed URLs minted by `/api/sessions/[id]/upload-url`. The browser never holds long-lived storage credentials.
- For the 5,000-student phase, swap the storage layer for AWS S3 / Azure Blob by replacing the `upload-url` route — the rest of the app is storage-agnostic.
