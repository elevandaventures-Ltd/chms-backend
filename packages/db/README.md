# @repo/db

Supabase client for the CHMS monorepo. Schema is managed in [`supabase/migrations`](../../supabase/migrations); this package only exposes a typed `@supabase/supabase-js` client.

## Required env

Consumers must set:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=...
```

Both values are printed by `supabase start` / `supabase status` in the root of the repo.

## Usage

```ts
import { supabase } from "@repo/db";

const { data, error } = await supabase.from("churches").select("*");
```

The exported `supabase` client uses the **service role** key and bypasses RLS. Only import it from server-side code.
