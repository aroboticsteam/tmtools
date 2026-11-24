import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-neutral-900 text-white border border-neutral-900 hover:bg-neutral-700 hover:border-neutral-700',
  secondary: 'bg-white text-neutral-800 border border-neutral-200 hover:bg-neutral-50',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
  ghost: 'bg-transparent text-neutral-600 border border-transparent hover:bg-neutral-100 hover:text-neutral-900',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-12 px-5 text-base font-semibold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium
        transition-colors disabled:cursor-not-allowed disabled:opacity-40
        ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
