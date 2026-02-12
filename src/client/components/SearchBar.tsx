import { useState, useEffect, useRef } from 'react';

export function SearchBar({ onSearch }: { onSearch: (q: string) => void }) {
  const [value, setValue] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(value), 250);
    return () => clearTimeout(timer.current);
  }, [value]);

  return (
    <div
      className="flex items-center gap-2 rounded-lg"
      style={{
        padding: '6px 12px',
        border: '1px solid var(--border)',
        background: 'transparent',
        minWidth: '220px',
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        style={{ width: '14px', height: '14px', opacity: 0.3, flexShrink: 0 }}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search plans..."
        className="flex-1 outline-none"
        style={{
          background: 'transparent',
          border: 'none',
          fontFamily: 'inherit',
          fontSize: '13px',
          color: 'var(--text)',
        }}
      />
    </div>
  );
}
