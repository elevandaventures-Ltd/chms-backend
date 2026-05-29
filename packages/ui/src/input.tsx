import { type InputHTMLAttributes, type JSX } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, id, className, name, ...rest }: InputProps): JSX.Element {
  const inputId = id ?? name;
  return (
    <div className={className}>
      {label && <label htmlFor={inputId}>{label}</label>}
      <input id={inputId} name={name} aria-invalid={Boolean(error)} {...rest} />
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
