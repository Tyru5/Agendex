import { dinoShadow, dinoVitaIdleStrip, startViewTransition } from '@agendex/web';
import { useEffect } from 'react';
import { useLocation } from 'wouter';

const DINO_SIZE = 84;
const DINO_FRAMES = 4;

export function AboutMePage() {
  const [, navigate] = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white selection:bg-[rgba(200,255,50,0.25)]">
      <style>{`
        @keyframes about-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .about-in { animation: about-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .about-d1 { animation-delay: 60ms; }
        .about-d2 { animation-delay: 140ms; }
        @keyframes about-dino-idle {
          from { background-position: 0 0; }
          to { background-position: -${DINO_SIZE * DINO_FRAMES}px 0; }
        }
      `}</style>

      <span aria-hidden="true" className="pointer-events-none fixed right-6 top-6 z-[100]">
        <img
          src={dinoShadow}
          alt=""
          style={{
            position: 'absolute',
            left: '10px',
            bottom: '-2px',
            width: '64px',
            imageRendering: 'pixelated',
            opacity: 0.6,
          }}
        />
        <span
          className="block overflow-hidden"
          style={{
            width: `${DINO_SIZE}px`,
            height: `${DINO_SIZE}px`,
            backgroundImage: `url(${dinoVitaIdleStrip})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${DINO_SIZE * DINO_FRAMES}px ${DINO_SIZE}px`,
            backgroundPosition: '0 0',
            imageRendering: 'pixelated',
            filter: 'drop-shadow(0 14px 24px rgba(0,0,0,0.28))',
            animation: `about-dino-idle 0.72s steps(${DINO_FRAMES}) infinite`,
          }}
        />
      </span>

      <main className="relative mx-auto max-w-[840px] px-6 pb-28 pt-10">
        <nav className="about-in">
          <button
            type="button"
            onClick={() => startViewTransition(() => navigate('/'))}
            className="group inline-flex items-center gap-1.5 text-[13px] text-[rgba(255,255,255,0.35)] transition-colors hover:text-white"
          >
            <span
              className="inline-block transition-transform duration-150 group-hover:-translate-x-0.5"
              aria-hidden="true"
            >
              ←
            </span>
            Back
          </button>
        </nav>

        <header className="about-in about-d1 mb-20 mt-24">
          <h1 className="font-[Unbounded,sans-serif] text-[clamp(48px,8vw,86px)] font-normal leading-[0.92] tracking-[0]">
            Hi, I&apos;m{' '}
            <a
              href="https://tiru5.me"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[rgba(255,255,255,0.2)] underline-offset-[3px] transition-colors hover:text-[#c8ff32]"
            >
              Ti
            </a>
            <span className="text-[#c8ff32]">.</span>
          </h1>
          <p className="mt-10 max-w-[28rem] text-[17px] leading-[1.9] text-[rgba(255,255,255,0.5)]">
            This is where I explain the project in my own voice instead of through a product grid!
            😅
          </p>
        </header>

        <div className="about-in about-d2">
          <section className="border-t border-[rgba(255,255,255,0.06)] pb-14 pt-10">
            <span className="font-mono text-[11px] text-[rgba(255,255,255,0.18)]">01</span>
            <h2 className="mt-4 text-[clamp(24px,3.2vw,36px)] font-normal leading-[1.3] tracking-[0] text-[rgba(255,255,255,0.92)]">
              The person behind this project.
            </h2>
            <p className="mt-5 max-w-[32rem] text-[15px] leading-[1.9] text-[rgba(255,255,255,0.48)]">
              I'm adaptable Software Engineer that loves solving problems with code 🔎. <br />{' '}
              <br />
              I'm the type of engineer, and honestly person, that obsessively obssess on evey little
              aspect of a project. So, the fact that I was able to release an deploy this for others
              to check out and potentially use is an achievement for sure! <br /> <br />I love
              working in this ever-changing, dynamic, fast-paced industry and honestly if I'm able
              to effect even one person with a tool I create that's a win for me!
            </p>
          </section>

          <section className="border-t border-[rgba(255,255,255,0.06)] pb-14 pt-10">
            <span className="font-mono text-[11px] text-[rgba(255,255,255,0.18)]">02</span>
            <div className="ml-4 mt-6 border-l-[2px] border-[rgba(200,255,50,0.3)] pl-6 sm:ml-8 sm:pl-8">
              <p className="font-[Unbounded,sans-serif] text-[clamp(22px,3vw,30px)] font-normal leading-[1.35] tracking-[0] text-[rgba(255,255,255,0.88)]">
                What felt missing.
              </p>
              <p className="mt-5 max-w-[34rem] text-[15px] leading-[1.9] text-[rgba(255,255,255,0.48)]">
                I honestly started this project intially to solve a problem/annoyance I was running
                into in this agentic age of programming. This tool allows you to view, edit, and
                interact with plans that are created by any and all models/agents. I've found it to
                be super helpful, and I hope you do to.
              </p>
            </div>
          </section>

          <section className="border-t border-[rgba(255,255,255,0.06)] pb-14 pt-10">
            <span className="font-mono text-[11px] text-[rgba(200,255,50,0.5)]">04</span>
            <h2 className="mt-4 font-[Unbounded,sans-serif] text-[clamp(24px,3.2vw,36px)] font-normal leading-[1.3] tracking-[0] text-white">
              Where this is heading<span className="text-[#c8ff32]">.</span>
            </h2>
            <p className="mt-5 max-w-[32rem] text-[15px] leading-[1.9] text-[rgba(255,255,255,0.48)]">
              Forward! I have so many ideas on cool/helpful features to implement and would love
              any/all contributions!
            </p>
          </section>
        </div>

        <footer className="border-t border-[rgba(255,255,255,0.06)] pt-10">
          <p className="max-w-[28rem] text-[15px] leading-[1.9] text-[rgba(255,255,255,0.38)]">
            Thanks for checking this project out, I greatly appreciate it! <br /> <br />
            Never stop being you ❤️
            <br /> <br />
            <br /> <br />
            Onwards and Upwards 🚀
          </p>
          <p className="mt-8 text-[11px] text-[rgba(255,255,255,0.2)]">
            Mascot sprite by{' '}
            <a
              href="https://arks.itch.io/dino-characters"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[rgba(255,255,255,0.1)] underline-offset-[3px] transition-colors hover:text-[rgba(200,255,50,0.6)]"
            >
              Arks
            </a>{' '}
            · CC BY 4.0
          </p>
        </footer>
      </main>
    </div>
  );
}
