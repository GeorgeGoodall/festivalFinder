# Festival Finder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a festival finder MVP where users search UK festivals by artist, with admin-powered AI poster extraction.

**Architecture:** Monolithic Next.js 15 (App Router) on Vercel, Supabase PostgreSQL for data + image storage, Prisma ORM, Claude Vision API for poster extraction, NextAuth for admin auth.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, Prisma, Supabase, NextAuth.js, Anthropic Claude API

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `.env.example`, `.gitignore`

**Step 1: Create Next.js project with TypeScript and Tailwind**

```bash
cd "C:\Users\eorge\Documents\workspace\festivalFinder"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

Accept defaults. This scaffolds the entire Next.js project with App Router, TypeScript, Tailwind, and ESLint.

**Step 2: Verify the dev server starts**

```bash
npm run dev
```

Expected: Server starts on http://localhost:3000, default Next.js page renders.

**Step 3: Create `.env.example`**

```bash
# .env.example
DATABASE_URL="postgresql://user:password@host:5432/dbname"
DIRECT_URL="postgresql://user:password@host:5432/dbname"
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
NEXTAUTH_SECRET="generate-a-random-secret"
NEXTAUTH_URL="http://localhost:3000"
ANTHROPIC_API_KEY="your-anthropic-api-key"
```

**Step 4: Update `.gitignore` to include `.env`**

Ensure `.env` and `.env.local` are in `.gitignore` (create-next-app should handle this, but verify).

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 15 project with TypeScript and Tailwind"
```

---

## Task 2: Prisma Setup & Database Schema

**Files:**
- Create: `prisma/schema.prisma`
- Modify: `package.json` (add prisma deps)

**Step 1: Install Prisma**

```bash
npm install prisma --save-dev
npm install @prisma/client
npx prisma init
```

**Step 2: Write the database schema**

Replace `prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum FestivalStatus {
  draft
  pending_review
  published
}

enum Billing {
  headliner
  support
  other
}

enum SubmissionStatus {
  pending
  approved
  rejected
}

model Festival {
  id             String         @id @default(cuid())
  name           String
  slug           String         @unique
  description    String?
  startDate      DateTime       @map("start_date")
  endDate        DateTime       @map("end_date")
  venue          String?
  city           String
  region         String
  latitude       Float?
  longitude      Float?
  priceFrom      Int?           @map("price_from")
  priceTo        Int?           @map("price_to")
  hasCamping     Boolean        @default(false) @map("has_camping")
  websiteUrl     String?        @map("website_url")
  ticketUrl      String?        @map("ticket_url")
  posterImageUrl String?        @map("poster_image_url")
  status         FestivalStatus @default(draft)
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")

  artists FestivalArtist[]

  @@map("festivals")
}

model Artist {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  spotifyId String?  @map("spotify_id")
  genre     String?
  createdAt DateTime @default(now()) @map("created_at")

  festivals FestivalArtist[]

  @@map("artists")
}

model FestivalArtist {
  festivalId String  @map("festival_id")
  artistId   String  @map("artist_id")
  billing    Billing @default(other)

  festival Festival @relation(fields: [festivalId], references: [id], onDelete: Cascade)
  artist   Artist   @relation(fields: [artistId], references: [id], onDelete: Cascade)

  @@id([festivalId, artistId])
  @@map("festival_artists")
}

model UserSubmission {
  id             String           @id @default(cuid())
  festivalName   String           @map("festival_name")
  posterImageUrl String?          @map("poster_image_url")
  submitterEmail String?          @map("submitter_email")
  locationHint   String?          @map("location_hint")
  status         SubmissionStatus @default(pending)
  createdAt      DateTime         @default(now()) @map("created_at")

  @@map("user_submissions")
}

model AdminUser {
  id           String @id @default(cuid())
  email        String @unique
  passwordHash String @map("password_hash")
  name         String?

  @@map("admin_users")
}
```

**Step 3: Create the Prisma client singleton**

Create `src/lib/prisma.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

**Step 4: Set up Supabase project and configure `.env.local`**

1. Go to https://supabase.com and create a new project
2. Copy the connection string from Settings > Database
3. Create `.env.local` with real values from `.env.example`
4. Use the "Transaction" connection string for `DATABASE_URL` and "Session" for `DIRECT_URL`

**Step 5: Run the initial migration**

```bash
npx prisma migrate dev --name init
```

Expected: Migration runs successfully, tables created in Supabase.

**Step 6: Verify with Prisma Studio**

```bash
npx prisma studio
```

Expected: Opens browser, shows all tables (festivals, artists, festival_artists, user_submissions, admin_users).

**Step 7: Commit**

```bash
git add prisma/ src/lib/prisma.ts package.json package-lock.json
git commit -m "feat: add Prisma schema with all data models and initial migration"
```

---

## Task 3: Supabase Storage Setup

**Files:**
- Create: `src/lib/supabase.ts`

**Step 1: Install Supabase client**

```bash
npm install @supabase/supabase-js
```

**Step 2: Create Supabase client**

Create `src/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side client with service role key for storage operations
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
```

**Step 3: Create storage bucket in Supabase dashboard**

1. Go to Supabase Dashboard > Storage
2. Create a new public bucket called `posters`
3. Set the bucket to public (so poster images can be displayed without auth)

**Step 4: Commit**

```bash
git add src/lib/supabase.ts package.json package-lock.json
git commit -m "feat: add Supabase client for storage operations"
```

---

## Task 4: Admin Authentication with NextAuth

**Files:**
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/lib/auth.ts`
- Create: `src/app/admin/login/page.tsx`
- Create: `src/middleware.ts`
- Create: `prisma/seed.ts`

**Step 1: Install NextAuth and bcrypt**

```bash
npm install next-auth@beta @auth/prisma-adapter bcryptjs
npm install --save-dev @types/bcryptjs tsx
```

Note: Using NextAuth v5 (beta) which has native App Router support.

**Step 2: Create auth configuration**

Create `src/lib/auth.ts`:

```typescript
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.adminUser.findUnique({
          where: { email: credentials.email },
        });

        if (!user) return null;

        const passwordMatch = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!passwordMatch) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
};
```

**Step 3: Create the NextAuth route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

**Step 4: Create admin login page**

Create `src/app/admin/login/page.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push("/admin");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm p-8 bg-white rounded-lg shadow">
        <h1 className="text-2xl font-bold mb-6 text-center">Admin Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-2 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

**Step 5: Create middleware to protect admin routes**

Create `src/middleware.ts`:

```typescript
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/admin/login" },
});

export const config = {
  matcher: ["/admin/((?!login).*)"],
};
```

**Step 6: Create seed script for admin user**

Create `prisma/seed.ts`:

```typescript
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 12);

  await prisma.adminUser.upsert({
    where: { email: "admin@festivalfinder.co.uk" },
    update: {},
    create: {
      email: "admin@festivalfinder.co.uk",
      passwordHash,
      name: "Admin",
    },
  });

  console.log("Seeded admin user: admin@festivalfinder.co.uk / admin123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

Add to `package.json`:

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

**Step 7: Run the seed**

```bash
npx prisma db seed
```

Expected: "Seeded admin user: admin@festivalfinder.co.uk / admin123"

**Step 8: Create NextAuth session provider**

Create `src/app/providers.tsx`:

```tsx
"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

Wrap the root layout's `{children}` with `<Providers>` in `src/app/layout.tsx`.

**Step 9: Test login flow manually**

1. Start dev server: `npm run dev`
2. Navigate to http://localhost:3000/admin
3. Should redirect to /admin/login
4. Login with admin@festivalfinder.co.uk / admin123
5. Should redirect to /admin (will be 404 for now, that's fine — the auth works)

**Step 10: Commit**

```bash
git add src/app/api/auth/ src/lib/auth.ts src/app/admin/login/ src/middleware.ts prisma/seed.ts src/app/providers.tsx src/app/layout.tsx package.json package-lock.json
git commit -m "feat: add admin authentication with NextAuth credentials provider"
```

---

## Task 5: Admin Dashboard & Festival Management

**Files:**
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/festivals/page.tsx`
- Create: `src/app/admin/festivals/new/page.tsx`
- Create: `src/app/admin/festivals/[id]/page.tsx`
- Create: `src/lib/actions/festival.ts` (server actions)
- Create: `src/lib/utils.ts` (slug generation helper)

**Step 1: Create slug utility**

Create `src/lib/utils.ts`:

```typescript
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}
```

**Step 2: Create admin layout with navigation**

Create `src/app/admin/layout.tsx`:

```tsx
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-6">
          <Link href="/admin" className="font-bold text-lg">
            Admin
          </Link>
          <Link href="/admin/festivals" className="text-gray-600 hover:text-black">
            Festivals
          </Link>
          <Link href="/admin/submissions" className="text-gray-600 hover:text-black">
            Submissions
          </Link>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
```

**Step 3: Create admin dashboard page**

Create `src/app/admin/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";

export default async function AdminDashboardPage() {
  const [festivalCount, pendingSubmissions] = await Promise.all([
    prisma.festival.count({ where: { status: "published" } }),
    prisma.userSubmission.count({ where: { status: "pending" } }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-3xl font-bold">{festivalCount}</p>
          <p className="text-gray-500">Published Festivals</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-3xl font-bold">{pendingSubmissions}</p>
          <p className="text-gray-500">Pending Submissions</p>
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Create festival server actions**

Create `src/lib/actions/festival.ts`:

```typescript
"use server";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createFestival(formData: FormData) {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const startDate = formData.get("startDate") as string;
  const endDate = formData.get("endDate") as string;
  const city = formData.get("city") as string;
  const region = formData.get("region") as string;
  const venue = formData.get("venue") as string;
  const priceFrom = formData.get("priceFrom") as string;
  const priceTo = formData.get("priceTo") as string;
  const hasCamping = formData.get("hasCamping") === "on";
  const websiteUrl = formData.get("websiteUrl") as string;
  const ticketUrl = formData.get("ticketUrl") as string;

  let slug = slugify(name);
  const existing = await prisma.festival.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now()}`;
  }

  const festival = await prisma.festival.create({
    data: {
      name,
      slug,
      description: description || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      city,
      region,
      venue: venue || null,
      priceFrom: priceFrom ? parseInt(priceFrom) : null,
      priceTo: priceTo ? parseInt(priceTo) : null,
      hasCamping,
      websiteUrl: websiteUrl || null,
      ticketUrl: ticketUrl || null,
      status: "draft",
    },
  });

  redirect(`/admin/festivals/${festival.id}`);
}

export async function updateFestival(id: string, formData: FormData) {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const startDate = formData.get("startDate") as string;
  const endDate = formData.get("endDate") as string;
  const city = formData.get("city") as string;
  const region = formData.get("region") as string;
  const venue = formData.get("venue") as string;
  const priceFrom = formData.get("priceFrom") as string;
  const priceTo = formData.get("priceTo") as string;
  const hasCamping = formData.get("hasCamping") === "on";
  const websiteUrl = formData.get("websiteUrl") as string;
  const ticketUrl = formData.get("ticketUrl") as string;
  const status = formData.get("status") as string;

  await prisma.festival.update({
    where: { id },
    data: {
      name,
      description: description || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      city,
      region,
      venue: venue || null,
      priceFrom: priceFrom ? parseInt(priceFrom) : null,
      priceTo: priceTo ? parseInt(priceTo) : null,
      hasCamping,
      websiteUrl: websiteUrl || null,
      ticketUrl: ticketUrl || null,
      status: status as "draft" | "pending_review" | "published",
    },
  });

  revalidatePath(`/admin/festivals/${id}`);
  revalidatePath("/admin/festivals");
}

export async function deleteFestival(id: string) {
  await prisma.festival.delete({ where: { id } });
  revalidatePath("/admin/festivals");
  redirect("/admin/festivals");
}
```

**Step 5: Create festival list page**

Create `src/app/admin/festivals/page.tsx`:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminFestivalsPage() {
  const festivals = await prisma.festival.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { artists: true } } },
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Festivals</h1>
        <Link
          href="/admin/festivals/new"
          className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800"
        >
          Add Festival
        </Link>
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Name</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Date</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Location</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Artists</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {festivals.map((f) => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/festivals/${f.id}`} className="text-blue-600 hover:underline">
                    {f.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {f.startDate.toLocaleDateString("en-GB")}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {f.city}, {f.region}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{f._count.artists}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      f.status === "published"
                        ? "bg-green-100 text-green-700"
                        : f.status === "draft"
                          ? "bg-gray-100 text-gray-700"
                          : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {f.status}
                  </span>
                </td>
              </tr>
            ))}
            {festivals.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No festivals yet. Add your first one!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 6: Create new festival form page**

Create `src/app/admin/festivals/new/page.tsx`:

```tsx
import { createFestival } from "@/lib/actions/festival";

const UK_REGIONS = [
  "East Midlands", "East of England", "London", "North East",
  "North West", "Northern Ireland", "Scotland", "South East",
  "South West", "Wales", "West Midlands", "Yorkshire and the Humber",
];

export default function NewFestivalPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Add New Festival</h1>
      <form action={createFestival} className="bg-white p-6 rounded-lg shadow max-w-2xl space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">Festival Name *</label>
            <input name="name" required className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea name="description" rows={3} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Start Date *</label>
            <input name="startDate" type="date" required className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">End Date *</label>
            <input name="endDate" type="date" required className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">City *</label>
            <input name="city" required className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Region *</label>
            <select name="region" required className="mt-1 block w-full rounded border border-gray-300 px-3 py-2">
              <option value="">Select region</option>
              {UK_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">Venue</label>
            <input name="venue" className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Price From (GBP)</label>
            <input name="priceFrom" type="number" min="0" className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Price To (GBP)</label>
            <input name="priceTo" type="number" min="0" className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2">
              <input name="hasCamping" type="checkbox" className="rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700">Has camping</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Website URL</label>
            <input name="websiteUrl" type="url" className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Ticket URL</label>
            <input name="ticketUrl" type="url" className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
        </div>
        <button type="submit" className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800">
          Create Festival
        </button>
      </form>
    </div>
  );
}
```

**Step 7: Create festival edit page (with artist management)**

Create `src/app/admin/festivals/[id]/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { updateFestival, deleteFestival } from "@/lib/actions/festival";
import { notFound } from "next/navigation";

const UK_REGIONS = [
  "East Midlands", "East of England", "London", "North East",
  "North West", "Northern Ireland", "Scotland", "South East",
  "South West", "Wales", "West Midlands", "Yorkshire and the Humber",
];

export default async function EditFestivalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const festival = await prisma.festival.findUnique({
    where: { id },
    include: { artists: { include: { artist: true } } },
  });

  if (!festival) notFound();

  const updateWithId = updateFestival.bind(null, id);
  const deleteWithId = deleteFestival.bind(null, id);

  const formatDate = (d: Date) => d.toISOString().split("T")[0];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Edit: {festival.name}</h1>
        <form action={deleteWithId}>
          <button type="submit" className="text-red-600 hover:underline text-sm">
            Delete Festival
          </button>
        </form>
      </div>

      <form action={updateWithId} className="bg-white p-6 rounded-lg shadow max-w-2xl space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">Festival Name *</label>
            <input name="name" required defaultValue={festival.name} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea name="description" rows={3} defaultValue={festival.description ?? ""} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Start Date *</label>
            <input name="startDate" type="date" required defaultValue={formatDate(festival.startDate)} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">End Date *</label>
            <input name="endDate" type="date" required defaultValue={formatDate(festival.endDate)} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">City *</label>
            <input name="city" required defaultValue={festival.city} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Region *</label>
            <select name="region" required defaultValue={festival.region} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2">
              {UK_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">Venue</label>
            <input name="venue" defaultValue={festival.venue ?? ""} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Price From (GBP)</label>
            <input name="priceFrom" type="number" min="0" defaultValue={festival.priceFrom ?? ""} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Price To (GBP)</label>
            <input name="priceTo" type="number" min="0" defaultValue={festival.priceTo ?? ""} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2">
              <input name="hasCamping" type="checkbox" defaultChecked={festival.hasCamping} className="rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700">Has camping</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Website URL</label>
            <input name="websiteUrl" type="url" defaultValue={festival.websiteUrl ?? ""} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Ticket URL</label>
            <input name="ticketUrl" type="url" defaultValue={festival.ticketUrl ?? ""} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Status</label>
            <select name="status" defaultValue={festival.status} className="mt-1 block w-full rounded border border-gray-300 px-3 py-2">
              <option value="draft">Draft</option>
              <option value="pending_review">Pending Review</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>
        <button type="submit" className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800">
          Save Changes
        </button>
      </form>

      <div className="mt-8 bg-white p-6 rounded-lg shadow max-w-2xl">
        <h2 className="text-lg font-bold mb-4">
          Artists ({festival.artists.length})
        </h2>
        {festival.artists.length > 0 ? (
          <ul className="divide-y">
            {festival.artists.map((fa) => (
              <li key={fa.artistId} className="py-2 flex justify-between items-center">
                <span>{fa.artist.name}</span>
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                  {fa.billing}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400">No artists yet. Use poster extraction to add artists.</p>
        )}
      </div>
    </div>
  );
}
```

**Step 8: Test admin festival CRUD manually**

1. Start dev server: `npm run dev`
2. Login at /admin/login
3. Navigate to /admin/festivals -> should show empty table
4. Click "Add Festival" -> fill in form -> submit
5. Should redirect to edit page for the new festival
6. Verify festival appears in the list

**Step 9: Commit**

```bash
git add src/app/admin/ src/lib/actions/ src/lib/utils.ts
git commit -m "feat: add admin dashboard and festival CRUD management"
```

---

## Task 6: Poster Upload & AI Extraction

**Files:**
- Create: `src/app/api/admin/upload-poster/route.ts`
- Create: `src/app/api/admin/extract-poster/route.ts`
- Create: `src/lib/extraction.ts`
- Modify: `src/app/admin/festivals/[id]/page.tsx` (add poster upload + extraction UI)

**Step 1: Install Anthropic SDK**

```bash
npm install @anthropic-ai/sdk
```

**Step 2: Create the extraction utility**

Create `src/lib/extraction.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface ExtractionResult {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  artists: Array<{ name: string; billing: "headliner" | "support" | "other" }>;
}

export async function extractFromPoster(imageUrl: string): Promise<ExtractionResult> {
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = response.headers.get("content-type") || "image/jpeg";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: base64,
            },
          },
          {
            type: "text",
            text: `Analyze this music festival poster and extract the following information as JSON:

{
  "festival_name": "Name of the festival",
  "dates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "location": "City or venue, Region",
  "artists": [
    { "name": "Artist Name", "billing": "headliner" | "support" | "other" }
  ]
}

Rules:
- List ALL artists/bands you can identify on the poster
- "headliner" = largest/most prominent names, "support" = medium names, "other" = smallest names
- If dates are unclear, use your best estimate. If year is missing, assume 2026
- If location is unclear, put "Unknown"
- Return ONLY valid JSON, no other text`,
          },
        ],
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from AI response");
  }

  return JSON.parse(jsonMatch[0]) as ExtractionResult;
}
```

**Step 3: Create poster upload API route**

Create `src/app/api/admin/upload-poster/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const festivalId = formData.get("festivalId") as string;

  if (!file || !festivalId) {
    return NextResponse.json({ error: "Missing file or festivalId" }, { status: 400 });
  }

  const ext = file.name.split(".").pop();
  const fileName = `${festivalId}-${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("posters")
    .upload(fileName, file, { contentType: file.type });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: urlData } = supabaseAdmin.storage
    .from("posters")
    .getPublicUrl(fileName);

  await prisma.festival.update({
    where: { id: festivalId },
    data: { posterImageUrl: urlData.publicUrl },
  });

  return NextResponse.json({ url: urlData.publicUrl });
}
```

**Step 4: Create extraction API route**

Create `src/app/api/admin/extract-poster/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extractFromPoster } from "@/lib/extraction";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { festivalId, posterUrl } = await req.json();

  if (!festivalId || !posterUrl) {
    return NextResponse.json({ error: "Missing festivalId or posterUrl" }, { status: 400 });
  }

  const result = await extractFromPoster(posterUrl);

  return NextResponse.json({ extraction: result });
}

export async function PUT(req: NextRequest) {
  // Apply extraction results to festival
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { festivalId, artists } = await req.json();

  if (!festivalId || !artists) {
    return NextResponse.json({ error: "Missing festivalId or artists" }, { status: 400 });
  }

  // Delete existing artist associations
  await prisma.festivalArtist.deleteMany({ where: { festivalId } });

  // Create or find artists and link them
  for (const a of artists as Array<{ name: string; billing: string }>) {
    let slug = slugify(a.name);
    let artist = await prisma.artist.findUnique({ where: { slug } });

    if (!artist) {
      artist = await prisma.artist.create({
        data: { name: a.name, slug },
      });
    }

    await prisma.festivalArtist.create({
      data: {
        festivalId,
        artistId: artist.id,
        billing: (a.billing as "headliner" | "support" | "other") || "other",
      },
    });
  }

  return NextResponse.json({ success: true });
}
```

**Step 5: Add poster upload + extraction UI to the festival edit page**

Modify `src/app/admin/festivals/[id]/page.tsx` to add a client component for poster management. Create a new component:

Create `src/app/admin/festivals/[id]/poster-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Artist {
  name: string;
  billing: "headliner" | "support" | "other";
}

export function PosterSection({
  festivalId,
  currentPosterUrl,
}: {
  festivalId: string;
  currentPosterUrl: string | null;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<{ artists: Artist[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [posterUrl, setPosterUrl] = useState(currentPosterUrl);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("festivalId", festivalId);

    const res = await fetch("/api/admin/upload-poster", { method: "POST", body: formData });
    const data = await res.json();
    setPosterUrl(data.url);
    setUploading(false);
    router.refresh();
  }

  async function handleExtract() {
    if (!posterUrl) return;
    setExtracting(true);

    const res = await fetch("/api/admin/extract-poster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ festivalId, posterUrl }),
    });

    const data = await res.json();
    setExtraction(data.extraction);
    setExtracting(false);
  }

  async function handleApplyArtists() {
    if (!extraction) return;
    setSaving(true);

    await fetch("/api/admin/extract-poster", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ festivalId, artists: extraction.artists }),
    });

    setSaving(false);
    setExtraction(null);
    router.refresh();
  }

  function updateArtist(index: number, field: keyof Artist, value: string) {
    if (!extraction) return;
    const updated = [...extraction.artists];
    updated[index] = { ...updated[index], [field]: value };
    setExtraction({ ...extraction, artists: updated });
  }

  function removeArtist(index: number) {
    if (!extraction) return;
    const updated = extraction.artists.filter((_, i) => i !== index);
    setExtraction({ ...extraction, artists: updated });
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow max-w-2xl">
      <h2 className="text-lg font-bold mb-4">Poster & AI Extraction</h2>

      {posterUrl && (
        <img src={posterUrl} alt="Festival poster" className="w-full max-w-sm rounded mb-4" />
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upload poster</label>
          <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} />
          {uploading && <p className="text-sm text-gray-500 mt-1">Uploading...</p>}
        </div>

        {posterUrl && (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {extracting ? "Extracting with AI..." : "Extract Artists from Poster"}
          </button>
        )}

        {extraction && (
          <div className="border rounded p-4 mt-4">
            <h3 className="font-medium mb-3">
              Extracted Artists ({extraction.artists.length}) - Review & Edit
            </h3>
            <div className="space-y-2">
              {extraction.artists.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a.name}
                    onChange={(e) => updateArtist(i, "name", e.target.value)}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                  <select
                    value={a.billing}
                    onChange={(e) => updateArtist(i, "billing", e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="headliner">Headliner</option>
                    <option value="support">Support</option>
                    <option value="other">Other</option>
                  </select>
                  <button
                    onClick={() => removeArtist(i)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleApplyArtists}
                disabled={saving}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Apply Artists to Festival"}
              </button>
              <button
                onClick={() => setExtraction(null)}
                className="text-gray-600 hover:text-gray-800 px-4 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

Then import and add `<PosterSection festivalId={id} currentPosterUrl={festival.posterImageUrl} />` to the edit page, between the form and the artists list.

**Step 6: Test the extraction flow manually**

1. Create a festival in the admin
2. Upload a festival poster image
3. Click "Extract Artists from Poster"
4. Verify extracted artists appear for review
5. Edit/remove as needed, then apply
6. Verify artists are saved to the festival

**Step 7: Commit**

```bash
git add src/lib/extraction.ts src/app/api/admin/ src/app/admin/festivals/ src/lib/supabase.ts package.json package-lock.json
git commit -m "feat: add poster upload and AI extraction with admin review flow"
```

---

## Task 7: User Submission Flow

**Files:**
- Create: `src/app/submit/page.tsx`
- Create: `src/app/api/submissions/route.ts`
- Create: `src/app/admin/submissions/page.tsx`
- Create: `src/app/admin/submissions/[id]/page.tsx`
- Create: `src/lib/actions/submission.ts`

**Step 1: Create submission API route**

Create `src/app/api/submissions/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const festivalName = formData.get("festivalName") as string;
  const locationHint = formData.get("locationHint") as string;
  const submitterEmail = formData.get("submitterEmail") as string;
  const file = formData.get("poster") as File | null;

  if (!festivalName) {
    return NextResponse.json({ error: "Festival name is required" }, { status: 400 });
  }

  // Duplicate check: fuzzy match on name
  const existing = await prisma.festival.findFirst({
    where: {
      name: { contains: festivalName, mode: "insensitive" },
      status: "published",
    },
  });

  if (existing) {
    return NextResponse.json(
      { error: "duplicate", message: `"${existing.name}" already exists in our database.` },
      { status: 409 }
    );
  }

  // Also check pending submissions
  const existingSubmission = await prisma.userSubmission.findFirst({
    where: {
      festivalName: { contains: festivalName, mode: "insensitive" },
      status: "pending",
    },
  });

  if (existingSubmission) {
    return NextResponse.json(
      { error: "duplicate", message: "This festival has already been submitted and is awaiting review." },
      { status: 409 }
    );
  }

  let posterImageUrl: string | null = null;
  if (file) {
    const ext = file.name.split(".").pop();
    const fileName = `submissions/${Date.now()}.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from("posters")
      .upload(fileName, file, { contentType: file.type });

    if (!error) {
      const { data } = supabaseAdmin.storage.from("posters").getPublicUrl(fileName);
      posterImageUrl = data.publicUrl;
    }
  }

  await prisma.userSubmission.create({
    data: {
      festivalName,
      locationHint: locationHint || null,
      submitterEmail: submitterEmail || null,
      posterImageUrl,
    },
  });

  return NextResponse.json({ success: true });
}
```

**Step 2: Create public submission page**

Create `src/app/submit/page.tsx`:

```tsx
"use client";

import { useState } from "react";

export default function SubmitFestivalPage() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error" | "duplicate">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");

    const formData = new FormData(e.currentTarget);
    const res = await fetch("/api/submissions", { method: "POST", body: formData });
    const data = await res.json();

    if (res.ok) {
      setStatus("success");
    } else if (data.error === "duplicate") {
      setStatus("duplicate");
      setMessage(data.message);
    } else {
      setStatus("error");
      setMessage(data.error || "Something went wrong");
    }
  }

  if (status === "success") {
    return (
      <div className="max-w-lg mx-auto py-16 px-4 text-center">
        <h1 className="text-2xl font-bold mb-4">Thanks for your submission!</h1>
        <p className="text-gray-600">
          Your festival has been submitted for review. Our team will check it and add it
          to the database if approved.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-16 px-4">
      <h1 className="text-2xl font-bold mb-2">Submit a Festival</h1>
      <p className="text-gray-600 mb-6">
        Know a festival that's not in our database? Submit it and we'll review it.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Festival Name *</label>
          <input
            name="festivalName"
            required
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Location (city, region)</label>
          <input
            name="locationHint"
            placeholder="e.g. Pilton, Somerset"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Festival Poster</label>
          <input name="poster" type="file" accept="image/*" className="mt-1" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Your Email (optional)</label>
          <input
            name="submitterEmail"
            type="email"
            placeholder="We'll notify you when it's approved"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        {status === "duplicate" && (
          <p className="text-amber-600 text-sm">{message}</p>
        )}
        {status === "error" && (
          <p className="text-red-600 text-sm">{message}</p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
        >
          {status === "submitting" ? "Submitting..." : "Submit Festival"}
        </button>
      </form>
    </div>
  );
}
```

**Step 3: Create admin submissions list page**

Create `src/app/admin/submissions/page.tsx`:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminSubmissionsPage() {
  const submissions = await prisma.userSubmission.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">User Submissions</h1>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Festival Name</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Location</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Poster</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Submitted</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {submissions.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/submissions/${s.id}`} className="text-blue-600 hover:underline">
                    {s.festivalName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.locationHint || "-"}</td>
                <td className="px-4 py-3 text-sm">{s.posterImageUrl ? "Yes" : "No"}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {s.createdAt.toLocaleDateString("en-GB")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      s.status === "approved"
                        ? "bg-green-100 text-green-700"
                        : s.status === "rejected"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {s.status}
                  </span>
                </td>
              </tr>
            ))}
            {submissions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No submissions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 4: Create submission detail/review page**

Create `src/app/admin/submissions/[id]/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export default async function SubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submission = await prisma.userSubmission.findUnique({ where: { id } });
  if (!submission) notFound();

  async function approve() {
    "use server";
    await prisma.userSubmission.update({
      where: { id },
      data: { status: "approved" },
    });
    // Redirect to create a new festival from this submission
    revalidatePath("/admin/submissions");
    redirect(`/admin/festivals/new?name=${encodeURIComponent(submission!.festivalName)}&location=${encodeURIComponent(submission!.locationHint || "")}&poster=${encodeURIComponent(submission!.posterImageUrl || "")}`);
  }

  async function reject() {
    "use server";
    await prisma.userSubmission.update({
      where: { id },
      data: { status: "rejected" },
    });
    revalidatePath("/admin/submissions");
    redirect("/admin/submissions");
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Submission: {submission.festivalName}</h1>

      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div>
          <p className="text-sm text-gray-500">Festival Name</p>
          <p className="font-medium">{submission.festivalName}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Location Hint</p>
          <p>{submission.locationHint || "Not provided"}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Submitter Email</p>
          <p>{submission.submitterEmail || "Not provided"}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Status</p>
          <p className="capitalize">{submission.status}</p>
        </div>

        {submission.posterImageUrl && (
          <div>
            <p className="text-sm text-gray-500 mb-2">Poster</p>
            <img src={submission.posterImageUrl} alt="Submitted poster" className="max-w-sm rounded" />
          </div>
        )}

        {submission.status === "pending" && (
          <div className="flex gap-3 pt-4">
            <form action={approve}>
              <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                Approve & Create Festival
              </button>
            </form>
            <form action={reject}>
              <button className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">
                Reject
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 5: Test the full submission flow**

1. Visit /submit as a public user
2. Submit a festival with poster
3. Check /admin/submissions — should see the submission
4. Approve it — should redirect to new festival form with pre-filled data
5. Try submitting a duplicate — should show duplicate warning

**Step 6: Commit**

```bash
git add src/app/submit/ src/app/api/submissions/ src/app/admin/submissions/ src/lib/actions/submission.ts
git commit -m "feat: add user submission flow with duplicate detection and admin review"
```

---

## Task 8: Public Festival Search & Browse

**Files:**
- Create: `src/app/festivals/page.tsx`
- Create: `src/app/festivals/[slug]/page.tsx`
- Create: `src/app/page.tsx` (replace default)
- Create: `src/lib/queries.ts`
- Create: `src/components/festival-card.tsx`
- Create: `src/components/search-filters.tsx`

**Step 1: Create search query helper**

Create `src/lib/queries.ts`:

```typescript
import { prisma } from "./prisma";

export interface SearchParams {
  artist?: string;
  region?: string;
  dateFrom?: string;
  dateTo?: string;
  priceMax?: string;
  camping?: string;
}

export async function searchFestivals(params: SearchParams) {
  const where: any = { status: "published" };

  // Filter by region
  if (params.region) {
    where.region = params.region;
  }

  // Filter by date range
  if (params.dateFrom) {
    where.startDate = { ...where.startDate, gte: new Date(params.dateFrom) };
  }
  if (params.dateTo) {
    where.endDate = { ...where.endDate, lte: new Date(params.dateTo) };
  }

  // Filter by max price
  if (params.priceMax) {
    where.priceFrom = { lte: parseInt(params.priceMax) };
  }

  // Filter by camping
  if (params.camping === "true") {
    where.hasCamping = true;
  }

  // If artist search, filter festivals that have matching artists
  if (params.artist) {
    const artistNames = params.artist.split(",").map((a) => a.trim()).filter(Boolean);

    if (artistNames.length > 0) {
      where.artists = {
        some: {
          artist: {
            name: { in: artistNames, mode: "insensitive" },
          },
        },
      };
    }
  }

  const festivals = await prisma.festival.findMany({
    where,
    include: {
      artists: {
        include: { artist: true },
        orderBy: { billing: "asc" },
      },
    },
    orderBy: { startDate: "asc" },
  });

  // If artist search, sort by number of matching artists (most matches first)
  if (params.artist) {
    const artistNames = params.artist.split(",").map((a) => a.trim().toLowerCase());
    festivals.sort((a, b) => {
      const aMatches = a.artists.filter((fa) =>
        artistNames.includes(fa.artist.name.toLowerCase())
      ).length;
      const bMatches = b.artists.filter((fa) =>
        artistNames.includes(fa.artist.name.toLowerCase())
      ).length;
      return bMatches - aMatches;
    });
  }

  return festivals;
}

export async function getFeaturedFestivals() {
  return prisma.festival.findMany({
    where: {
      status: "published",
      startDate: { gte: new Date() },
    },
    include: {
      artists: {
        include: { artist: true },
        where: { billing: "headliner" },
      },
    },
    orderBy: { startDate: "asc" },
    take: 6,
  });
}
```

**Step 2: Create festival card component**

Create `src/components/festival-card.tsx`:

```tsx
import Link from "next/link";

interface FestivalCardProps {
  festival: {
    slug: string;
    name: string;
    startDate: Date;
    endDate: Date;
    city: string;
    region: string;
    priceFrom: number | null;
    priceTo: number | null;
    hasCamping: boolean;
    posterImageUrl: string | null;
    artists: Array<{
      billing: string;
      artist: { name: string };
    }>;
  };
}

export function FestivalCard({ festival }: FestivalCardProps) {
  const headliners = festival.artists
    .filter((a) => a.billing === "headliner")
    .map((a) => a.artist.name);
  const otherArtists = festival.artists
    .filter((a) => a.billing !== "headliner")
    .map((a) => a.artist.name);

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <Link href={`/festivals/${festival.slug}`} className="block group">
      <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden">
        {festival.posterImageUrl ? (
          <img
            src={festival.posterImageUrl}
            alt={festival.name}
            className="w-full h-48 object-cover"
          />
        ) : (
          <div className="w-full h-48 bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <span className="text-white text-lg font-bold">{festival.name}</span>
          </div>
        )}
        <div className="p-4">
          <h3 className="font-bold text-lg group-hover:text-blue-600 transition-colors">
            {festival.name}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {formatDate(festival.startDate)} - {formatDate(festival.endDate)}
          </p>
          <p className="text-sm text-gray-500">
            {festival.city}, {festival.region}
          </p>
          <div className="mt-2 flex gap-2 flex-wrap">
            {festival.priceFrom != null && (
              <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                From {"\u00A3"}{festival.priceFrom}
              </span>
            )}
            {festival.hasCamping && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                Camping
              </span>
            )}
          </div>
          {headliners.length > 0 && (
            <p className="text-sm mt-2 text-gray-700">
              <span className="font-medium">{headliners.join(", ")}</span>
              {otherArtists.length > 0 && (
                <span className="text-gray-400"> +{otherArtists.length} more</span>
              )}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
```

**Step 3: Create search filters component**

Create `src/components/search-filters.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const UK_REGIONS = [
  "East Midlands", "East of England", "London", "North East",
  "North West", "Northern Ireland", "Scotland", "South East",
  "South West", "Wales", "West Midlands", "Yorkshire and the Humber",
];

export function SearchFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [artist, setArtist] = useState(searchParams.get("artist") || "");
  const [region, setRegion] = useState(searchParams.get("region") || "");
  const [dateFrom, setDateFrom] = useState(searchParams.get("dateFrom") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("dateTo") || "");
  const [priceMax, setPriceMax] = useState(searchParams.get("priceMax") || "");
  const [camping, setCamping] = useState(searchParams.get("camping") === "true");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (artist) params.set("artist", artist);
    if (region) params.set("region", region);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (priceMax) params.set("priceMax", priceMax);
    if (camping) params.set("camping", "true");
    router.push(`/festivals?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSearch} className="bg-white p-4 rounded-lg shadow space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Search by artist(s)</label>
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="e.g. Arctic Monkeys, Dua Lipa"
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
        />
        <p className="text-xs text-gray-400 mt-1">Separate multiple artists with commas</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Region</label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All regions</option>
            {UK_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Max price</label>
          <input
            type="number"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            placeholder={"\u00A3"}
            min="0"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={camping}
            onChange={(e) => setCamping(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-sm text-gray-700">Camping only</span>
        </label>
        <button type="submit" className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800">
          Search
        </button>
      </div>
    </form>
  );
}
```

**Step 4: Create festivals search results page**

Create `src/app/festivals/page.tsx`:

```tsx
import { Suspense } from "react";
import { searchFestivals, SearchParams } from "@/lib/queries";
import { FestivalCard } from "@/components/festival-card";
import { SearchFilters } from "@/components/search-filters";

export const metadata = {
  title: "Find Festivals | Festival Finder",
  description: "Search UK music festivals by artist, date, location, and more.",
};

export default async function FestivalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const festivals = await searchFestivals(params);

  const hasFilters = Object.values(params).some((v) => v);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Find Festivals</h1>
      <Suspense>
        <SearchFilters />
      </Suspense>
      <div className="mt-8">
        {hasFilters && (
          <p className="text-sm text-gray-500 mb-4">
            {festivals.length} festival{festivals.length !== 1 ? "s" : ""} found
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {festivals.map((f) => (
            <FestivalCard key={f.id} festival={f} />
          ))}
        </div>
        {festivals.length === 0 && hasFilters && (
          <p className="text-center text-gray-400 py-12">
            No festivals match your search. Try adjusting your filters.
          </p>
        )}
      </div>
    </div>
  );
}
```

**Step 5: Create festival detail page**

Create `src/app/festivals/[slug]/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const festival = await prisma.festival.findUnique({ where: { slug } });
  if (!festival) return {};
  return {
    title: `${festival.name} | Festival Finder`,
    description: `${festival.name} - ${festival.city}, ${festival.region}. Find lineup, dates, prices and more.`,
  };
}

export default async function FestivalPage({ params }: Props) {
  const { slug } = await params;
  const festival = await prisma.festival.findUnique({
    where: { slug, status: "published" },
    include: {
      artists: {
        include: { artist: true },
        orderBy: { billing: "asc" },
      },
    },
  });

  if (!festival) notFound();

  const headliners = festival.artists.filter((a) => a.billing === "headliner");
  const support = festival.artists.filter((a) => a.billing === "support");
  const other = festival.artists.filter((a) => a.billing === "other");

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="grid md:grid-cols-2 gap-8">
        <div>
          {festival.posterImageUrl ? (
            <img
              src={festival.posterImageUrl}
              alt={`${festival.name} poster`}
              className="w-full rounded-lg shadow"
            />
          ) : (
            <div className="w-full aspect-[3/4] bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <span className="text-white text-2xl font-bold">{festival.name}</span>
            </div>
          )}
        </div>

        <div>
          <h1 className="text-3xl font-bold">{festival.name}</h1>

          <div className="mt-4 space-y-3">
            <div>
              <p className="text-sm text-gray-500">Dates</p>
              <p>{formatDate(festival.startDate)} - {formatDate(festival.endDate)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Location</p>
              <p>
                {festival.venue && `${festival.venue}, `}
                {festival.city}, {festival.region}
              </p>
            </div>
            {(festival.priceFrom != null || festival.priceTo != null) && (
              <div>
                <p className="text-sm text-gray-500">Price</p>
                <p>
                  {festival.priceFrom != null && `From \u00A3${festival.priceFrom}`}
                  {festival.priceFrom != null && festival.priceTo != null && " - "}
                  {festival.priceTo != null && `\u00A3${festival.priceTo}`}
                </p>
              </div>
            )}
            <div>
              <p className="text-sm text-gray-500">Camping</p>
              <p>{festival.hasCamping ? "Yes" : "No"}</p>
            </div>
          </div>

          {festival.description && (
            <p className="mt-4 text-gray-700">{festival.description}</p>
          )}

          <div className="mt-6 flex gap-3">
            {festival.websiteUrl && (
              <a
                href={festival.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
              >
                Visit Website
              </a>
            )}
            {festival.ticketUrl && (
              <a
                href={festival.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
              >
                Buy Tickets
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="mt-12">
        <h2 className="text-2xl font-bold mb-6">Lineup</h2>

        {headliners.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Headliners
            </h3>
            <div className="flex flex-wrap gap-2">
              {headliners.map((a) => (
                <span key={a.artistId} className="bg-black text-white px-4 py-2 rounded-full text-lg font-medium">
                  {a.artist.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {support.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Support
            </h3>
            <div className="flex flex-wrap gap-2">
              {support.map((a) => (
                <span key={a.artistId} className="bg-gray-200 px-3 py-1 rounded-full">
                  {a.artist.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {other.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Also Playing
            </h3>
            <div className="flex flex-wrap gap-2">
              {other.map((a) => (
                <span key={a.artistId} className="bg-gray-100 px-3 py-1 rounded-full text-sm">
                  {a.artist.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {festival.artists.length === 0 && (
          <p className="text-gray-400">Lineup not yet announced.</p>
        )}
      </div>
    </div>
  );
}
```

**Step 6: Replace homepage**

Replace `src/app/page.tsx`:

```tsx
import Link from "next/link";
import { getFeaturedFestivals } from "@/lib/queries";
import { FestivalCard } from "@/components/festival-card";

export const metadata = {
  title: "Festival Finder | Find UK Music Festivals",
  description: "Search UK music festivals by your favourite artists, dates, location, price and more.",
};

export default async function HomePage() {
  const featured = await getFeaturedFestivals();

  return (
    <div>
      <section className="bg-gradient-to-br from-purple-600 to-pink-500 text-white py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-5xl font-bold mb-4">Find Your Festival</h1>
          <p className="text-xl mb-8 text-white/80">
            Search UK music festivals by your favourite artists
          </p>
          <form action="/festivals" method="get" className="max-w-xl mx-auto flex gap-2">
            <input
              name="artist"
              placeholder="Search by artist name..."
              className="flex-1 rounded-lg px-4 py-3 text-gray-900 text-lg"
            />
            <button
              type="submit"
              className="bg-black text-white px-8 py-3 rounded-lg hover:bg-gray-800 font-medium"
            >
              Search
            </button>
          </form>
          <div className="mt-4">
            <Link href="/festivals" className="text-white/70 hover:text-white underline text-sm">
              Browse all festivals with filters
            </Link>
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-2xl font-bold mb-6">Upcoming Festivals</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featured.map((f) => (
              <FestivalCard key={f.id} festival={f} />
            ))}
          </div>
        </section>
      )}

      <section className="bg-gray-50 py-16">
        <div className="max-w-lg mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold mb-2">Know a festival we're missing?</h2>
          <p className="text-gray-600 mb-4">
            Help us grow our database by submitting festivals.
          </p>
          <Link
            href="/submit"
            className="inline-block bg-black text-white px-6 py-3 rounded hover:bg-gray-800"
          >
            Submit a Festival
          </Link>
        </div>
      </section>
    </div>
  );
}
```

**Step 7: Create a shared public layout with navigation**

Create `src/components/navbar.tsx`:

```tsx
import Link from "next/link";

export function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl">
          Festival Finder
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/festivals" className="text-gray-600 hover:text-black">
            Find Festivals
          </Link>
          <Link href="/submit" className="text-gray-600 hover:text-black">
            Submit
          </Link>
        </div>
      </div>
    </nav>
  );
}
```

Add the `<Navbar />` to `src/app/layout.tsx` (above `{children}`, but not inside the admin layout).

**Step 8: Test the public pages**

1. Seed some test festivals via admin panel (create + add artists via extraction)
2. Visit homepage — should show featured festivals
3. Search for an artist — should show matching festivals
4. Apply filters — should filter results
5. Click a festival card — should show detail page
6. Check that "Visit Website" and "Buy Tickets" links work

**Step 9: Commit**

```bash
git add src/app/page.tsx src/app/festivals/ src/lib/queries.ts src/components/ src/app/layout.tsx
git commit -m "feat: add public homepage, festival search with filters, and detail pages"
```

---

## Task 9: SEO & Polish

**Files:**
- Modify: `src/app/layout.tsx` (metadata)
- Create: `src/app/not-found.tsx`
- Create: `src/app/festivals/[slug]/not-found.tsx`

**Step 1: Add global metadata to root layout**

In `src/app/layout.tsx`, ensure metadata is set:

```typescript
export const metadata = {
  title: {
    default: "Festival Finder | Find UK Music Festivals",
    template: "%s | Festival Finder",
  },
  description: "Search UK music festivals by artist, date, location, price and camping.",
};
```

**Step 2: Create custom 404 pages**

Create `src/app/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center text-center px-4">
      <div>
        <h1 className="text-4xl font-bold mb-4">Page not found</h1>
        <p className="text-gray-600 mb-6">The page you're looking for doesn't exist.</p>
        <Link href="/" className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800">
          Go home
        </Link>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/app/not-found.tsx src/app/layout.tsx
git commit -m "feat: add SEO metadata and 404 pages"
```

---

## Task 10: Deployment to Vercel

**Step 1: Push to GitHub**

```bash
# Create GitHub repo first (via github.com or gh CLI)
gh repo create festival-finder --private --source=.
git push -u origin main
```

**Step 2: Deploy to Vercel**

1. Go to https://vercel.com and import the GitHub repository
2. Set environment variables in Vercel dashboard:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`)
   - `NEXTAUTH_URL` (your Vercel domain)
   - `ANTHROPIC_API_KEY`
3. Deploy

**Step 3: Run production migration**

```bash
npx prisma migrate deploy
npx prisma db seed
```

**Step 4: Verify deployment**

1. Visit the live URL
2. Test search, filters, festival detail pages
3. Login to admin panel
4. Test poster upload + extraction
5. Test user submission flow

**Step 5: Commit any deployment fixes**

```bash
git add -A
git commit -m "chore: deployment configuration"
```
