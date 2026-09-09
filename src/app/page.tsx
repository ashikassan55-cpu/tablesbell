import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  QrCode,
  BellRing,
  Timer,
  Check,
  X,
  ShieldCheck,
  Star,
  MapPin,
  Mail,
  Phone,
  Droplet,
  ReceiptText,
} from 'lucide-react';
import { SiteHeader } from '@/components/marketing/site-header';
import { SavingsCalculator } from '@/components/marketing/savings-calculator';
import { DemoForm } from '@/components/marketing/demo-form';

/**
 * src/app/page.tsx
 *
 * The public marketing landing page at `/` — the home page the Vercel
 * deploy was 404-ing on (every other route lives under the `(console)`
 * or `(guest)` route groups). Built from the Stitch "TableBells — Smart
 * QR Ordering & Waiter Call for UAE Cafés" design. Static Server
 * Component; the header menu, savings calculator, and demo form are the
 * only client islands.
 */

export const metadata: Metadata = {
  title: 'Smart QR Ordering & Waiter Call for UAE Cafés',
  alternates: { canonical: '/' },
};

const STEPS = [
  {
    icon: QrCode,
    title: 'Scan the table QR',
    body: 'Guests point their phone at the table tent. The menu opens instantly in the browser — no app, no sign-up, works on iOS and Android.',
    chip: 'Zero app download',
  },
  {
    icon: BellRing,
    title: 'Order or call the server',
    body: 'Browse dishes with photos, pick modifiers, or tap a single button: “Call server”, “Request water”, “Get bill” — no waving, no waiting.',
    chip: 'Instant alert, table pinned',
  },
  {
    icon: Timer,
    title: 'Get served faster',
    body: 'Orders and calls hit the floor and kitchen screens the moment they’re sent. One server comfortably covers more tables at peak.',
    chip: '~18 min faster table turns',
  },
];

const PLANS = [
  {
    name: 'Starter Café',
    blurb: 'Small coffee shops, specialty tea bars and bakeries.',
    price: '199',
    note: 'Billed monthly · Cancel anytime',
    features: [
      'Up to 10 tables',
      'High-speed digital QR menu',
      'Waiter-call & bill alerts',
      'Instant staff WhatsApp notifications',
    ],
    cta: 'Start with Starter',
    featured: false,
  },
  {
    name: 'Bistro & Eatery',
    blurb: 'Busy casual dining, burger joints and cafeterias.',
    price: '349',
    note: '14-day risk-free trial',
    features: [
      'Up to 25 tables',
      'Full in-table ordering & modifiers',
      'Waiter call + live kitchen display (KDS)',
      'Bilingual: English & Arabic',
      'Peak-hour turnaround analytics',
    ],
    cta: 'Try Bistro & Eatery',
    featured: true,
  },
  {
    name: 'Busy Restaurant',
    blurb: 'High-volume dining, outdoor terraces and restobars.',
    price: '549',
    note: 'Priority on-site setup',
    features: [
      'Unlimited tables & multiple floors',
      'Split-bill requests & tip calculation',
      'Kitchen thermal printer hookup',
      'POS integration assistance',
    ],
    cta: 'Talk to us',
    featured: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-guest-canvas font-body text-guest-text">
      <SiteHeader />

      <main className="pt-16">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 md:grid md:grid-cols-2 md:gap-10 md:pb-24 md:pt-16">
          <div className="flex flex-col items-start gap-5">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-guest-text shadow-sm">
              🇦🇪 Built for UAE independent cafés &amp; eateries
              <span className="text-guest-success">· Zero hardware</span>
            </span>
            <h1 className="font-heading text-4xl font-extrabold leading-tight tracking-tight text-guest-text sm:text-5xl">
              Your guests order and call the server — straight from their phones.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-guest-text-muted">
              Empower diners to scan, order, and page their server without waving or waiting. Cut wait
              times and save over <strong className="font-semibold text-guest-text">AED 4,500/month</strong>{' '}
              in front-of-house payroll.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-xl bg-guest-primary px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-guest-primary/25 transition-colors hover:bg-[#d24e33]"
              >
                Book a 5-minute demo
                <ArrowRight className="h-4 w-4" />
              </a>
              <SavingsCalculator />
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-guest-text-muted">
              {['Setup in 15 minutes', "Works on guests' own phones", 'Cancel anytime'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-guest-success" />
                  <span className="font-medium text-guest-text">{t}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Phone mockup */}
          <div className="mt-12 flex justify-center md:mt-0">
            <div className="w-full max-w-[20rem] rounded-[2rem] border border-guest-border-warm bg-white p-4 shadow-[0_20px_60px_-15px_rgba(43,40,38,0.25)]">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-guest-text">
                  <span className="h-2 w-2 rounded-full bg-guest-success" />
                  Connected · Table&nbsp;#4
                </span>
                <span className="text-xs text-guest-text-muted">English | عربي</span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <MockAction icon={BellRing} label="Call server" primary />
                <MockAction icon={ReceiptText} label="Request bill" />
                <MockAction icon={Droplet} label="Extra water" />
              </div>

              <div className="mt-3 space-y-2">
                <MockItem emoji="☕" name="Spanish Cortado" desc="Oat milk, single origin" price="AED 26" />
                <MockItem emoji="🥐" name="Zaatar Burrata Brioche" desc="Fresh thyme, olive oil" price="AED 44" />
              </div>

              <div className="mt-3 flex items-center justify-between rounded-lg bg-guest-success px-3 py-2 text-xs font-semibold text-white">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  Order sent to kitchen
                </span>
                <span className="font-bold">Live</span>
              </div>
            </div>
          </div>
        </section>

        {/* Trust strip */}
        <section className="border-y border-guest-border-warm bg-white">
          <p className="mx-auto max-w-6xl px-4 py-4 text-center text-sm font-medium text-guest-text-muted sm:px-6">
            Loved by neighbourhood specialty spots in Dubai &amp; Abu Dhabi
          </p>
        </section>

        {/* Comparison */}
        <section id="why" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-guest-primary shadow-sm">
              The true math of UAE F&amp;B staffing
            </span>
            <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight text-guest-text">
              One extra waiter, or a flat monthly fee?
            </h2>
            <p className="mt-2 text-guest-text-muted">
              Front-of-house headcount in the UAE carries visa, housing and insurance costs long after
              the salary. TableBells is one predictable line item.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-guest-border-warm bg-white p-6">
              <span className="inline-block rounded bg-guest-critical/10 px-2 py-1 text-xs font-bold uppercase text-guest-critical">
                The old, expensive route
              </span>
              <h3 className="mt-3 font-heading text-xl font-bold">Hiring one extra waiter</h3>
              <p className="mt-3 font-heading text-2xl font-extrabold text-guest-critical">
                AED 4,500+ <span className="text-sm font-normal text-guest-text-muted">/ mo</span>
              </p>
              <ul className="mt-4 space-y-3 text-sm text-guest-text-muted">
                {[
                  'UAE visa & Emirates ID: AED 7,000–9,000 every 2 years, amortised.',
                  'Mandatory health insurance, housing and transport stipends.',
                  'Sick leave and turnover — constant retraining through peak season.',
                  'One person can still only walk to one table at a time.',
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-guest-critical" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative rounded-2xl border-2 border-guest-primary bg-white p-6">
              <span className="absolute right-0 top-0 rounded-bl-xl rounded-tr-2xl bg-guest-primary px-3 py-1 text-xs font-bold text-white">
                Recommended
              </span>
              <span className="inline-block rounded bg-guest-tertiary/15 px-2 py-1 text-xs font-bold uppercase text-guest-tertiary">
                The TableBells way
              </span>
              <h3 className="mt-3 font-heading text-xl font-bold">TableBells digital floor</h3>
              <p className="mt-3 font-heading text-2xl font-extrabold text-guest-primary">
                From AED 199 <span className="text-sm font-normal text-guest-text-muted">/ mo flat</span>
              </p>
              <ul className="mt-4 space-y-3 text-sm text-guest-text-muted">
                {[
                  'No visa, housing or insurance costs — payroll stays lightweight.',
                  'Never calls in sick; runs every rush, morning to late night.',
                  '+35% faster table turnover — no 10-minute wait just for the bill.',
                  'Photos and smart modifiers lift dessert & drink add-ons ~18%.',
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-guest-tertiary" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-guest-border-warm pt-4">
                <span className="text-sm font-bold text-guest-tertiary">Not sure of the number?</span>
                <SavingsCalculator trigger="link" />
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="bg-white py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="rounded-full bg-guest-canvas px-3 py-1 text-xs font-semibold uppercase tracking-wide text-guest-primary">
                Zero-friction workflow
              </span>
              <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight text-guest-text">
                Three taps from seated to served
              </h2>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <div key={step.title} className="rounded-2xl border border-guest-border-warm bg-guest-canvas p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-guest-primary font-heading text-sm font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-guest-primary">
                      <step.icon className="h-5 w-5" />
                    </span>
                  </div>
                  <h3 className="mt-4 font-heading text-lg font-bold text-guest-text">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-guest-text-muted">{step.body}</p>
                  <p className="mt-4 text-xs font-semibold text-guest-tertiary">{step.chip}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-guest-tertiary/25 bg-guest-tertiary/10 p-6 text-center sm:flex-row sm:text-left">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-guest-tertiary/15 text-guest-tertiary">
                <ShieldCheck className="h-7 w-7" />
              </span>
              <div>
                <h4 className="font-heading text-lg font-bold text-guest-text">No new hardware required</h4>
                <p className="mt-1 text-sm text-guest-text-muted">
                  Staff use the phones and tablets they already own. We courier laser-engraved acrylic
                  table stands to your venue, free on signup.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-guest-primary shadow-sm">
              Predictable UAE plans
            </span>
            <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight text-guest-text">
              Flat monthly pricing, in dirhams
            </h2>
            <p className="mt-2 text-guest-text-muted">No per-order cut. No setup fee. Cancel anytime.</p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
                  plan.featured
                    ? 'border-2 border-guest-primary shadow-lg shadow-guest-primary/10'
                    : 'border-guest-border-warm'
                }`}
              >
                {plan.featured ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-guest-primary px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-md">
                    Neighbourhood favourite
                  </span>
                ) : null}
                <h3 className="font-heading text-lg font-bold text-guest-text">{plan.name}</h3>
                <p className="mt-1 text-sm text-guest-text-muted">{plan.blurb}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span
                    className={`font-heading text-4xl font-extrabold ${
                      plan.featured ? 'text-guest-primary' : 'text-guest-text'
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span className="font-heading text-lg text-guest-text-muted">AED</span>
                  <span className="text-sm text-guest-text-muted">/ month</span>
                </div>
                <span className="mt-1 text-xs font-semibold text-guest-tertiary">{plan.note}</span>
                <ul className="mt-4 flex-1 space-y-2.5 text-sm text-guest-text">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-guest-tertiary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="#demo"
                  className={`mt-6 flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-bold transition-colors ${
                    plan.featured
                      ? 'bg-guest-primary text-white shadow-md shadow-guest-primary/30 hover:bg-[#d24e33]'
                      : 'bg-guest-canvas text-guest-text hover:bg-guest-border-warm'
                  }`}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>

          <p className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-center text-sm font-medium text-guest-tertiary shadow-sm">
            <QrCode className="h-4 w-4" />
            Free custom laser-engraved acrylic table stands, couriered to your venue on signup.
          </p>
        </section>

        {/* Testimonial */}
        <section id="testimonials" className="bg-white py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <div className="flex items-center gap-2 text-guest-primary">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-current" />
              ))}
              <span className="ml-1 text-sm font-bold text-guest-text">5.0 · verified UAE merchant</span>
            </div>
            <blockquote className="mt-4 font-heading text-2xl font-normal leading-snug text-guest-text">
              “During Friday rush in Al Karama we used to lose customers because staff were overwhelmed.
              With TableBells one server comfortably manages 12 tables.{' '}
              <span className="font-bold text-guest-primary">We saved the cost of two part-timers</span>{' '}
              and our table turnover is 18 minutes faster.”
            </blockquote>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <p className="font-heading font-bold text-guest-text">Tariq Al-Mansoor</p>
                <p className="text-sm text-guest-text-muted">Owner &amp; Head Baker · Karak &amp; Crumb Café, Dubai</p>
              </div>
              <span className="text-sm font-medium text-guest-primary">Al Karama · 18 tables</span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:max-w-sm">
              <div className="rounded-xl bg-guest-canvas p-4 text-center">
                <p className="font-heading text-xl font-bold text-guest-primary">AED 9,000</p>
                <p className="text-xs text-guest-text-muted">Monthly staff cost saved</p>
              </div>
              <div className="rounded-xl bg-guest-canvas p-4 text-center">
                <p className="font-heading text-xl font-bold text-guest-tertiary">18 mins</p>
                <p className="text-xs text-guest-text-muted">Faster table turns</p>
              </div>
            </div>
          </div>
        </section>

        {/* Demo form */}
        <section id="demo" className="bg-guest-canvas py-20">
          <div className="mx-auto max-w-xl px-4 sm:px-6">
            <div className="text-center">
              <span className="flex mx-auto h-12 w-12 items-center justify-center rounded-full bg-guest-primary/10 text-guest-primary">
                <BellRing className="h-6 w-6" />
              </span>
              <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight text-guest-text">
                Book your 5-minute demo
              </h2>
              <p className="mx-auto mt-2 max-w-md text-guest-text-muted">
                Tell us about your venue. Our UAE team sends a live test menu link to your WhatsApp,
                usually within one business day.
              </p>
            </div>
            <div className="mt-8 rounded-2xl border border-guest-border-warm bg-white p-6 shadow-sm">
              <DemoForm />
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-guest-border-warm bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <Link href="/" className="font-heading text-xl font-extrabold tracking-tight text-guest-text">
                Table<span className="text-guest-primary">Bells</span>
              </Link>
              <p className="mt-2 max-w-sm text-sm text-guest-text-muted">
                Simple, tactile QR ordering and instant waiter paging for independent cafés,
                roasteries and bistros across the UAE.
              </p>
            </div>

            <FooterCol
              title="Explore"
              links={[
                ['How it works', '#how'],
                ['Why TableBells', '#why'],
                ['Pricing', '#pricing'],
                ['Testimonials', '#testimonials'],
              ]}
            />
            <FooterCol
              title="Solutions"
              links={[
                ['Specialty coffee roasters', '#how'],
                ['Casual dine-in bistros', '#how'],
                ['Outdoor terrace tables', '#how'],
                ['Kitchen display (KDS)', '#how'],
              ]}
            />

            <div>
              <p className="pb-3 text-sm font-bold text-guest-text">Direct support</p>
              <ul className="space-y-2 text-sm text-guest-text-muted">
                <li className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> Alserkal Avenue, Dubai, UAE
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="h-4 w-4" /> hello@tablebells.ae
                </li>
                <li className="flex items-center gap-2">
                  <Phone className="h-4 w-4" /> +971 4 000 0000
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-guest-border-warm pt-6 sm:flex-row">
            <p className="text-xs text-guest-text-muted">
              © {new Date().getFullYear()} TableBells UAE Technologies FZ-LLC. All rights reserved.
            </p>
            <div className="flex gap-4 text-xs text-guest-text-muted">
              <a href="#" className="hover:text-guest-text">Privacy</a>
              <a href="#" className="hover:text-guest-text">Terms</a>
              <a href="#" className="hover:text-guest-text">UAE VAT compliance</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function MockAction({
  icon: Icon,
  label,
  primary = false,
}: {
  icon: typeof BellRing;
  label: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-center ${
        primary ? 'bg-guest-primary text-white' : 'border border-guest-border-warm bg-white text-guest-text'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="text-[11px] font-bold leading-tight">{label}</span>
    </div>
  );
}

function MockItem({
  emoji,
  name,
  desc,
  price,
}: {
  emoji: string;
  name: string;
  desc: string;
  price: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-guest-border-warm p-2">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-guest-canvas text-lg">
        {emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-guest-text">{name}</p>
        <p className="truncate text-xs text-guest-text-muted">{desc}</p>
      </div>
      <span className="text-sm font-bold text-guest-text">{price}</span>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-guest-primary text-sm font-bold text-white">
        +
      </span>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="pb-3 text-sm font-bold text-guest-text">{title}</p>
      <ul className="space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="text-sm text-guest-text-muted hover:text-guest-text">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
