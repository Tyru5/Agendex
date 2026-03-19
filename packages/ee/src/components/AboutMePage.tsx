import { startViewTransition } from '@agendex/web';
import { useLocation } from 'wouter';

const ABOUT_SECTIONS = [
  {
    eyebrow: 'Who I Am',
    title: 'The person behind this project.',
    body: '[Write 2-4 sentences about who you are, the work you care about, and the kinds of tools you want to exist.]',
  },
  {
    eyebrow: 'Why Agendex Exists',
    title: 'What felt missing.',
    body: '[Write why you started Agendex, what you kept seeing in agent workflows, and what made the current experience feel incomplete.]',
  },
  {
    eyebrow: 'How I Think About It',
    title: 'The product point of view.',
    body: '[Write how you think good agent tooling should behave: where it should feel precise, where it should stay out of the way, and what you want people to trust about it.]',
  },
  {
    eyebrow: 'What Comes Next',
    title: 'Where this is heading.',
    body: '[Write what you want to keep exploring with the product, the workflow, or the larger direction of the project.]',
  },
] as const;

export function AboutMePage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#0a0a0a] text-white">
      <style>{`
        @media (max-width: 768px) {
          .about-me-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-24 h-72 w-72 rounded-full bg-[rgba(200,255,50,0.08)] blur-3xl" />
        <div className="absolute right-[-6rem] top-[24rem] h-96 w-96 rounded-full bg-[rgba(255,255,255,0.035)] blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-[1080px] flex-col px-6 pb-20 pt-8">
        <button
          type="button"
          onClick={() => startViewTransition(() => navigate('/'))}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-2 text-[13px] font-medium tracking-[-0.01em] text-[rgba(255,255,255,0.88)] transition-[border-color,background,color] duration-200 hover:border-[rgba(200,255,50,0.24)] hover:bg-[rgba(200,255,50,0.08)] hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Back to Agendex
        </button>

        <section className="about-me-grid mt-12 grid grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-10 border-b border-[rgba(255,255,255,0.06)] pb-12">
          <div>
            <div className="mb-4 text-[12px] font-medium uppercase tracking-[0.22em] text-[#c8ff32]">
              About Ti
            </div>
            <h1 className="m-0 max-w-[10ch] font-[Unbounded,sans-serif] text-[clamp(42px,7vw,78px)] font-normal leading-[0.94] tracking-[-0.05em] text-white">
              Hi, I&apos;m Ti.
            </h1>
            <p className="mb-0 mt-6 max-w-[34rem] text-[17px] leading-[1.8] text-[rgba(255,255,255,0.72)]">
              This page is where I can explain the project in my own voice instead of through a
              product grid. The structure is ready for that copy, and the sections below are
              intentionally left as first-person placeholders for the first pass.
            </p>
          </div>

          <div className="self-end rounded-[28px] border border-[rgba(255,255,255,0.07)] bg-[linear-gradient(180deg,rgba(20,20,20,0.94),rgba(11,11,11,0.96))] p-6 shadow-[0_18px_42px_rgba(0,0,0,0.35)]">
            <div className="text-[12px] font-medium uppercase tracking-[0.18em] text-[rgba(255,255,255,0.42)]">
              Founder Note Placeholder
            </div>
            <p className="mb-0 mt-4 text-[15px] leading-[1.75] text-[rgba(255,255,255,0.7)]">
              [Use this panel for a short opening note. One paragraph is enough if it says who you
              are, what this project is, and what you want people to understand before they try it.]
            </p>
          </div>
        </section>

        <section className="mt-12 grid gap-5">
          {ABOUT_SECTIONS.map((section) => (
            <article
              key={section.eyebrow}
              className="rounded-[28px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.025)] px-6 py-7 md:px-8"
            >
              <div className="text-[12px] font-medium uppercase tracking-[0.2em] text-[#c8ff32]">
                {section.eyebrow}
              </div>
              <h2 className="mb-0 mt-3 font-[Unbounded,sans-serif] text-[clamp(24px,3vw,34px)] font-normal tracking-[-0.04em] text-white">
                {section.title}
              </h2>
              <p className="mb-0 mt-4 max-w-[48rem] text-[16px] leading-[1.85] text-[rgba(255,255,255,0.72)]">
                {section.body}
              </p>
            </article>
          ))}
        </section>

        <footer className="mt-12 border-t border-[rgba(255,255,255,0.06)] pt-8 text-[14px] leading-[1.8] text-[rgba(255,255,255,0.62)]">
          <p className="m-0">
            [Optional closing note: write a short signoff, a thank-you, or a sentence about the kind
            of people you hope this product helps.]
          </p>
          <p className="mb-0 mt-4 text-[12px] leading-[1.7] text-[rgba(255,255,255,0.42)]">
            Mascot sprite by{' '}
            <a
              href="https://arks.itch.io/dino-characters"
              target="_blank"
              rel="noreferrer"
              className="text-[rgba(200,255,50,0.82)] underline decoration-[rgba(200,255,50,0.35)] underline-offset-4"
            >
              Arks
            </a>{' '}
            under CC BY 4.0.
          </p>
        </footer>
      </main>
    </div>
  );
}
