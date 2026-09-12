import { ArrowRight, Check, MessageCircle, Satellite } from "lucide-react";
import { buttonVariants } from "../components/ui/button";

export function LandingPage({ onStart }: { onStart: () => void }) {
  return (
    <main id="main-content">
      <section className="mx-auto grid max-w-[1600px] items-center gap-8 p-4 py-12 md:p-6 md:py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(32rem,1.1fr)] lg:py-24">
        <div className="max-w-2xl space-y-6">
          <p className="font-semibold text-primary">
            Field intelligence, in context
          </p>
          <h1 className="max-w-[18ch]">
            From climate alert to agronomic decision.
          </h1>
          <p className="max-w-[58ch] text-lg leading-relaxed text-muted-foreground">
            See your land, crop context, Sentinel-2 imagery, and recent weather
            events in one calm workspace. Time-sensitive alerts reach you on
            WhatsApp, where they are easier to act on.
          </p>
          <a
            className={buttonVariants({ className: "w-fit" })}
            href="/sign-in"
            onClick={(event) => {
              event.preventDefault();
              onStart();
            }}
          >
            Open your workspace <ArrowRight aria-hidden="true" />
          </a>
          <ul className="grid gap-3 text-sm leading-normal">
            <li className="flex gap-3">
              <Check
                className="mt-0.5 size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              Actual source times and honest unavailable states
            </li>
            <li className="flex gap-3">
              <Check
                className="mt-0.5 size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              Plot-level crop and growth-stage context
            </li>
          </ul>
        </div>
        <ProductPreview />
      </section>
      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-[1600px] gap-8 p-4 py-12 md:grid-cols-2 md:p-6 md:py-16">
          <div className="max-w-xl space-y-3">
            <Satellite className="size-6 text-primary" aria-hidden="true" />
            <h2>Explore on the web</h2>
            <p className="text-muted-foreground">
              Review field boundaries, crop facts, dated satellite imagery, and
              the event record without mixing alerts into the timeline.
            </p>
          </div>
          <div className="max-w-xl space-y-3">
            <MessageCircle className="size-6 text-primary" aria-hidden="true" />
            <h2>Respond through WhatsApp</h2>
            <p className="text-muted-foreground">
              AgroSense sends configured alert notifications where producers can
              see them quickly. The web workspace stays focused on evidence.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function ProductPreview() {
  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <span className="font-semibold">Las Acacias</span>
        <span className="text-sm leading-normal text-muted-foreground">
          Evidence workspace
        </span>
      </figcaption>
      <div className="grid min-h-96 grid-cols-[7rem_minmax(0,1fr)_8rem] gap-3">
        <div className="space-y-3 rounded-xl bg-muted p-3">
          <span className="text-sm leading-normal font-semibold">
            Field data
          </span>
          <div className="h-2 w-16 bg-border" />
          <div className="h-2 w-12 bg-border" />
          <div className="h-2 w-14 bg-border" />
        </div>
        <div className="grid place-items-center overflow-hidden rounded-xl border bg-secondary p-4">
          <svg
            className="h-full min-h-64 w-full text-primary"
            viewBox="0 0 320 240"
            role="img"
            aria-label="Selected field boundary over a satellite workspace"
          >
            <path
              className="fill-card stroke-border"
              strokeWidth="2"
              d="M8 30 95 8l65 30 78-24 74 50-28 72 20 84-94 12-58-38-86 32-54-70 34-58Z"
            />
            <path
              className="fill-success stroke-primary"
              strokeWidth="5"
              d="m74 72 96-24 76 44-18 82-102 20-62-56Z"
            />
          </svg>
        </div>
        <div className="space-y-3 rounded-xl bg-muted p-3">
          <span className="text-sm leading-normal font-semibold">Timeline</span>
          {["Now", "Sep 11", "Sep 8"].map((label) => (
            <div className="border-l-2 border-primary pl-2" key={label}>
              <span className="text-xs leading-normal text-muted-foreground">
                {label}
              </span>
              <div className="mt-1 h-2 w-full bg-border" />
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
