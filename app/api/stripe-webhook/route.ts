import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";

// ─── stripe client ────────────────────────────────────────────────────────────

function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function setUserPlan(email: string, plan: "pro" | "free") {
  const clerk        = await clerkClient();
  const { data: users } = await clerk.users.getUserList({ emailAddress: [email] });
  if (users.length === 0) return;
  const user = users[0];
  await clerk.users.updateUser(user.id, {
    publicMetadata: { ...user.publicMetadata, plan },
  });
}

// ─── route ────────────────────────────────────────────────────────────────────

// Stripe sends the raw body — Next.js must NOT parse it before we verify the sig
export const config = { api: { bodyParser: false } };

export async function POST(req: NextRequest) {
  const body    = await req.text();
  const sig     = req.headers.get("stripe-signature");
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }

  try {
    switch (event.type) {

      // ── user paid ──────────────────────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const email   = session.customer_details?.email ?? session.customer_email;
        if (email) {
          await setUserPlan(email, "pro");
          // Store Stripe IDs on the user for cancellation lookup
          const clerk = await clerkClient();
          const { data: users } = await clerk.users.getUserList({ emailAddress: [email] });
          if (users.length > 0) {
            await clerk.users.updateUser(users[0].id, {
              privateMetadata: {
                ...users[0].privateMetadata,
                stripeCustomerId:     session.customer    as string,
                stripeSubscriptionId: session.subscription as string,
              },
            });
          }
        }
        break;
      }

      // ── subscription reactivated / paid after failure ──────────────────────
      case "customer.subscription.updated": {
        const sub      = event.data.object as Stripe.Subscription;
        const stripe   = getStripe();
        const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        if (customer.email) {
          const plan = sub.status === "active" ? "pro" : "free";
          await setUserPlan(customer.email, plan);
        }
        break;
      }

      // ── subscription cancelled / expired ──────────────────────────────────
      case "customer.subscription.deleted": {
        const sub      = event.data.object as Stripe.Subscription;
        const stripe   = getStripe();
        const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
        if (customer.email) {
          await setUserPlan(customer.email, "free");
        }
        break;
      }
    }
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
