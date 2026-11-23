# TaskPulse 3D – Task Manager & Productivity Tracker

HTML, CSS, vanilla JavaScript, Three.js (3D hero) and **Supabase** (login + database). No build step.

## Files
| File | Purpose |
|---|---|
| `index.html`, `style.css`, `script.js` | The app: 3D hero, dashboard, analytics, tasks (unchanged design) |
| `auth.js` | Signup, login, logout, password reset, session, and saving tasks to Supabase |
| `supabase-config.js` | **You edit this**: your Supabase Project URL and anon key |
| `supabase-setup.sql` | **You run this once** in Supabase to create the `tasks` table and security rules |

## Setup (about 10 minutes, no experience needed)
1. **Create an account** at https://supabase.com (click *Start your project*, sign in with GitHub or email).
2. **Create a project**: click *New project*, choose any name, set a **Database password** (save it somewhere; you will not need it in this app), pick the region nearest you, click *Create new project*. Wait about 2 minutes.
3. **Copy your keys**: in the project, open **Project Settings (gear icon) > API** (or click the **Connect** button at the top). Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon public** key (newer projects call it the **Publishable key**)
   Do **not** copy the `service_role` / secret key. It bypasses all security and must never go in this project.
4. **Paste them** into `supabase-config.js`, replacing the two `PASTE_...` values.
5. **Create the database**: in Supabase open **SQL Editor > New query**, paste the whole content of `supabase-setup.sql`, click **Run**. You should see "Success". Check **Table Editor > tasks**: it should show *RLS enabled*.
6. **Allow the reset-password link**: **Authentication > URL Configuration**. Set **Site URL** to `http://127.0.0.1:5500` and add `http://127.0.0.1:5500/**` and `http://localhost:5500/**` under **Redirect URLs**. Save.
7. **Email settings (optional)**: by default Supabase sends a confirmation email after signup, and users must click it before logging in. For quick testing you can turn it off at **Authentication > Sign In / Providers > Email > Confirm email**. The built-in email service allows only a few emails per hour.
8. **Run**: open the folder in VS Code, install the **Live Server** extension, right-click `index.html` > **Open with Live Server**.

Until step 4 is done, the login page shows "Supabase is not configured yet". That is intentional.

## Pages
`#/login` (default), `#/signup`, `#/forgot`. After clicking a password-reset email link (open it in the same browser that requested it) you land on a "Choose a new password" page. Only one form is shown at a time. Logged-in users go straight to the dashboard.

## How your data is protected
Every task row has a `user_id`. Row Level Security policies in `supabase-setup.sql` only allow `auth.uid() = user_id`, so one user can never read, edit or delete another user's tasks, and logged-out visitors can access nothing. The anon key in the browser is safe to expose because of these policies.

## Old tasks from before accounts
Tasks saved in this browser by the earlier version (localStorage key `orbit.tasks.v1`) are never deleted. After logging in you are offered an import into your account.

## Extra column
The schema adds `completed_at` (not in your list) so the weekly activity chart can show when tasks were completed.

## Troubleshooting
- *"The tasks table is missing"*: run `supabase-setup.sql` (step 5).
- *"Not allowed by the database security policy"*: re-run `supabase-setup.sql`.
- *Reset link opens but nothing happens*: open it in the same browser, and check step 6.
- *Signup says check your email*: confirm via the email, or disable "Confirm email" (step 7).
