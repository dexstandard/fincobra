import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  loading?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: Props) {
  const base =
    'px-3 py-1.5 rounded text-sm flex items-center justify-center border';
  const variants: Record<string, string> = {
    primary:
      'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed border-transparent',
    secondary:
      'border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed',
    danger:
      'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed border-transparent',
    link: 'text-blue-500 hover:underline disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none',
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
