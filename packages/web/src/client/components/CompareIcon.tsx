export function CompareIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className="w-[13px] h-[13px]"
    >
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 8.6v4.15A3.25 3.25 0 0 0 9.25 16H13"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 15.4V11.2A3.25 3.25 0 0 0 14.75 8H11"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="m13.2 13.8 2.2 2.2-2.2 2.2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m10.8 5.8-2.2 2.2 2.2 2.2" />
    </svg>
  );
}
