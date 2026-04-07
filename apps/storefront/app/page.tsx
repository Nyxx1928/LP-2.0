"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ProductAction = "cart" | "buy";

const sampleProducts = [
  {
    id: "p1",
    name: "Universal TV Remote",
    category: "TV Accessories",
    price: "PHP 249.00",
  },
  {
    id: "p2",
    name: "Acacia Cutting Board",
    category: "Wooden Products",
    price: "PHP 399.00",
  },
  {
    id: "p3",
    name: "8m Extension Wire",
    category: "Electrical",
    price: "PHP 359.00",
  },
  {
    id: "p4",
    name: "Precision Screwdriver Set",
    category: "Hand Tools",
    price: "PHP 529.00",
  },
];

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_URL ?? "http://localhost:9000";

export default function Home() {
  const router = useRouter();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [authPrompt, setAuthPrompt] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch(`${BACKEND_URL}/store/customers/me`, {
          credentials: "include",
        });

        setIsAuthenticated(response.ok);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsCheckingSession(false);
      }
    }

    void checkSession();
  }, []);

  function handleProtectedAction(productName: string, action: ProductAction) {
    setFeedback(null);

    if (!isAuthenticated) {
      setAuthPrompt(
        action === "cart"
          ? `Please login or register to add ${productName} to cart.`
          : `Please login or register to buy ${productName}.`
      );

      return;
    }

    setAuthPrompt(null);
    setFeedback(
      action === "cart"
        ? `${productName} added to cart. (Sample flow only)`
        : `Proceeding to checkout for ${productName}. (Sample flow only)`
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Likhang Pinas</p>
            <h1 className="text-lg font-semibold text-zinc-900">E-Commerce Storefront</h1>
          </div>
          <form action="/auth">
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
            >
              {isAuthenticated ? "Account" : "Login or Register"}
            </button>
          </form>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Practical tools for every Filipino home
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-zinc-600 sm:text-base">
            Users can browse products and prices on first load. Buying actions require login.
          </p>
          <p className="mt-2 text-sm font-medium text-zinc-700">
            {isCheckingSession
              ? "Checking session..."
              : isAuthenticated
                ? "You are logged in. Add to cart and buy actions are enabled."
                : "You are browsing as guest. Login is required to add to cart or buy."}
          </p>
        </div>

        {authPrompt ? (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p>{authPrompt}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => router.push("/auth")}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black"
              >
                Go to Login/Register
              </button>
              <button
                type="button"
                onClick={() => setAuthPrompt(null)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700"
              >
                Continue browsing
              </button>
            </div>
          </div>
        ) : null}

        {feedback ? (
          <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
            {feedback}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sampleProducts.map((product) => (
            <article key={product.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{product.category}</p>
              <h3 className="mt-2 text-base font-semibold text-zinc-900">{product.name}</h3>
              <p className="mt-3 text-sm font-medium text-zinc-700">{product.price}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleProtectedAction(product.name, "cart")}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:border-zinc-900"
                >
                  Add to cart
                </button>
                <button
                  type="button"
                  onClick={() => handleProtectedAction(product.name, "buy")}
                  className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-black"
                >
                  Buy now
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
