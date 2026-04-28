/**
 * Next.js App Router integration patterns for @pokerzeno/backend-core
 *
 * This file is a reference — copy patterns into your actual app files.
 * It is NOT meant to run directly.
 */

// ── Server Component (no auth needed, public data) ─────────────────────────
//
// app/leaderboard/page.tsx
//
// import { points } from '@pokerzeno/backend-core'
//
// export default async function LeaderboardPage() {
//   const top = await points.getLeaderboard(50)
//   return (
//     <ul>
//       {top.map((p, i) => (
//         <li key={p.id}>{i + 1}. {p.display_name ?? p.username} — {p.lifetime_points} pts</li>
//       ))}
//     </ul>
//   )
// }

// ── Server Action (auth + mutation) ────────────────────────────────────────
//
// app/posts/actions.ts
//
// 'use server'
// import { cookies } from 'next/headers'
// import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
// import { posts, points } from '@pokerzeno/backend-core'
//
// export async function createPostAction(formData: FormData) {
//   const supabase = createServerComponentClient({ cookies })
//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) throw new Error('Not authenticated')
//
//   const thread = await posts.createThread(user.id, {
//     title: formData.get('title') as string,
//     body_md: formData.get('body') as string,
//   })
//
//   if (thread) {
//     await points.awardPoints(user.id, 'post_created', 10)
//     await points.checkAndPromote(user.id)
//   }
//
//   return thread
// }

// ── Route Handler (API endpoint) ───────────────────────────────────────────
//
// app/api/groups/[id]/join/route.ts
//
// import { NextRequest, NextResponse } from 'next/server'
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
// import { cookies } from 'next/headers'
// import { groups } from '@pokerzeno/backend-core'
//
// export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
//   const supabase = createRouteHandlerClient({ cookies })
//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
//
//   const membership = await groups.joinGroup(user.id, params.id)
//   if (!membership) return NextResponse.json({ error: 'Failed to join group' }, { status: 400 })
//
//   return NextResponse.json(membership)
// }

// ── Auth callback handler ──────────────────────────────────────────────────
//
// app/auth/callback/route.ts
//
// import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
// import { cookies } from 'next/headers'
// import { NextRequest, NextResponse } from 'next/server'
//
// export async function GET(req: NextRequest) {
//   const { searchParams } = new URL(req.url)
//   const code = searchParams.get('code')
//
//   if (code) {
//     const supabase = createRouteHandlerClient({ cookies })
//     await supabase.auth.exchangeCodeForSession(code)
//   }
//
//   return NextResponse.redirect(new URL('/dashboard', req.url))
// }

// ── Client component (browser) ─────────────────────────────────────────────
//
// components/SignInForm.tsx
//
// 'use client'
// import { createBrowserClient } from '@pokerzeno/backend-core'
// import { useState } from 'react'
//
// export function SignInForm() {
//   const [email, setEmail] = useState('')
//   const supabase = createBrowserClient()
//
//   async function handleMagicLink() {
//     await supabase.auth.signInWithOtp({
//       email,
//       options: { emailRedirectTo: `${location.origin}/auth/callback` },
//     })
//     alert('Check your email!')
//   }
//
//   return (
//     <form onSubmit={e => { e.preventDefault(); handleMagicLink() }}>
//       <input value={email} onChange={e => setEmail(e.target.value)} type="email" />
//       <button type="submit">Send Magic Link</button>
//     </form>
//   )
// }

// ── Environment variables for Next.js ──────────────────────────────────────
//
// .env.local:
//
// NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
// NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
// SUPABASE_SERVICE_ROLE_KEY=eyJ...   # server-side only — never expose to browser

export {}
