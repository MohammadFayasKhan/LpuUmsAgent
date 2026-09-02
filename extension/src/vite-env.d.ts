/*
 * TypeScript Module Declarations for ONEE.
 *
 * Provides ambient type declarations for:
 * - CSS Modules (*.module.css) returning className mapping objects.
 * - @bible-strong/avatar-web avatar instance interfaces.
 * - Vite client environment variables (VITE_BACKEND_URL, etc.).
 */

/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '@bible-strong/avatar-web' {
  export interface AvatarController {
    play(animation: string, autoReturnIdleMs?: number): any;
    setExpression(expression: string): any;
    pause(): void;
    stop(): void;
    getState(): any;
    destroy(): void;
  }
  export interface CreateAvatarOptions {
    definition: any;
    defaultAnimation?: string;
    defaultExpression?: string;
    autoplay?: boolean;
    size?: number | string;
    ariaLabel?: string;
    className?: string;
    onError?: (error: any) => void;
    onAnimationEnd?: (animation: string) => void;
    onExpressionChange?: (expression: string) => void;
  }
  export function createAvatar(target: string | HTMLElement, options: CreateAvatarOptions): AvatarController;
}
