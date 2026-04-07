"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

type AuthMode = "login" | "register";
type RequestStatus = "idle" | "loading" | "success" | "error";

type AuthError = {
  message?: string;
  type?: string;
};

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? "http://localhost:9000";

async function postToMedusa(path: string, payload: Record<string, string>) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    return;
  }

  let errorMessage = `Request failed with status ${response.status}`;

  try {
    const parsed = (await response.json()) as AuthError;
    if (parsed.message) {
      errorMessage = parsed.message;
    }
  } catch {
    // Keep fallback message when backend does not return JSON.
  }

  throw new Error(errorMessage);
}

export default function AuthPage() {
  const router = useRouter();

  const [mode, setMode] = useState<AuthMode>("login");
  const [status, setStatus] = useState<RequestStatus>("idle");
  const [message, setMessage] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const heading = useMemo(
    () => (mode === "login" ? "Login to your account" : "Create a new account"),
    [mode]
  );

  const isSubmitting = status === "loading";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStatus("loading");
    setMessage("");

    try {
      if (mode === "register") {
        await postToMedusa("/auth/customer/emailpass/register", {
          email,
          password,
          ...(firstName.trim() ? { first_name: firstName.trim() } : {}),
          ...(lastName.trim() ? { last_name: lastName.trim() } : {}),
        });
      }

      await postToMedusa("/auth/customer/emailpass", {
        email,
        password,
      });

      setStatus("success");
      setMessage("Success. Redirecting to homepage...");
      router.push("/");
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 sm:px-6">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-sm text-zinc-600 hover:text-zinc-900"
        >
          Back to homepage
        </button>

        <div className="mt-5">
          <h1 className="text-2xl font-semibold text-zinc-900">{heading}</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Use your email and password to continue.
          </p>
        </div>

        <div className="mt-6 flex rounded-lg border border-zinc-200 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setMessage("");
            }}
            className={`w-1/2 rounded-md px-3 py-2 text-sm font-medium transition ${
              mode === "login" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setMessage("");
            }}
            className={`w-1/2 rounded-md px-3 py-2 text-sm font-medium transition ${
              mode === "register"
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            Register
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-zinc-800">
                First name
                <input
                  type="text"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  autoComplete="given-name"
                />
              </label>

              <label className="block text-sm font-medium text-zinc-800">
                Last name
                <input
                  type="text"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  autoComplete="family-name"
                />
              </label>
            </div>
          ) : null}

          <label className="block text-sm font-medium text-zinc-800">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              autoComplete="email"
            />
          </label>

          <label className="block text-sm font-medium text-zinc-800">
            Password
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? "Please wait..."
              : mode === "login"
                ? "Login"
                : "Register and continue"}
          </button>
        </form>

        {message ? (
          <p
            className={`mt-4 text-sm ${
              status === "error" ? "text-red-600" : "text-emerald-700"
            }`}
          >
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
