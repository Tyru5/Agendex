import { SkeletonBlock } from '@agendex/web';

export function BootLoadingView({
  message = 'Loading your dashboard...',
  fullscreen = true,
}: {
  message?: string;
  fullscreen?: boolean;
}) {
  return (
    <div
      className={
        fullscreen
          ? 'h-screen flex items-center justify-center bg-bg'
          : 'h-full min-h-[280px] flex items-center justify-center'
      }
    >
      <div className="w-full max-w-[420px] px-5">
        <div className="text-[13px] text-tertiary mb-3 text-center">{message}</div>
        <SkeletonBlock lines={4} />
      </div>
    </div>
  );
}
