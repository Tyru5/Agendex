import { AnimatePresence, domAnimation, LazyMotion, m } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';

type LightboxImage = {
  url: string;
  fileName?: string | null;
};

interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [direction, setDirection] = useState(0);
  const current = images[index]!;
  const hasMultiple = images.length > 1;

  const goNext = useCallback(() => {
    setDirection(1);
    setIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  const goPrev = useCallback(() => {
    setDirection(-1);
    setIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (hasMultiple && e.key === 'ArrowRight') goNext();
      if (hasMultiple && e.key === 'ArrowLeft') goPrev();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, hasMultiple, goNext, goPrev]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className="fixed inset-0 z-[var(--z-lightbox)] flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        initial={{ backgroundColor: 'rgba(0,0,0,0)' }}
        animate={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
        exit={{ backgroundColor: 'rgba(0,0,0,0)' }}
        transition={{ duration: 0.25 }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* Close */}
        <m.button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.1 }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </m.button>

        {/* Open in new tab */}
        <m.a
          href={current.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open image in new tab"
          className="absolute top-4 right-16 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.1 }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </m.a>

        {/* Previous */}
        {hasMultiple && (
          <m.button
            type="button"
            onClick={goPrev}
            aria-label="Previous image"
            className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </m.button>
        )}

        {/* Image container — scales in on first open, scales out on close */}
        <m.div
          className="flex items-center justify-center"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Image slide transition when cycling */}
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <m.img
              key={index}
              src={current.url}
              alt={current.fileName ?? 'Image'}
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain select-none"
              draggable={false}
              custom={direction}
              variants={{
                enter: (dir: number) => ({
                  opacity: 0,
                  x: dir > 0 ? 80 : -80,
                }),
                center: { opacity: 1, x: 0 },
                exit: (dir: number) => ({
                  opacity: 0,
                  x: dir > 0 ? -80 : 80,
                }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            />
          </AnimatePresence>
        </m.div>

        {/* Next */}
        {hasMultiple && (
          <m.button
            type="button"
            onClick={goNext}
            aria-label="Next image"
            className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </m.button>
        )}

        {/* Dots */}
        {hasMultiple && (
          <m.div
            className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-1.5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ delay: 0.1 }}
          >
            {images.map((_, i) => (
              <button
                key={images[i]!.url}
                type="button"
                aria-label={`Go to image ${i + 1}`}
                onClick={() => {
                  setDirection(i > index ? 1 : -1);
                  setIndex(i);
                }}
                className={`h-2 w-2 rounded-full transition-colors ${
                  i === index ? 'bg-white' : 'bg-white/40 hover:bg-white/60'
                }`}
              />
            ))}
          </m.div>
        )}
      </m.div>
    </LazyMotion>
  );
}
