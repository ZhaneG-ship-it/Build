import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

const LOOP = [
  { q: 'How does this business work?', a: 'An adaptive assessment and interview build a structured model of your operations, people, systems and costs.' },
  { q: 'Where are the problems?', a: 'Processes are mapped and measured. Bottlenecks, delays, errors and admin load are identified and quantified.' },
  { q: 'Why do those problems exist?', a: 'Each problem is traced to a root cause, so the fix addresses the cause rather than the symptom.' },
  { q: 'Could AI realistically improve them?', a: 'Every process is assessed on its merits. Where AI is the wrong answer, the platform says so.' },
  { q: 'What would it cost?', a: 'Implementation cost, running cost and complexity, estimated as ranges from your own figures.' },
  { q: 'What could the outcome be?', a: 'Capacity released, cost reduction and revenue opportunity — reported separately and clearly labelled as estimates.' },
  { q: 'How do we implement and measure it?', a: 'Approved opportunities become projects with milestones, KPIs and monthly projected-versus-actual reviews.' },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) {
    if (user.platformRole === 'PLATFORM_ADMIN') redirect('/admin');
    const consultant = user.memberships.find((m) => m.role === 'CONSULTANT');
    if (consultant) redirect('/consultant');
    if (user.memberships[0]) redirect(`/app/${user.memberships[0].organisationId}`);
  }

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-[13px] font-bold text-brandInk">
              C
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">Clarity</span>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-muted transition hover:bg-raised hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-brandInk transition hover:brightness-110"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand">
          AI business intelligence &amp; implementation
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
          Start with how your business works. Not with a list of AI tools.
        </h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">
          Clarity builds a structured model of your operations, finds where time and money are
          actually going, and works out whether AI or automation would genuinely help. When it
          would not, it tells you that instead.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/register"
            className="rounded-lg bg-brand px-5 py-2.5 text-[14px] font-medium text-brandInk transition hover:brightness-110"
          >
            Start an assessment
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-line bg-surface px-5 py-2.5 text-[14px] font-medium text-ink transition hover:bg-raised"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">The intelligence loop</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
            Seven questions, answered in order. Every conclusion traces back to something your
            business told us or a document it supplied.
          </p>
          <ol className="mt-10 space-y-0">
            {LOOP.map((step, index) => (
              <li key={step.q} className="flex gap-5 border-b border-line py-5 last:border-0">
                <span className="tabular mt-0.5 shrink-0 text-[13px] font-semibold text-brand">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink">{step.q}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{step.a}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              title: 'Nothing is invented',
              body: 'Every figure is calculated from information you supplied, shown as a range, with its assumptions and formula recorded next to it.',
            },
            {
              title: 'Confidence is always stated',
              body: 'Where the platform lacks the data to be sure, it says so and names exactly what would improve the estimate.',
            },
            {
              title: '"Do nothing" is a valid answer',
              body: 'Processes that should be left alone are reported as such, with the reason. Knowing where not to spend is worth as much as knowing where to.',
            },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <h3 className="text-[14px] font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-8 text-[12px] text-faint">
          Clarity — AI Business Intelligence &amp; Implementation Platform.
        </div>
      </footer>
    </main>
  );
}
