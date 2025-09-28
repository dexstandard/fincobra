import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextInput({ className = '', ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`w-full border rounded px-2 py-1 ${className}`}
      {...props}
    />
  );
});

export default TextInput;
